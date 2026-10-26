import crypto from 'crypto';

/**
 * Fire-and-forget outbound webhook emitter.
 *
 * SendStack posts WhatsApp events (incoming messages, ack updates, session
 * transitions, QR refreshes) to the Laravel side. Each request is signed with
 * HMAC-SHA256 so Laravel can verify authenticity and guard against replay.
 *
 * Headers sent:
 *   X-SendStack-Timestamp: <unix seconds>
 *   X-SendStack-Signature: sha256=<hex>   // hmac(secret, `${ts}.${rawBody}`)
 *
 * Configuration (env):
 *   LARAVEL_WEBHOOK_URL        e.g. https://laravel.host/api/webhooks/sendstack
 *   LARAVEL_WEBHOOK_SECRET     HMAC secret (defaults to LARAVEL_WHATSAPP_SECRET if unset)
 *   LARAVEL_WEBHOOK_TIMEOUT_MS default 5000
 */

export type WebhookEvent =
  | 'session.qr'
  | 'session.status'
  | 'message.received'
  | 'message.ack';

interface WebhookPayload {
  event: WebhookEvent;
  ts: number;
  data: unknown;
}

const RETRY_DELAYS_MS = [1000, 4000, 10000];

let webhookConfigWarned = false;

function resolveWebhookUrl(): string {
  const explicit = (process.env.LARAVEL_WEBHOOK_URL ?? '').trim();
  if (explicit) {
    return explicit;
  }
  const base = (
    process.env.SENDSTACK_UPDATE_BASE_URL ??
    process.env.STORAGE_APP_URL ??
    process.env.APP_URL ??
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  if (!base) {
    return '';
  }
  return `${base}/api/webhooks/sendstack`;
}

function getConfig(): { url: string; secret: string; timeoutMs: number } | null {
  const url = resolveWebhookUrl();
  const secret = (
    process.env.LARAVEL_WEBHOOK_SECRET ??
    process.env.LARAVEL_WHATSAPP_SECRET ??
    ''
  ).trim();
  if (!url || !secret) {
    if (!webhookConfigWarned) {
      webhookConfigWarned = true;
      console.warn(
        '[Webhook] Disabled — set LARAVEL_WEBHOOK_URL (or SENDSTACK_UPDATE_BASE_URL) and LARAVEL_WEBHOOK_SECRET / LARAVEL_WHATSAPP_SECRET',
      );
    }
    return null;
  }
  const timeoutMs = Math.max(
    1000,
    Math.min(30000, Number(process.env.LARAVEL_WEBHOOK_TIMEOUT_MS ?? 5000)),
  );
  return { url, secret, timeoutMs };
}

function sign(secret: string, ts: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
}

async function deliver(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Emit a webhook event. Never throws — failures are logged and swallowed so
 * WhatsApp event handlers stay responsive.
 */
export function emitWebhook(event: WebhookEvent, data: unknown): void {
  const cfg = getConfig();
  if (!cfg) {
    return;
  }

  const ts = Math.floor(Date.now() / 1000).toString();
  const payload: WebhookPayload = { event, ts: Number(ts), data };
  const body = JSON.stringify(payload);
  const signature = sign(cfg.secret, ts, body);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-SendStack-Timestamp': ts,
    'X-SendStack-Signature': signature,
    'X-SendStack-Event': event,
  };

  // Kick off async delivery with retries. We intentionally do not await so
  // that whatsapp-web.js event handlers complete quickly.
  void (async () => {
    let lastError: string | undefined;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const res = await deliver(cfg.url, headers, body, cfg.timeoutMs);
      if (res.ok) {
        if (attempt > 0) {
          console.log(`[Webhook] ${event} delivered after ${attempt + 1} attempts`);
        }
        return;
      }
      lastError = res.error ?? `HTTP ${res.status ?? 'unknown'}`;
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
    const hint404 =
      lastError === 'HTTP 404'
        ? ' — deploy Laravel route POST /api/webhooks/sendstack and set LARAVEL_WEBHOOK_URL to that path (not /api/webhook/sendstack)'
        : '';
    console.error(`[Webhook] ${event} delivery failed after retries:`, lastError + hint404);
  })();
}
