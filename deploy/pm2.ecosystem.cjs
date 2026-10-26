/**
 * PM2 على VPS (Linux أو Windows Server):
 *   npm i -g pm2
 *   npm ci && npm run build
 *   pm2 start deploy/pm2.ecosystem.cjs
 *   pm2 save && pm2 startup
 *
 * Windows: انظر deploy/README-windows-vps.md
 * Linux: cwd مثال /var/www/sendstack
 */
const path = require('path');
const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'sendstack',
      cwd: root,
      script: 'npm',
      args: 'run start',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // env_file غير مدعوم مباشرة — ضع المتغيرات في .env.production.local وحمّلها يدوياً أو استخدم dotenv-cli
    },
    // عامل صف واتساب (اختياري): يشغّل فقط إن عرّفت LARAVEL_DATABASE_URL في البيئة
    // {
    //   name: 'sendstack-outbox',
    //   cwd: root,
    //   script: 'scripts/whatsapp-outbox-worker.mjs',
    //   interpreter: 'node',
    //   instances: 1,
    //   autorestart: true,
    // },
  ],
};
