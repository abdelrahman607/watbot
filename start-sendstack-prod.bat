@echo off
chcp 65001 >nul
title SendStack — إنتاج محلي (Windows)
cd /d "%~dp0"

echo.
echo  [SendStack] بناء ثم تشغيل إنتاج — للاختبار على Windows قبل VPS
echo  المجلد: %CD%
echo.

if not exist "node_modules\" (
  echo  تثبيت الاعتماديات...
  call npm install
  if errorlevel 1 exit /b 1
)

echo  npm run build...
call npm run build
if errorlevel 1 exit /b 1

set NODE_ENV=production
set PORT=3000
echo.
echo  يعمل على http://localhost:%PORT% — أوقف بالضغط Ctrl+C
echo.

call npm run start
pause
