/**
 * وضع API فقط: استبدال واجهة الداشبورد الثقيلة (SENDSTACK_API_ONLY=1).
 * الإرسال والربط من Laravel أو أي عميل HTTP.
 */
export default function ApiOnlyDashboard() {
  const endpoints = [
    { m: 'POST', path: '/api/internal/whatsapp/send', note: 'Body: { phone, message }' },
    { m: 'POST', path: '/api/internal/whatsapp/send-batch', note: 'Body: { items: [{ phone, message }] } max 50' },
    { m: 'GET', path: '/api/internal/whatsapp/health?include_qr=1', note: 'Status + optional QR data URL' },
    { m: 'GET', path: '/api/internal/whatsapp/qr', note: 'QR only' },
    { m: 'POST', path: '/api/internal/whatsapp/sessions/connect', note: 'Body: { force_qr?: boolean }' },
  ];

  return (
    <div className="page-wrapper">
      <main className="page-content" style={{ padding: '2rem', maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>SendStack — API only</h1>
        <p style={{ color: 'var(--text-secondary, #666)', marginBottom: 24, lineHeight: 1.5 }}>
          <code>SENDSTACK_API_ONLY=1</code> — واجهة الرفع/الإرسال في المتصفح معطّلة. استخدم لوحة Laravel أو curl مع
          الهيدر <code style={{ fontSize: 12 }}>X-Whatsapp-Secret</code> (نفس <code>LARAVEL_WHATSAPP_SECRET</code>).
        </p>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>مسارات Laravel الداخلية</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {endpoints.map((e) => (
            <li
              key={e.path}
              style={{
                border: '1px solid var(--border-light, #e5e5e5)',
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 10,
                fontSize: 14,
              }}
            >
              <strong>{e.m}</strong>{' '}
              <code dir="ltr" style={{ fontSize: 13 }}>
                {e.path}
              </code>
              <div style={{ marginTop: 6, color: 'var(--text-tertiary, #888)', fontSize: 12 }}>{e.note}</div>
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 24, fontSize: 13, color: 'var(--text-tertiary, #888)' }}>
          للأخطاء 500: راجع سجل عملية Node (<code>pm2 logs</code>). للتفاصيل في الاستجابة مؤقتاً:{' '}
          <code>INTERNAL_WHATSAPP_DEBUG=1</code> (لا تستخدم على الإنترنت العام).
        </p>
      </main>
    </div>
  );
}
