<p align="center">
  <img src="public/logo.svg" alt="SendStack" width="80" height="80" />
</p>

<h1 align="center">SendStack</h1>

<p align="center" dir="rtl">
  <strong>إرسال رسائل واتساب لستوريدج</strong><br/>
  <span style="font-size:0.9em;opacity:0.85">نسخة خاصة — تكامل Laravel (واجهة <code>/api/internal/whatsapp/*</code>) وعامل صف الانتظار</span>
</p>

<p align="center">
  <strong>Free, open-source bulk email & WhatsApp messaging platform</strong><br/>
  Upload a CSV, personalize with template variables, hit send. No sign-up, no fees, fully offline.
</p>

<p align="center">
  <a href="https://sender.qobouli.com">Live App</a> &bull;
  <a href="https://sender.qobouli.com/about">About</a> &bull;
  <a href="https://sender.qobouli.com/faq">FAQ</a> &bull;
  <a href="https://sender.qobouli.com/privacy">Privacy</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
  <img src="https://img.shields.io/badge/price-free-brightgreen" alt="Free" />
  <img src="https://img.shields.io/badge/platform-web%20%2B%20chrome-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/languages-EN%20%7C%20AR%20%7C%20TR-orange" alt="Languages" />
</p>

---

## What is SendStack?

SendStack lets you send personalized bulk emails and WhatsApp messages to hundreds of contacts. Upload a CSV with your recipient data, write a message template with `{{variables}}`, configure your sending channel, and go.

**Two ways to send:**

| | Web App | Chrome Extension |
|---|---------|-----------------|
| **How** | Full dashboard at [sender.qobouli.com](https://sender.qobouli.com) | Sidebar inside Gmail & WhatsApp Web |
| **Email** | Any SMTP (Gmail, iCloud+, Outlook, custom) | Gmail compose automation |
| **WhatsApp** | QR code pairing via whatsapp-web.js | Direct WhatsApp Web messaging |
| **Backend** | Self-hosted Node.js server | Zero backend (100% browser) |

## Features

- **CSV Upload** — Drag and drop. Columns auto-detected for email, phone, name
- **Template Variables** — `{{Name}}`, `{{Company}}`, or any CSV column header
- **Spin Syntax** — `{Hello|Hi|Hey}` gives each recipient a random variant
- **Anti-Ban Protection** — Configurable delays, jitter, batch cool-downs, daily limits
- **Live Progress** — Real-time sent/failed/skipped counters, cancel anytime
- **WhatsApp Media** — Send images, PDFs, documents (up to 16MB)
- **Message Delivery Tracking** — Pending, sent, delivered, read status for WhatsApp
- **100% Offline** — No analytics, no tracking, no external servers. Data stays on your device
- **Multilingual** — English, Arabic (RTL), Turkish
- **Open Source** — Full source code, no hidden anything

## Quick Start

```bash
# Clone
git clone https://github.com/mohamed-arabi16/SendStack.git
cd SendStack

# Install
npm install

# Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, TypeScript 5, Tailwind CSS 4 |
| Email | Nodemailer 8 (SMTP) |
| WhatsApp | whatsapp-web.js 1.34 + Puppeteer |
| CSV | PapaParse 5 |
| Icons | Lucide React |
| Extension | Vite + React + @wppconnect/wa-js |
| Hosting | Vercel |

## Chrome Extension

The Chrome extension lives in `chrome-extension/` with its own build:

```bash
cd chrome-extension
npm install
npm run build
```

Load `chrome-extension/dist/` as an unpacked extension in Chrome.

## Project Structure

```
src/
  app/
    api/          # Email & WhatsApp API routes
    dashboard/    # Main sending interface
    about/        # About page
    faq/          # FAQ page
    privacy/      # Privacy policy
  components/     # UI components
  i18n/           # EN, AR, TR translations
  lib/            # WhatsApp client & utilities
chrome-extension/ # Standalone Chrome extension
public/           # Static assets, robots.txt, llms.txt
```

## Privacy

- No data collection
- No analytics or telemetry
- No accounts or sign-up
- CSV data and credentials stay on your device
- Full [privacy policy](https://sender.qobouli.com/privacy)

## Contributing

Issues and PRs welcome. Open an [issue](https://github.com/mohamed-arabi16/SendStack/issues) to report bugs or request features.

## License

MIT

---

## Production: Chrome / Puppeteer (Hostinger, VPS, Linux)

`whatsapp-web.js` يشغّل **Chrome** عبر Puppeteer. إذا ظهر في السجلات `Could not find Chrome`:

1. **VPS / خادم Linux (مُفضّل)**  
   - سكربت تثبيت أولي: `./deploy/vps-install-debian.sh` — تفاصيل كاملة في **`deploy/README.md`**.  
   - نسخة متغيرات البيئة: `deploy/env.vps.example` → `.env.production.local`.  
   - عيّن `PUPPETEER_EXECUTABLE_PATH` لمسار Chromium النظامي (تحقق بـ `which chromium` أو `which chromium-browser`).  
   - على **Windows** (محلي أو **VPS Windows Server**): **`start-sendstack.bat`** (تطوير)، **`start-sendstack-prod.bat`** (بناء + إنتاج)، ودليل السيرفر **`deploy/README-windows-vps.md`**.

2. **استضافة Node مشتركة (مثل Hostinger “Website” Node)**  
   - غالباً **لا يوجد Chrome** ولا يُسمح بتشغيل متصفح كامل — التنزيل التلقائي قد يفشل أو لا يُنفَّذ أثناء البناء.  
   - الحل العملي: نقل تطبيق واتساب إلى **VPS** (Hostinger VPS أو أي سيرفر يدعم Chromium)، أو تشغيل SendStack في **Docker** مع صورة فيها Chrome.

3. **بعد `npm install`**  
   - يشغّل المشروع `scripts/install-puppeteer-chrome.cjs` لتنزيل Chrome الخاص بـ Puppeteer.  
   - لتعطيل التنزيل: `SKIP_PUPPETEER_CHROME=1` ثم عيّن `PUPPETEER_EXECUTABLE_PATH` لمسار Chromium النظامي.

4. **تقليل تكرار الأخطاء في السجلات**  
   - بعد التحديث، إعادة محاولة الاتصال التلقائي تُؤجَّل **دقيقتين** بعد فشل التهيئة (قابل للتعديل بـ `WHATSAPP_AUTOINIT_COOLDOWN_MS`).

5. **DBus / `pthread_create: Resource temporarily unavailable`**  
   - على استضافة مشتركة غالباً لا يوجد `/run/dbus/...`؛ الكود يضبط `DBUS_SESSION_BUS_ADDRESS` تلقائياً ويمرّر وسيطات Chrome أخف.  
   - إن استمر خطأ **pthread / ulimit**، أضف في البيئة: `WHATSAPP_PUPPETEER_LOW_THREADS=1` (يقلّل عمليات Chrome؛ قد لا يكفي إن الحدّ صارم جداً).  
   - **`ptrace: Operation not permitted`** وحدود الخيوط غالباً تعني أن **VPS** هو الحل الموثوق لتشغيل واتساب كامل.

---

## Laravel integration (internal WhatsApp API)

SendStack exposes **server-only** routes for a Laravel CRM to trigger sends using the same WhatsApp session as the dashboard.

### Environment

| Variable | Description |
|----------|-------------|
| `LARAVEL_WHATSAPP_SECRET` | Shared secret; must match Laravel `SENDSTACK_INTERNAL_SECRET`. Requests must send header `X-Whatsapp-Secret: <secret>`. |

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/internal/whatsapp/send` | Body: `{ "phone": "9665...", "message": "..." }` |
| `POST` | `/api/internal/whatsapp/send-batch` | Body: `{ "items": [{ "phone", "message" }, ...] }` (max 50) |
| `POST` | `/api/internal/whatsapp/sessions/connect` | Optional body `{ "force_qr": true }` to reset session; starts / reconnects client |
| `GET` | `/api/internal/whatsapp/health` | JSON: `whatsapp` status + `info`. Add query `?include_qr=1` to include `qr` (data URL) while status is `qr`. |
| `GET` | `/api/internal/whatsapp/qr` | JSON: `qr` (data URL or null), `status`, `info` — للوحة Laravel لعرض رمز الربط |

### API-only mode (no browser dashboard UI)

Set **`SENDSTACK_API_ONLY=1`** on the SendStack host. Then **`/dashboard`** shows a short list of internal endpoints instead of the CSV/email/WhatsApp web UI. Use **Laravel** (or curl) for sends and session control. Static reference page: **`/api-info`**.

### Logging & debugging 500 on `/send`

- **Node:** failures on internal routes log to stderr as `[SendStack Internal WhatsApp] …` with **message + stack** (`console.error`).
- **`INTERNAL_WHATSAPP_DEBUG=1`:** JSON error responses also include a `debug.stack` field (use only on trusted networks).
- **Laravel:** failed SendStack calls are written to **`storage/logs/laravel.log`** via `Log::warning` (HTTP status + response body + `error` / `errorType` from SendStack).

### Outbox worker (DB bridge)

If Laravel queues failed sends in `whatsapp_outbox`, run the worker on the SendStack host (needs MySQL access to the Laravel database):

```bash
export LARAVEL_WHATSAPP_SECRET=your-secret
export SENDSTACK_INTERNAL_URL=http://127.0.0.1:3000
export LARAVEL_DB_HOST=127.0.0.1
export LARAVEL_DB_USER=...
export LARAVEL_DB_PASSWORD=...
export LARAVEL_DB_DATABASE=...
npm run whatsapp-outbox-worker
```

Or use `LARAVEL_DATABASE_URL=mysql://user:pass@host:3306/dbname`.

Requires MySQL 8+ for `FOR UPDATE SKIP LOCKED` (or adjust the query for MariaDB).

### ربط الرقم من Laravel (مثال جاهز)

انسخ الملفات من **`examples/laravel/`** إلى مشروع Laravel (خدمة HTTP، Controller، مسارات، Blade). السر لا يُرسل للمتصفح؛ Laravel يستدعي SendStack من الخادم فقط.

---

<p align="center">
  Built by <a href="https://mk.qobouli.com"><strong>Qobouli AI & Dev</strong></a> in Istanbul
</p>
