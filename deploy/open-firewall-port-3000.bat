@echo off
REM فتح المنفذ 3000 وارداً في جدار حماية Windows — شغّل "Run as administrator"
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 (
  echo يجب تشغيل هذا الملف كمسؤول: زر يمين ^> Run as administrator
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="SendStack TCP 3000" >nul 2>&1
netsh advfirewall firewall add rule name="SendStack TCP 3000" dir=in action=allow protocol=TCP localport=3000
echo.
echo تم السماح بالوارد على TCP 3000. جرّب من جهاز آخر: http://YOUR_PUBLIC_IP:3000/dashboard
echo.
pause
