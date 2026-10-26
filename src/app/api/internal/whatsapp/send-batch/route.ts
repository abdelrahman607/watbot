import { NextResponse } from 'next/server';
import {
  verifyLaravelWhatsappSecret,
  internalUnauthorized,
  internalMisconfigured,
  waitForWaReady,
} from '@/lib/internal-whatsapp';
import { logInternalWaError, logInternalWaWarn } from '@/lib/internal-whatsapp-log';
import {
  describeSendError,
  sendMessage,
  normalizePhone,
  normalizeSessionKey,
  autoInit,
  isSessionReady,
  getStatus,
} from '@/lib/whatsapp-client';

type BatchItem = { phone: string; message: string };

export async function POST(request: Request) {
  if (!(process.env.LARAVEL_WHATSAPP_SECRET ?? '')) {
    return internalMisconfigured();
  }
  if (!verifyLaravelWhatsappSecret(request)) {
    return internalUnauthorized();
  }

  try {
    const body = await request.json();
    const { items, session_key } = body as { items?: BatchItem[]; session_key?: string };
    const sk = normalizeSessionKey(session_key);

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ success: false, error: 'items[] required' }, { status: 400 });
    }

    if (items.length > 50) {
      return NextResponse.json({ success: false, error: 'Max 50 items per batch' }, { status: 400 });
    }

    autoInit(sk);
    const ready = await waitForWaReady(sk);
    if (!ready.ok) {
      logInternalWaWarn('POST /send-batch rejected: not ready', {
        status: ready.status,
        itemCount: items.length,
        session_key: sk,
      });
      return NextResponse.json(
        {
          success: false,
          error: `WhatsApp client is not ready: ${ready.status}`,
          errorType: 'not_ready',
          session_key: sk,
        },
        { status: 400 }
      );
    }

    const results: { phone: string; ok: boolean; messageId?: string; error?: string }[] = [];

    for (const item of items) {
      try {
        if (!item.phone || !item.message) {
          results.push({ phone: item.phone ?? '', ok: false, error: 'missing phone or message' });
          continue;
        }
        if (!isSessionReady(sk)) {
          results.push({
            phone: item.phone,
            ok: false,
            error: `WhatsApp client is not ready (status: ${getStatus(sk)})`,
          });
          continue;
        }
        const normalized = normalizePhone(item.phone);
        const messageId = await sendMessage(normalized, item.message, sk);
        results.push({ phone: normalized, ok: true, messageId });
      } catch (e: unknown) {
        const msg = describeSendError(e);
        logInternalWaError('POST /send-batch item failed', e, { phone: String(item.phone).slice(0, 6) + '…' });
        results.push({ phone: item.phone, ok: false, error: msg });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logInternalWaError('POST /send-batch fatal', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
