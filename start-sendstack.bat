@echo off
setlocal
chcp 65001 >nul 2>&1
title SendStack Dev
cd /d "%~dp0"

echo.
echo [SendStack] Development mode (npm run dev)
echo Folder: %CD%
echo.

REM Optional: pull latest release from Laravel (see .env.example)
node "%~dp0scripts\pull-release-from-server.mjs"
if errorlevel 1 (
  echo.
  echo [SendStack] Warning: server update failed; continuing with local copy.
  if /i "%SENDSTACK_UPDATE_STRICT%"=="1" exit /b 1
  echo.
)

if not exist "node_modules\" (
  echo Installing dependencies...
  set PUPPETEER_SKIP_DOWNLOAD=true
  set SKIP_PUPPETEER_CHROME=1
  call npm install --ignore-scripts
  if errorlevel 1 exit /b 1
)

call npm run dev
pause
