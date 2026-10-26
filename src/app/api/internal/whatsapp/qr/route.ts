import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import {
  verifyLaravelWhatsappSecret,
  internalUnauthorized,
  internalMisconfigured,
} from '@/lib/internal-whatsapp';
import { logInternalWaError } from '@/lib/internal-whatsapp-log';
import { getQR, getStatus, getClientInfo, autoInit, normalizeSessionKey } from '@/lib/whatsapp-client';

/**
 * GET /api/internal/whatsapp/qr
 * Header: X-Whatsapp-Secret (same as other internal routes)
 * Returns QR data URL for embedding in Laravel admin while linking the number.
 */
export async function GET(request: Request) {
  if (!(process.env.LARAVEL_WHATSAPP_SECRET ?? '')) {
    return internalMisconfigured();
  }
  if (!verifyLaravelWhatsappSecret(request)) {
    return internalUnauthorized();
  }

  try {
    const url = new URL(request.url);
    const sk = normalizeSessionKey(url.searchParams.get('session_key'));
    autoInit(sk);
    const status = getStatus(sk);
    const qrString = getQR(sk);

    if (!qrString) {
      return NextResponse.json({
        success: true,
        qr: null,
        status,
        info: getClientInfo(sk),
        session_key: sk,
      });
    }

    const qrDataUrl = await QRCode.toDataURL(qrString);
    return NextResponse.json({
      success: true,
      qr: qrDataUrl,
      status,
      info: getClientInfo(sk),
      session_key: sk,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logInternalWaError('GET /internal/whatsapp/qr failed', error);
    return NextResponse.json(
      { success: false, qr: null, status: getStatus(), error: message },
      { status: 500 }
    );
  }
}
