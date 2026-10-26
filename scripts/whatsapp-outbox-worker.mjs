/**
 * Polls Laravel `whatsapp_outbox` and delivers via SendStack internal API.
 *
 * Env (same DB as Laravel):
 *   LARAVEL_DB_HOST, LARAVEL_DB_PORT, LARAVEL_DB_USER, LARAVEL_DB_PASSWORD, LARAVEL_DB_DATABASE
 *   Or: LARAVEL_DATABASE_URL=mysql://user:pass@host:3306/dbname
 *
 * SendStack:
 *   SENDSTACK_INTERNAL_URL — base URL e.g. http://127.0.0.1:3000
 *   LARAVEL_WHATSAPP_SECRET — must match Laravel SENDSTACK_INTERNAL_SECRET
 *
 * Optional:
 *   WHATSAPP_OUTBOX_POLL_MS (default 5000)
 *   WHATSAPP_OUTBOX_BATCH (default 15)
 *   WHATSAPP_OUTBOX_MAX_ATTEMPTS (default 5)
 */

import mysql from 'mysql2/promise';

const pollMs = Number(process.env.WHATSAPP_OUTBOX_POLL_MS || 5000);
const batch = Math.max(1, Number(process.env.WHATSAPP_OUTBOX_BATCH || 15));
const maxAttempts = Math.max(1, Number(process.env.WHATSAPP_OUTBOX_MAX_ATTEMPTS || 5));

const baseUrl = (process.env.SENDSTACK_INTERNAL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const secret = process.env.LARAVEL_WHATSAPP_SECRET || '';

function poolConfig() {
  const url = process.env.LARAVEL_DATABASE_URL;
  if (url) {
    return { uri: url, waitForConnections: true, connectionLimit: 4 };
  }
  return {
    host: process.env.LARAVEL_DB_HOST || '127.0.0.1',
    port: Number(process.env.LARAVEL_DB_PORT || 3306),
    user: process.env.LARAVEL_DB_USER || 'root',
    password: process.env.LARAVEL_DB_PASSWORD || '',
    database: process.env.LARAVEL_DB_DATABASE || '',
    waitForConnections: true,
    connectionLimit: 4,
  };
}

async function claimBatch(pool) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM whatsapp_outbox
       WHERE status = 'pending'
         AND (scheduled_at IS NULL OR scheduled_at <= UTC_TIMESTAMP())
       ORDER BY id ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [batch]
    );

    if (!rows.length) {
      await conn.commit();
      return [];
    }

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    await conn.query(
      `UPDATE whatsapp_outbox SET status = 'processing', last_error = NULL WHERE id IN (${placeholders})`,
      ids
    );
    await conn.commit();
    return rows;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function resetStaleProcessing(pool) {
  await pool.query(
    `UPDATE whatsapp_outbox
     SET status = 'pending', last_error = 'stale processing reset'
     WHERE status = 'processing'
       AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 20 MINUTE)`
  );
}

async function sendOne(row) {
  const res = await fetch(`${baseUrl}/api/internal/whatsapp/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Whatsapp-Secret': secret,
      'X-Idempotency-Key': row.idempotency_key || `outbox-${row.id}`,
    },
    body: JSON.stringify({
      phone: row.recipient_phone,
      message: row.message,
    }),
  });

  const data = await res.json().catch(() => ({}));
  const ok = res.ok && data.success === true;
  return { ok, data };
}

async function main() {
  if (!secret) {
    console.error('[whatsapp-outbox-worker] LARAVEL_WHATSAPP_SECRET is required');
    process.exit(1);
  }

  const pool = mysql.createPool(poolConfig());
  console.log('[whatsapp-outbox-worker] started; poll', pollMs, 'ms batch', batch);

  for (;;) {
    try {
      await resetStaleProcessing(pool);
      const rows = await claimBatch(pool);
      for (const row of rows) {
        const { ok, data } = await sendOne(row);
        if (ok) {
          await pool.query(
            `UPDATE whatsapp_outbox SET status = 'sent', sent_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = ?`,
            [row.id]
          );
          console.log('[whatsapp-outbox-worker] sent id=', row.id);
        } else {
          const nextAttempts = (row.attempts || 0) + 1;
          const failed = nextAttempts >= maxAttempts;
          const status = failed ? 'failed' : 'pending';
          const err = (data && data.error) || `HTTP ${data?.status || '?'}`;
          await pool.query(
            `UPDATE whatsapp_outbox SET status = ?, attempts = ?, last_error = ? WHERE id = ?`,
            [status, nextAttempts, String(err).slice(0, 65000), row.id]
          );
          console.warn('[whatsapp-outbox-worker] fail id=', row.id, err, '→', status);
        }
      }
    } catch (err) {
      console.error('[whatsapp-outbox-worker] loop error', err);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
