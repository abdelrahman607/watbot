# نشر SendStack على VPS

- **Windows Server** → [`README-windows-vps.md`](README-windows-vps.md) (Chrome، PM2، جدار الحماية، `deploy\windows-vps-build.bat`).
- **Linux** → الأقسام التالية.

---

## Linux — 1) تثبيت النظام (Ubuntu/Debian)

```bash
chmod +x deploy/vps-install-debian.sh
./deploy/vps-install-debian.sh
```

ثبّت Node 20+ من [NodeSource](https://github.com/nodesource/distributions) إن لزم.

## Linux — 2) المشروع

```bash
cd /var/www/sendstack   # أو مسارك
git clone <repo> .      # أو رفع الملفات
cp deploy/env.vps.example .env.production.local
nano .env.production.local   # LARAVEL_WHATSAPP_SECRET، PUPPETEER_EXECUTABLE_PATH، إلخ
```

تأكد من `PUPPETEER_EXECUTABLE_PATH` (غالباً `/usr/bin/chromium` أو `chromium-browser`).

## Linux — 3) بناء وتشغيل

```bash
export SKIP_PUPPETEER_CHROME=1   # إن استخدمت chromium النظامي
npm ci
npm run build
chmod +x deploy/vps-start.sh
./deploy/vps-start.sh
```

أو مع **PM2**:

```bash
npm i -g pm2
pm2 start deploy/pm2.ecosystem.cjs
pm2 save
pm2 startup
```

## Linux — 4) جدار ناري / Nginx

- افتح المنفذ `3000` أو ضع **Nginx** كـ reverse proxy إلى `127.0.0.1:3000`.
- Laravel يجب أن يشير إلى `https://your-vps-domain` في `SENDSTACK_BASE_URL`.
- **لا تستخدم `169.254.x.x` كرابط عام** — هذا نطاق link-local ولا يصل من الإنترنت؛ استخدم IPv4 العام أو الدومين من لوحة المزوّد.

## Linux — 5) systemd (بديل PM2)

انظر `sendstack.service.example` وعدّل `User` و`WorkingDirectory` و`ExecStart`.
