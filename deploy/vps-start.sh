#!/usr/bin/env bash
# تشغيل إنتاج من جذر المشروع على VPS (بعد npm ci && npm run build)
# Next.js يحمّل .env.production.local تلقائياً عند NODE_ENV=production
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3000}"

exec npm run start
