#!/usr/bin/env bash
# تثبيت أولي على Ubuntu/Debian VPS (يحتاج sudo)
set -euo pipefail

echo "==> تحديث الحزم"
sudo apt-get update

echo "==> Chromium + خطوط أساسية (headless)"
# أسماء الحزم تختلف بين الإصدارات؛ جرّب chromium-browser ثم chromium
sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium
sudo apt-get install -y fonts-liberation ca-certificates || true

if command -v chromium-browser >/dev/null 2>&1; then
  echo "Chromium: $(command -v chromium-browser)"
elif command -v chromium >/dev/null 2>&1; then
  echo "Chromium: $(command -v chromium)"
else
  echo "تحذير: لم يُعثر على chromium في PATH — ثبّته يدوياً."
fi

echo ""
echo "==> Node.js 20 LTS (إن لم يكن مثبتاً):"
echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
echo "    sudo apt-get install -y nodejs"
echo ""
echo "==> في مجلد المشروع:"
echo "    cp deploy/env.vps.example .env.production.local   # ثم عدّل القيم"
echo "    export SKIP_PUPPETEER_CHROME=1"
echo "    npm ci && npm run build"
echo "    ./deploy/vps-start.sh   أو   pm2 start deploy/pm2.ecosystem.cjs"
echo ""
echo "تفاصيل: deploy/README.md"
