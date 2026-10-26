@echo off
REM بناء SendStack على Windows Server (من جذر المشروع تلقائياً)
chcp 65001 >nul
cd /d "%~dp0.."

echo [SendStack] المجلد: %CD%
echo.

if not exist "node_modules\" (
  echo تثبيت الاعتماديات...
  if exist "package-lock.json" (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 exit /b 1
)

echo npm run build...
call npm run build
if errorlevel 1 exit /b 1

echo.
echo اكتمل البناء. للتشغيل:
echo   - نافذة تفاعلية: start-sendstack-prod.bat أو: npm run start
echo   - خلفية: npm i -g pm2 ثم من جذر المشروع: pm2 start deploy\pm2.ecosystem.cjs
echo.
exit /b 0
