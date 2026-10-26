/**
 * تسجيل أخطاء مسارات WhatsApp الداخلية (Laravel → SendStack).
 * INTERNAL_WHATSAPP_DEBUG=1 يضيف stack في استجابة JSON (لا تفعّله على الإنترنت العام).
 */
export function internalWhatsappDebugResponses(): boolean {
  return process.env.INTERNAL_WHATSAPP_DEBUG === '1';
}

export function logInternalWaWarn(context: string, meta?: Record<string, unknown>): void {
  console.warn(`[SendStack Internal WhatsApp] ${context}`, meta ?? '');
}

export function logInternalWaError(context: string, error: unknown, meta?: Record<string, unknown>): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(`[SendStack Internal WhatsApp] ${context}`, {
    ...meta,
    message: err.message,
    stack: err.stack,
    name: err.name,
  });
}

/** حقول اختيارية تُرجَع في JSON عند INTERNAL_WHATSAPP_DEBUG=1 */
export function internalDebugPayload(error: unknown): { debug?: { name: string; stack?: string } } {
  if (!internalWhatsappDebugResponses() || !(error instanceof Error)) {
    return {};
  }
  return {
    debug: {
      name: error.name,
      stack: error.stack,
    },
  };
}
