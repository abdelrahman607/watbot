@echo off
REM تشغيل إنتاج من جذر المشروع (بعد npm run build). بدون pause — مناسب لـ PM2 أو جدولة المهام.
chcp 65001 >nul
cd /d "%~dp0.."

if not exist ".next\BUILD_ID" (
  echo [SendStack] خطأ: مجلد البناء غير موجود. نفّذ أولاً: deploy\windows-vps-build.bat
  exit /b 1
)

if not defined NODE_ENV set NODE_ENV=production
if not defined PORT set PORT=3000

call npm run start
