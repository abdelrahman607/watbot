# نشر SendStack على VPS بنظام Windows Server

## المتطلبات

1. **Node.js 20 LTS** — من [nodejs.org](https://nodejs.org/) (وضع التثبيت يضيف `npm` وغالباً يضيفه لـ PATH).
2. **Google Chrome** (مُستحسن لواتساب عبر Puppeteer) — ثبّت Chrome للنظام وحدّث `PUPPETEER_EXECUTABLE_PATH` في `.env.production.local` إن لزم. يمكن الاعتماد على Chrome الذي يحمّله Puppeteer مع `npm install` إن لم تضبط المسار.
3. **جدار الحماية Windows** — اسمح بالوارد على المنفذ الذي تستخدمه (مثلاً **3000**) أو ضع **IIS** كـ reverse proxy إلى `http://127.0.0.1:3000`.

## الوصول العام من الإنترنت (`/dashboard` وغيره)

`npm run start` يستمع على **جميع الواجهات** (`0.0.0.0`) مع إعداد المشروع الحالي؛ المشكلة الشائعة ليست Next.js بل **العنوان** و**الجدار**.

### عنوان `169.254.x.x` ليس عاماً

النطاق **169.254.0.0/16** (مثل `169.254.55.158`) هو **link-local / APIPA**: لا يُوجَّه عبر الإنترنت، ولا يصل إليه الزوار من خارج نفس الرابط الافتراضي في أغلب الحالات. لرابط يعمل من أي مكان:

1. من لوحة مزوّد الـ VPS أو من السيرفر، اعرف **IPv4 العام** (مثلاً ما يظهر في لوحة Azure / AWS / Hostinger / إلخ)، أو دوميناً يشير إليه.
2. افتح المتصفح من جهاز خارجي: `http://YOUR_PUBLIC_IP:3000/dashboard` (أو HTTPS خلف IIS إن ركّبت شهادة).

لمعرفة الـ IP العام من السيرفر (تقريبي): PowerShell `Invoke-RestMethod -Uri https://api.ipify.org`

### فتح المنفذ 3000 في Windows

- **تشغيل كمسؤول:** نفّذ `deploy\open-firewall-port-3000.bat`  
  أو يدوياً: Windows Defender Firewall → Inbound Rules → New Rule → Port → TCP 3000 → Allow.

### سحابة / VPS

إن كان السيرفر خلف **Security Group / NSG / جدار مزوّد الخدمة**، أضف قاعدة **Inbound TCP 3000** (أو المنفذ الذي تستخدمه) للمصدر `0.0.0.0/0` أو لعناوين محددة حسب سياسة الأمان.

## إعداد المشروع

1. انسخ المشروع إلى مجلد ثابت، مثلاً `C:\apps\sendstack`.
2. انسخ ملف البيئة:
   ```bat
   copy deploy\env.vps.windows.example .env.production.local
   ```
3. عدّل `.env.production.local`: `LARAVEL_WHATSAPP_SECRET`، `SENDSTACK_INTERNAL_URL`، ومسار Chrome إن لزم.

## البناء

من **موجه الأوامر** في جذر المشروع (أو شغّل):

```bat
deploy\windows-vps-build.bat
```

## التشغيل

### نافذة تفاعلية (اختبار)

من جذر المشروع:

```bat
start-sendstack-prod.bat
```

أو بعد البناء مرة واحدة:

```bat
set NODE_ENV=production
set PORT=3000
npm run start
```

### تشغيل دائم (مُفضّل على السيرفر) — PM2

```bat
npm i -g pm2
cd C:\apps\sendstack
pm2 start deploy\pm2.ecosystem.cjs
pm2 save
```

للتشغيل التلقائي بعد إعادة تشغيل Windows، اتبع تعليمات `pm2 startup` التي يعرضها PM2 (على Windows غالباً تتضمن جدولة مهمة أو حزمة إضافية؛ راجع [وثائق PM2](https://pm2.keymetrics.io/docs/usage/startup/)).

بديل: **NSSM** (Non-Sucking Service Manager) لتشغيل `deploy\vps-start-windows.bat` أو `node_modules\.bin\next.cmd start` كخدمة Windows.

### سكربت تشغيل بدون `pause`

للاستخدام مع أدوات الخدمة:

```bat
deploy\vps-start-windows.bat
```

## Laravel

في `.env` لدى Laravel عيّن `SENDSTACK_BASE_URL` إلى عنوان يصل إليه السيرفر (مثلاً `http://IP:3000` أو `https://subdomain.example.com` خلف IIS/SSL).

## ملفات مرتبطة

| ملف | الاستخدام |
|-----|-----------|
| `deploy\env.vps.windows.example` | قالب `.env.production.local` |
| `deploy\windows-vps-build.bat` | `npm ci`/`install` + `npm run build` |
| `deploy\vps-start-windows.bat` | `npm run start` بعد البناء |
| `deploy\open-firewall-port-3000.bat` | فتح TCP 3000 وارداً (كمسؤول) |
| `deploy\pm2.ecosystem.cjs` | تعريف عملية PM2 (يعمل على Windows) |
| `start-sendstack.bat` | وضع تطوير محلي |
| `start-sendstack-prod.bat` | بناء + تشغيل إنتاج (مع `pause`) |

للنشر على **Linux** انظر `deploy/README.md`.
