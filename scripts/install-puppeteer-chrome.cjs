#!/usr/bin/env node
/**
 * Downloads Puppeteer's Chrome during npm install (needed on servers without system Chromium).
 * Set SKIP_PUPPETEER_CHROME=1 to skip (then set PUPPETEER_EXECUTABLE_PATH to system chrome).
 */
if (process.env.SKIP_PUPPETEER_CHROME === '1') {
  console.log('[SendStack] SKIP_PUPPETEER_CHROME=1 — skipping Chrome download');
  process.exit(0);
}

const { execSync } = require('child_process');
try {
  execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
} catch {
  console.warn(
    '[SendStack] Puppeteer Chrome install failed. On production set PUPPETEER_EXECUTABLE_PATH (e.g. /usr/bin/chromium) or run: npx puppeteer browsers install chrome'
  );
  process.exit(0);
}
