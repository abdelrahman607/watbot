/**
 * سحب آخر إصدار سورس SendStack من Laravel (جدول project_releases)
 *
 * المصادقة (بالأولوية):
 * 1) LARAVEL_WHATSAPP_SECRET → GET /api/internal/sendstack/project-updates/... + X-Whatsapp-Secret
 * 2) SENDSTACK_UPDATE_API_KEY → GET /api/internal/project-updates/... + x-api-key
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(PROJECT_ROOT, '.sendstack-release-version');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * ترتيب الدمج (الأخير يغلب): .env ← .env.local ← env.txt ← متغيرات النظام
 * يمكنك وضع SENDSTACK_UPDATE_* في env.txt مع بقية أسرارك المحلية.
 */
function mergeEnv() {
  const fromEnv = loadEnvFile(path.join(PROJECT_ROOT, '.env'));
  const fromLocal = loadEnvFile(path.join(PROJECT_ROOT, '.env.local'));
  const fromEnvTxt = loadEnvFile(path.join(PROJECT_ROOT, 'env.txt'));
  return { ...fromEnv, ...fromLocal, ...fromEnvTxt, ...process.env };
}

function resolveUpdateBaseUrl(env) {
  const raw =
    env.SENDSTACK_UPDATE_BASE_URL ||
    env.STORAGE_APP_URL ||
    env.APP_URL ||
    '';
  return String(raw).replace(/\/+$/, '');
}

/** نفس توكن Laravel Internal API (x-api-key) — أسماء بديلة */
function resolveUpdateApiKey(env) {
  return (
    env.SENDSTACK_UPDATE_API_KEY ||
    env.STORAGE_INTERNAL_API_KEY ||
    env.LARAVEL_INTERNAL_API_KEY ||
    ''
  );
}

/** نفس SENDSTACK_INTERNAL_SECRET في Laravel — يُفضَّل على توكن API */
function resolveWhatsappSecret(env) {
  return (
    env.LARAVEL_WHATSAPP_SECRET ||
    env.SENDSTACK_INTERNAL_SECRET ||
    ''
  );
}

function readLocalVersion() {
  try {
    return fs.readFileSync(VERSION_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function skipDirs(name) {
  return (
    name === 'node_modules' ||
    name === '.next' ||
    name === '.git' ||
    name === '.wwebjs_auth' ||
    name === '.wwebjs_cache'
  );
}

function copyUpdateTree(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (s) => {
      const rel = path.relative(src, s);
      if (!rel) return true;
      const seg = rel.split(path.sep);
      if (seg.some((x) => skipDirs(x))) return false;
      const base = seg[seg.length - 1];
      if (base === '.env' || base === '.env.local') return false;
      return true;
    },
  });
}

function resolveExtractRoot(extractDir) {
  const entries = fs.readdirSync(extractDir);
  if (entries.length === 1) {
    const one = path.join(extractDir, entries[0]);
    if (fs.statSync(one).isDirectory()) return one;
  }
  return extractDir;
}

function expandZip(zipPath, extractDir) {
  fs.mkdirSync(extractDir, { recursive: true });
  if (process.platform === 'win32') {
    try {
      execFileSync(
        'tar',
        ['-xf', zipPath, '-C', extractDir],
        { stdio: 'inherit', cwd: PROJECT_ROOT }
      );
      return;
    } catch {
      // fallback PowerShell
    }
    const psZip = zipPath.replace(/'/g, "''");
    const psOut = extractDir.replace(/'/g, "''");
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${psZip}' -DestinationPath '${psOut}' -Force`,
      ],
      { stdio: 'inherit' }
    );
    return;
  }
  execFileSync('tar', ['-xf', zipPath, '-C', extractDir], {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
  });
}

async function main() {
  const env = mergeEnv();
  if (env.SENDSTACK_SKIP_SERVER_UPDATE === '1') {
    console.log('[SendStack] تخطّي تحديث السيرفر (SENDSTACK_SKIP_SERVER_UPDATE=1).');
    process.exit(0);
  }

  const baseUrl = resolveUpdateBaseUrl(env);
  const secret = String(resolveWhatsappSecret(env)).trim();
  const apiKey = String(resolveUpdateApiKey(env)).trim();
  const project = env.SENDSTACK_UPDATE_PROJECT || 'sendstack';

  /** مسار يحميه السر المشترك (لا حاجة لتوكن API) */
  const useSharedSecret = secret.length > 0;
  const updatesPrefix = useSharedSecret
    ? '/api/internal/sendstack/project-updates'
    : '/api/internal/project-updates';

  const latestHeaders = useSharedSecret
    ? { 'X-Whatsapp-Secret': secret, Accept: 'application/json' }
    : { 'x-api-key': apiKey, Accept: 'application/json' };

  const downloadHeaders = useSharedSecret
    ? { 'X-Whatsapp-Secret': secret }
    : { 'x-api-key': apiKey };

  if (!baseUrl || (!useSharedSecret && !apiKey)) {
    console.log(
      '[SendStack] لم يُضبط عنوان Laravel أو طريقة المصادقة — تخطّي سحب الإصدار.'
    );
    console.log(
      '  العنوان: SENDSTACK_UPDATE_BASE_URL أو STORAGE_APP_URL (مثل https://storge-ai.com)'
    );
    console.log(
      '  الأفضل: LARAVEL_WHATSAPP_SECRET (نفس SENDSTACK_INTERNAL_SECRET في Laravel) — بدون توكن API.'
    );
    console.log(
      '  بديل: SENDSTACK_UPDATE_API_KEY (x-api-key من لوحة API Tokens، read.server).'
    );
    console.log('  ضع القيم في env.txt أو .env.local — انظر .env.example.');
    process.exit(0);
  }

  const latestUrl = `${baseUrl}${updatesPrefix}/${encodeURIComponent(project)}/latest`;
  console.log(
    `[SendStack] التحقق من آخر إصدار (${project}) عبر ${useSharedSecret ? 'السر المشترك' : 'x-api-key'}…`
  );

  const latestRes = await fetch(latestUrl, {
    headers: latestHeaders,
  });

  if (!latestRes.ok) {
    console.error(
      `[SendStack] فشل طلب latest: HTTP ${latestRes.status} ${latestRes.statusText}`
    );
    process.exit(1);
  }

  const latestJson = await latestRes.json();
  const data = latestJson?.data;
  const remoteVersion = data?.version;
  const downloadUrl = data?.download_url;

  if (!remoteVersion) {
    console.log('[SendStack] لا يوجد إصدار مرفوع لهذا المشروع على السيرفر — تخطّي.');
    process.exit(0);
  }

  const localVersion = readLocalVersion();
  if (localVersion === remoteVersion) {
    console.log(`[SendStack] الإصدار الحالي مُحدَّث (${remoteVersion}).`);
    process.exit(0);
  }

  if (!downloadUrl || typeof downloadUrl !== 'string') {
    console.error('[SendStack] الاستجابة لا تحتوي على download_url.');
    process.exit(1);
  }

  const tmpBase = path.join(
    process.env.TEMP || process.env.TMPDIR || '/tmp',
    'sendstack-update-' + Date.now()
  );
  const zipPath = path.join(tmpBase, 'release.zip');
  const extractDir = path.join(tmpBase, 'extract');
  fs.mkdirSync(tmpBase, { recursive: true });

  try {
    console.log(`[SendStack] تنزيل الإصدار ${remoteVersion}…`);
    const dlRes = await fetch(downloadUrl, {
      headers: downloadHeaders,
      redirect: 'follow',
    });
    if (!dlRes.ok) {
      console.error(
        `[SendStack] فشل التنزيل: HTTP ${dlRes.status} ${dlRes.statusText}`
      );
      process.exit(1);
    }
    const buf = Buffer.from(await dlRes.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    console.log('[SendStack] فك الضغط ودمج الملفات (مع استثناء node_modules و .next و .env)…');
    expandZip(zipPath, extractDir);
    const inner = resolveExtractRoot(extractDir);
    copyUpdateTree(inner, PROJECT_ROOT);
    fs.writeFileSync(VERSION_FILE, remoteVersion + '\n', 'utf8');
    console.log(`[SendStack] تم التحديث إلى الإصدار ${remoteVersion}. شغّل npm install إن لزم.`);
    process.exit(0);
  } finally {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error('[SendStack]', e);
  process.exit(1);
});
