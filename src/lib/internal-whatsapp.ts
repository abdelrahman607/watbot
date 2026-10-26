import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { internalDebugPayload, logInternalWaError, logInternalWaWarn } from '@/lib/internal-whatsapp-log';
import {
  getStatus,
  getQR,
  sendMessage,
  sendMedia,
  normalizePhone,
  normalizeSessionKey,
  autoInit,
  ensureSessionReady,
  getClientInfo,
  isSessionReady,
  disconnect,
  clearSavedSessionForSession,
  describeSendError,
  listContacts,
  listGroups,
  createGroup,
  addGroupParticipants,
  removeGroupParticipants,
  type WAStatus,
} from '@/lib/whatsapp-client';

/**
 * أثناء reconnecting (أو بعد authenticated قبل ready) ننتظر حتى ready.
 * نرفض فورًا فقط عند disconnected أو عند QR حقيقي بانتظار المسح.
 */
export async function waitForWaReady(sk: string): Promise<{ ok: true } | { ok: false; status: WAStatus }> {
  if (isSessionReady(sk)) {
    return { ok: true };
  }

  let status = getStatus(sk);
  const qr = getQR(sk);

  // Fresh QR waiting for scan — cannot send yet
  if (status === 'disconnected' || (status === 'qr' && qr)) {
    return { ok: false, status };
  }

  const maxMs = Math.max(5000, Math.min(120000, parseInt(process.env.SENDSTACK_SEND_WAIT_FOR_READY_MS ?? '45000', 10)));
  const intervalMs = Math.max(300, Math.min(3000, parseInt(process.env.SENDSTACK_SEND_POLL_MS ?? '800', 10)));

  if (status === 'reconnecting' || (status === 'qr' && !qr)) {
    logInternalWaWarn('POST /send: waiting for session while reconnecting', { session_key: sk, maxMs, intervalMs });
  }

  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (isSessionReady(sk)) {
      return { ok: true };
    }
    status = getStatus(sk);
    const currentQr = getQR(sk);
    if (status === 'disconnected') {
      return { ok: false, status };
    }
    if (status === 'qr' && currentQr) {
      return { ok: false, status };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { ok: false, status: getStatus(sk) };
}

/**
 * Shared auth for Laravel → SendStack internal WhatsApp API.
 * Set LARAVEL_WHATSAPP_SECRET in SendStack to match Laravel SENDSTACK_INTERNAL_SECRET.
 */
export function verifyLaravelWhatsappSecret(request: Request): boolean {
  const expected = process.env.LARAVEL_WHATSAPP_SECRET ?? '';
  if (!expected) {
    return false;
  }
  const header = request.headers.get('x-whatsapp-secret');
  return header === expected;
}

export function internalUnauthorized(): NextResponse {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

export function internalMisconfigured(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'LARAVEL_WHATSAPP_SECRET is not configured on SendStack.' },
    { status: 503 }
  );
}

export async function handleInternalSend(request: Request): Promise<NextResponse> {
  if (!(process.env.LARAVEL_WHATSAPP_SECRET ?? '')) {
    return internalMisconfigured();
  }
  if (!verifyLaravelWhatsappSecret(request)) {
    return internalUnauthorized();
  }

  try {
    const body = await request.json();
    const { phone, message, session_key } = body as { phone?: string; message?: string; session_key?: string };
    const sk = normalizeSessionKey(session_key);

    if (!phone || !message) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: phone and message are required.' },
        { status: 400 }
      );
    }

    let normalized: string;
    try {
      normalized = normalizePhone(phone);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ success: false, error: errMsg }, { status: 400 });
    }

    autoInit(sk);
    const ready = await waitForWaReady(sk);
    if (!ready.ok) {
      const status = ready.status;
      logInternalWaWarn('POST /send rejected: client not ready', { status, phoneLen: normalized.length, session_key: sk });
      return NextResponse.json(
        {
          success: false,
          error: `WhatsApp client is not ready. Current status: ${status}`,
          errorType: 'not_ready',
          session_key: sk,
        },
        { status: 400 }
      );
    }

    const messageId = await sendMessage(normalized, message, sk);
    return NextResponse.json({ success: true, messageId, session_key: sk });
  } catch (error: unknown) {
    const msg = describeSendError(error);
    logInternalWaError('POST /send failed', error, {
      hint: 'Check Chrome/Puppeteer, session ready, and recipient on WhatsApp',
      described: msg.slice(0, 400),
    });
    const lower = msg.toLowerCase();
    let errorType: string = 'unknown';
    if (lower.includes('not ready') || lower.includes('disconnected during send')) {
      errorType = 'disconnected';
    } else if (lower.includes('not registered') || lower.includes('invalid wid')) {
      errorType = 'not_on_whatsapp';
    } else if (lower.includes('rate') || lower.includes('spam') || lower.includes('too many')) {
      errorType = 'rate_limited';
    } else if (lower.includes('timeout') || lower.includes('network') || lower.includes('econnreset')) {
      errorType = 'network';
    } else if (
      lower.includes('opaque code') ||
      lower.includes('puppeteer') ||
      lower.includes('executioncontext') ||
      lower.includes('whatsapp web send failed')
    ) {
      errorType = 'browser_context';
    }

    return NextResponse.json(
      { success: false, error: msg, errorType, ...internalDebugPayload(error instanceof Error ? error : new Error(msg)) },
      { status: 500 }
    );
  }
}

export async function handleInternalConnect(request: Request): Promise<NextResponse> {
  if (!(process.env.LARAVEL_WHATSAPP_SECRET ?? '')) {
    return internalMisconfigured();
  }
  if (!verifyLaravelWhatsappSecret(request)) {
    return internalUnauthorized();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { force_qr, session_key } = body as { force_qr?: boolean; session_key?: string };
    const sk = normalizeSessionKey(session_key);

    if (force_qr) {
      await disconnect(sk);
      await new Promise((r) => setTimeout(r, process.platform === 'win32' ? 3000 : 500));
      clearSavedSessionForSession(sk);
    } else {
      autoInit(sk);
    }

    try {
      await ensureSessionReady(sk);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          success: false,
          error: msg,
          status: getStatus(sk),
          session_key: sk,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      status: getStatus(sk),
      info: getClientInfo(sk),
      session_key: sk,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logInternalWaError('POST /sessions/connect failed', error);
    return NextResponse.json(
      { success: false, error: msg, ...internalDebugPayload(error) },
      { status: 500 }
    );
  }
}

/** فصل العميل واختياريًا حذف ملفات الجلسة على القرص (مثل force_qr دون إعادة التهيئة). */
export async function handleInternalDisconnect(request: Request): Promise<NextResponse> {
  if (!(process.env.LARAVEL_WHATSAPP_SECRET ?? '')) {
    return internalMisconfigured();
  }
  if (!verifyLaravelWhatsappSecret(request)) {
    return internalUnauthorized();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { clear_session, session_key } = body as { clear_session?: boolean; session_key?: string };
    const clearSession = clear_session !== false;
    const sk = normalizeSessionKey(session_key);

    await disconnect(sk);
    if (clearSession) {
      clearSavedSessionForSession(sk);
    }

    return NextResponse.json({
      success: true,
      whatsapp: getStatus(sk),
      info: getClientInfo(sk),
      session_key: sk,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logInternalWaError('POST /sessions/disconnect failed', error);
    return NextResponse.json(
      { success: false, error: msg, ...internalDebugPayload(error) },
      { status: 500 }
    );
  }
}

/**
 * Allowed MIME types for internal media sending (mirrors the public route's whitelist).
 */
const INTERNAL_MEDIA_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

const INTERNAL_MEDIA_MAX_BYTES = 16 * 1024 * 1024; // 16 MB WhatsApp cap

/**
 * Send media (image/video/document/audio) via the internal, Laravel-only route.
 * Accepts the same {phone, message, session_key} envelope as /send, plus a
 * `media` object with base64 content, MIME type and filename.
 */
export async function handleInternalSendMedia(request: Request): Promise<NextResponse> {
  if (!(process.env.LARAVEL_WHATSAPP_SECRET ?? '')) {
    return internalMisconfigured();
  }
  if (!verifyLaravelWhatsappSecret(request)) {
    return internalUnauthorized();
  }

  try {
    const body = await request.json();
    const {
      phone,
      caption,
      session_key,
      media,
    } = body as {
      phone?: string;
      caption?: string;
      session_key?: string;
      media?: { base64?: string; mimeType?: string; filename?: string };
    };

    const sk = normalizeSessionKey(session_key);

    if (!phone || !media || !media.base64 || !media.mimeType || !media.filename) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Missing required fields: phone and media.{base64, mimeType, filename} are required.',
        },
        { status: 400 },
      );
    }

    if (!INTERNAL_MEDIA_ALLOWED_MIME.has(media.mimeType)) {
      return NextResponse.json(
        { success: false, error: `MIME type not allowed: ${media.mimeType}` },
        { status: 400 },
      );
    }

    // Rough byte estimate from base64 length (3/4 ratio, minus padding)
    const estBytes = Math.ceil((media.base64.length * 3) / 4);
    if (estBytes > INTERNAL_MEDIA_MAX_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Media file too large (${estBytes} bytes). Max allowed: ${INTERNAL_MEDIA_MAX_BYTES}.`,
        },
        { status: 400 },
      );
    }

    let normalized: string;
    try {
      normalized = normalizePhone(phone);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ success: false, error: errMsg }, { status: 400 });
    }

    autoInit(sk);
    const ready = await waitForWaReady(sk);
    if (!ready.ok) {
      logInternalWaWarn('POST /send-media rejected: client not ready', {
        status: ready.status,
        session_key: sk,
      });
      return NextResponse.json(
        {
          success: false,
          error: `WhatsApp client is not ready. Current status: ${ready.status}`,
          errorType: 'not_ready',
          session_key: sk,
        },
        { status: 400 },
      );
    }

    const messageId = await sendMedia(
      normalized,
      media.base64,
      media.mimeType,
      media.filename,
      caption,
      sk,
    );

    return NextResponse.json({ success: true, messageId, session_key: sk });
  } catch (error: unknown) {
    const msg = describeSendError(error);
    logInternalWaError('POST /send-media failed', error);
    return NextResponse.json(
      {
        success: false,
        error: msg,
        errorType: 'unknown',
        ...internalDebugPayload(error instanceof Error ? error : new Error(msg)),
      },
      { status: 500 },
    );
  }
}

/**
 * Shared pre-flight for contacts/groups routes: auth + wait for ready.
 */
async function requireReadySession(
  request: Request,
  sessionKey: string | null | undefined,
): Promise<{ ok: true; sk: string } | { ok: false; response: NextResponse }> {
  if (!(process.env.LARAVEL_WHATSAPP_SECRET ?? '')) {
    return { ok: false, response: internalMisconfigured() };
  }
  if (!verifyLaravelWhatsappSecret(request)) {
    return { ok: false, response: internalUnauthorized() };
  }
  const sk = normalizeSessionKey(sessionKey);
  autoInit(sk);
  const ready = await waitForWaReady(sk);
  if (!ready.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: `WhatsApp client is not ready. Current status: ${ready.status}`,
          errorType: 'not_ready',
          session_key: sk,
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, sk };
}

export async function handleInternalListContacts(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const sessionKey = url.searchParams.get('session_key');
  const search = url.searchParams.get('search') ?? undefined;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Math.max(1, Math.min(1000, parseInt(limitRaw, 10) || 0)) : undefined;

  const gate = await requireReadySession(request, sessionKey);
  if (!gate.ok) return gate.response;

  try {
    const contacts = await listContacts(gate.sk, search, limit);
    return NextResponse.json({ success: true, session_key: gate.sk, contacts });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logInternalWaError('GET /contacts failed', error);
    return NextResponse.json(
      { success: false, error: msg, ...internalDebugPayload(error) },
      { status: 500 },
    );
  }
}

export async function handleInternalListGroups(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const sessionKey = url.searchParams.get('session_key');

  const gate = await requireReadySession(request, sessionKey);
  if (!gate.ok) return gate.response;

  try {
    const groups = await listGroups(gate.sk);
    return NextResponse.json({ success: true, session_key: gate.sk, groups });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logInternalWaError('GET /groups failed', error);
    return NextResponse.json(
      { success: false, error: msg, ...internalDebugPayload(error) },
      { status: 500 },
    );
  }
}

export async function handleInternalCreateGroup(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name, participants, session_key } = body as {
      name?: string;
      participants?: string[];
      session_key?: string;
    };

    if (!name || !Array.isArray(participants) || participants.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: name and participants[] are required.' },
        { status: 400 },
      );
    }

    const gate = await requireReadySession(request, session_key);
    if (!gate.ok) return gate.response;

    const normalizedParticipants: string[] = [];
    for (const p of participants) {
      try {
        normalizedParticipants.push(normalizePhone(p));
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          { success: false, error: `Invalid participant "${p}": ${errMsg}` },
          { status: 400 },
        );
      }
    }

    const result = await createGroup(name, normalizedParticipants, gate.sk);
    return NextResponse.json({ success: true, session_key: gate.sk, group: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logInternalWaError('POST /groups/create failed', error);
    return NextResponse.json(
      { success: false, error: msg, ...internalDebugPayload(error) },
      { status: 500 },
    );
  }
}

export async function handleInternalAddGroupParticipants(
  request: Request,
  groupId: string,
): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { participants, session_key } = body as {
      participants?: string[];
      session_key?: string;
    };

    if (!groupId || !Array.isArray(participants) || participants.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: groupId path and participants[] body are required.' },
        { status: 400 },
      );
    }

    const gate = await requireReadySession(request, session_key);
    if (!gate.ok) return gate.response;

    const normalizedParticipants: string[] = [];
    for (const p of participants) {
      try {
        normalizedParticipants.push(normalizePhone(p));
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          { success: false, error: `Invalid participant "${p}": ${errMsg}` },
          { status: 400 },
        );
      }
    }

    const result = await addGroupParticipants(groupId, normalizedParticipants, gate.sk);
    return NextResponse.json({ success: true, session_key: gate.sk, result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logInternalWaError('POST /groups/:id/participants failed', error);
    return NextResponse.json(
      { success: false, error: msg, ...internalDebugPayload(error) },
      { status: 500 },
    );
  }
}

export async function handleInternalRemoveGroupParticipants(
  request: Request,
  groupId: string,
): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const { participants, session_key } = body as {
      participants?: string[];
      session_key?: string;
    };

    if (!groupId || !Array.isArray(participants) || participants.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: groupId path and participants[] body are required.' },
        { status: 400 },
      );
    }

    const gate = await requireReadySession(request, session_key);
    if (!gate.ok) return gate.response;

    const normalizedParticipants: string[] = [];
    for (const p of participants) {
      try {
        normalizedParticipants.push(normalizePhone(p));
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          { success: false, error: `Invalid participant "${p}": ${errMsg}` },
          { status: 400 },
        );
      }
    }

    const result = await removeGroupParticipants(groupId, normalizedParticipants, gate.sk);
    return NextResponse.json({ success: true, session_key: gate.sk, result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logInternalWaError('DELETE /groups/:id/participants failed', error);
    return NextResponse.json(
      { success: false, error: msg, ...internalDebugPayload(error) },
      { status: 500 },
    );
  }
}

export async function handleInternalHealth(request: Request): Promise<NextResponse> {
  if (!(process.env.LARAVEL_WHATSAPP_SECRET ?? '')) {
    return internalMisconfigured();
  }
  if (!verifyLaravelWhatsappSecret(request)) {
    return internalUnauthorized();
  }

  const url = new URL(request.url);
  const sk = normalizeSessionKey(url.searchParams.get('session_key'));
  autoInit(sk);
  const includeQr = url.searchParams.get('include_qr') === '1';
  const status = getStatus(sk);

  let qr: string | null | undefined;
  if (includeQr) {
    const qrString = getQR(sk);
    qr = qrString ? await QRCode.toDataURL(qrString) : null;
  }

  const effectiveStatus = isSessionReady(sk) ? 'ready' : status;

  return NextResponse.json({
    success: true,
    whatsapp: effectiveStatus,
    info: getClientInfo(sk),
    session_key: sk,
    ...(includeQr ? { qr } : {}),
  });
}
