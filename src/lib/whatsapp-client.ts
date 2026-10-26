import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client, LocalAuth, MessageMedia, type Message } from 'whatsapp-web.js';
import { emitWebhook } from '@/lib/webhook-emitter';

export type WAStatus = 'disconnected' | 'reconnecting' | 'qr' | 'ready';

/** ACK level from whatsapp-web.js message_ack event */
export type AckStatus = 0 | 1 | 2 | 3;

interface WAClientState {
  client: Client | null;
  status: WAStatus;
  qrString: string | null;
  info: { pushname?: string; wid?: string } | null;
  /** messageId → latest ACK level */
  ackMap: Map<string, AckStatus>;
  /** Last initialization error message, if any */
  lastError: string | null;
  /** Throttle auto-reconnect after failures (e.g. missing Chrome on shared hosting) */
  lastAutoInitFailureAt: number | null;
  /** يمنع تهيئة متوازية متعددة (تسبب Execution context was destroyed) */
  initPromise: Promise<void> | null;
  /** بعد authenticated: يراقب getState() ويُرقّي إلى ready أو يعيد التهيئة */
  readyWatchdog: ReturnType<typeof setInterval> | null;
  /** يمنع جدولة auto-reconnect متكررة بعد disconnect */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

// Use globalThis to survive Next.js hot-reloads in development
declare global {
  var __waClientStates: Record<string, WAClientState> | undefined;
}

/** Root for all LocalAuth folders under os.tmpdir() */
const AUTH_BASE = path.join(os.tmpdir(), '.wwebjs_auth');

/**
 * Normalises Laravel / API session keys for folder names.
 * Default session uses legacy `session` dir (no clientId).
 */
export function normalizeSessionKey(raw?: string | null): string {
  let s = (raw ?? 'default').trim().toLowerCase();
  if (!s) s = 'default';
  s = s.replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!s) s = 'default';
  if (s.length > 64) s = s.slice(0, 64);
  return s;
}

/** Directory LocalAuth uses for this session (Chrome userDataDir). */
export function getSessionDir(sessionKey?: string | null): string {
  const key = normalizeSessionKey(sessionKey);
  return key === 'default' ? path.join(AUTH_BASE, 'session') : path.join(AUTH_BASE, `session-${key}`);
}

export function getState(sessionKey?: string | null): WAClientState {
  const key = normalizeSessionKey(sessionKey);
  if (!globalThis.__waClientStates) {
    globalThis.__waClientStates = Object.create(null) as Record<string, WAClientState>;
  }
  const map = globalThis.__waClientStates;
  if (!map[key]) {
    map[key] = {
      client: null,
      status: 'disconnected',
      qrString: null,
      info: null,
      ackMap: new Map(),
      lastError: null,
      lastAutoInitFailureAt: null,
      initPromise: null,
      readyWatchdog: null,
      reconnectTimer: null,
    };
  }
  const s = map[key];
  if (s.lastAutoInitFailureAt === undefined) s.lastAutoInitFailureAt = null;
  if (s.initPromise === undefined) s.initPromise = null;
  if (s.readyWatchdog === undefined) s.readyWatchdog = null;
  if (s.reconnectTimer === undefined) s.reconnectTimer = null;
  return s;
}

/** True only when Puppeteer client exists and the ready event has fired. */
export function isSessionReady(sessionKey?: string | null): boolean {
  const state = getState(sessionKey);
  return state.status === 'ready' && state.client != null;
}

/** Reset impossible "ready" state left after a crashed client or hot-reload. */
function reconcileStaleReady(sessionKey?: string | null): void {
  const state = getState(sessionKey);
  if (state.status === 'ready' && !state.client) {
    state.status = 'disconnected';
    state.info = null;
    state.qrString = null;
  }
}

export function getStatus(sessionKey?: string | null): WAStatus {
  reconcileStaleReady(sessionKey);
  return getState(sessionKey).status;
}

export function getQR(sessionKey?: string | null): string | null {
  return getState(sessionKey).qrString;
}

export function getClientInfo(sessionKey?: string | null): { pushname?: string; wid?: string } | null {
  return getState(sessionKey).info;
}

/** Returns the last initialization error message, or null if there was no error. */
export function getError(sessionKey?: string | null): string | null {
  return getState(sessionKey).lastError;
}

/** Returns the latest ACK level for a given message ID, or null if not tracked. */
export function getAckStatus(messageId: string, sessionKey?: string | null): AckStatus | null {
  return getState(sessionKey).ackMap.get(messageId) ?? null;
}

/**
 * Returns the full ACK map snapshot as a plain object.
 * Used by the /api/whatsapp/ack route.
 */
export function getAllAcks(sessionKey?: string | null): Record<string, AckStatus> {
  return Object.fromEntries(getState(sessionKey).ackMap.entries());
}

/** Check whether a persisted LocalAuth session exists on disk for this key. */
export function isSessionSaved(sessionKey?: string | null): boolean {
  try {
    return fs.existsSync(getSessionDir(sessionKey));
  } catch {
    return false;
  }
}

/**
 * On Windows, orphaned Chrome processes keep userDataDir locked (EPERM / "browser already running").
 * Prefer killing only Chromium instances whose command line references `.wwebjs_auth`.
 * Use forceAll / WHATSAPP_KILL_ALL_CHROME=1 when locks persist (typical dedicated VPS).
 */
function killOrphanedChromeProcesses(opts?: { forceAll?: boolean }): void {
  if (process.platform !== 'win32') {
    return;
  }

  let targetedOk = false;
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        [
          "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |",
          "  Where-Object { $_.Name -match '^(chrome|chromium)\\.exe$' -and $_.CommandLine -match '\\.wwebjs_auth' };",
          'if ($procs) { $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Output ($procs | Measure-Object).Count } else { Write-Output 0 }',
        ].join(' '),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 },
    );
    const n = parseInt(String(out).trim(), 10);
    if (Number.isFinite(n) && n > 0) {
      console.log(`[WhatsApp] Stopped ${n} orphaned wwebjs Chrome process(es)`);
      targetedOk = true;
    } else {
      targetedOk = true; // PowerShell worked; nothing to kill
    }
  } catch {
    targetedOk = false;
  }

  if (targetedOk && !opts?.forceAll && process.env.WHATSAPP_KILL_ALL_CHROME !== '1') {
    return;
  }

  for (const image of ['chrome.exe', 'chromium.exe']) {
    try {
      execFileSync('taskkill', ['/F', '/IM', image, '/T'], { stdio: 'ignore' });
      console.log(`[WhatsApp] Stopped orphaned ${image} processes`);
    } catch {
      /* no matching processes */
    }
  }
}

function clearReadyWatchdog(state: WAClientState): void {
  if (state.readyWatchdog) {
    clearInterval(state.readyWatchdog);
    state.readyWatchdog = null;
  }
}

function clearReconnectTimer(state: WAClientState): void {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function installWhatsappProcessGuards(): void {
  const g = globalThis as typeof globalThis & { __waProcessGuards?: boolean };
  if (g.__waProcessGuards) return;
  g.__waProcessGuards = true;

  process.on('unhandledRejection', (reason) => {
    const message =
      reason instanceof Error
        ? `${reason.message} ${reason.stack ?? ''}`
        : String(reason ?? '');
    const lower = message.toLowerCase();
    if (
      isTransientInitError(message) ||
      lower.includes('ebusy') ||
      lower.includes('eperm') ||
      lower.includes('resource busy') ||
      lower.includes('first_party_sets') ||
      lower.includes('execution context was destroyed')
    ) {
      console.warn(`[WhatsApp] Suppressed browser noise: ${message.slice(0, 220)}`);
      return;
    }
    console.error('[WhatsApp] unhandledRejection:', reason);
  });
}

/**
 * Remove persisted LocalAuth data for one session only (next init → new QR).
 *
 * On Windows, Chrome may still hold file locks on the userDataDir even after
 * client.destroy().  We work around this by killing Chrome, clearing singleton
 * locks, then rm/rename so the next launch can start clean.
 */
export function clearSavedSessionForSession(sessionKey?: string | null): void {
  const dir = getSessionDir(sessionKey);
  if (!fs.existsSync(dir)) return;

  clearPuppeteerLocks(dir);
  killOrphanedChromeProcesses();

  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EBUSY') {
      killOrphanedChromeProcesses();
      clearPuppeteerLocks(dir);
      const staleDir = `${dir}_stale_${Date.now()}`;
      try {
        fs.renameSync(dir, staleDir);
        console.warn(`[WhatsApp] Session dir locked; renamed to stale: ${staleDir}`);
        setTimeout(() => {
          try {
            fs.rmSync(staleDir, { recursive: true, force: true });
          } catch {
            /* ignore — OS will clean temp dir on reboot */
          }
        }, 15_000);
        return;
      } catch (renameErr) {
        console.warn('[WhatsApp] Could not rename locked session dir:', renameErr);
      }
    }
    console.error('[WhatsApp] Failed to clear session dir:', err);
  }
}

/** @deprecated Prefer clearSavedSessionForSession. Clears only the default session folder. */
export function clearSavedSession(): void {
  clearSavedSessionForSession('default');
}

/**
 * Remove stale Puppeteer singleton lock/socket files left behind by a
 * previous browser instance that was killed without a clean shutdown.
 * Without this cleanup, Puppeteer refuses to launch with
 * "The browser is already running for <path>".
 */
function clearPuppeteerLocks(userDataDir: string): void {
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (const name of lockFiles) {
    const filePath = path.join(userDataDir, name);
    try {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
        console.log(`[WhatsApp] Removed stale lock file: ${filePath}`);
      }
    } catch (err) {
      console.warn(`[WhatsApp] Could not remove lock file ${filePath}:`, err);
    }
  }
}

/** ms between automatic reconnect attempts after a failed init (reduces log spam on bad hosting) */
const AUTO_INIT_FAILURE_COOLDOWN_MS = Number(process.env.WHATSAPP_AUTOINIT_COOLDOWN_MS || 120_000);

/** انتظار بين محاولات إعادة التهيئة بعد أخطاء Puppeteer العابرة */
const INIT_RETRY_DELAY_MS = Number(process.env.WHATSAPP_INIT_RETRY_DELAY_MS || 4000);

const TRANSIENT_INIT_ERRORS = [
  'execution context was destroyed',
  'target closed',
  'session closed',
  'navigation',
  'websocket is not open',
  'browser has disconnected',
  'already running',
  'ebusy',
  'eperm',
  'resource busy',
];

function isTransientInitError(message: string): boolean {
  const m = message.toLowerCase();
  return TRANSIENT_INIT_ERRORS.some((s) => m.includes(s));
}

installWhatsappProcessGuards();

async function destroyClientSafe(client: Client | null): Promise<void> {
  if (!client) return;
  try {
    await client.destroy();
  } catch {
    /* ignore */
  }
  if (process.platform === 'win32') {
    // Chrome often keeps Temp\.wwebjs_auth locks after destroy (EBUSY unlink)
    killOrphanedChromeProcesses();
  }
}

function markClientReady(client: Client, state: WAClientState, sk: string): void {
  if (state.client !== client) return;
  if (state.status === 'ready') return;

  clearReadyWatchdog(state);
  clearReconnectTimer(state);
  state.status = 'ready';
  state.qrString = null;
  state.lastError = null;
  state.lastAutoInitFailureAt = null;
  const info = client.info;
  if (info) {
    state.info = {
      pushname: info.pushname,
      wid: info.wid?.user,
    };
  }
  console.log(`[WhatsApp] Client is ready (${sk})`);
  emitWebhook('session.status', {
    session_key: sk,
    status: 'ready',
    info: state.info,
  });
}

/**
 * After QR scan, whatsapp-web.js sometimes fires `authenticated` but never `ready`
 * (especially after Puppeteer navigation / context destroy). Poll getState() and
 * promote to ready, or force a clean re-init.
 */
function startReadyWatchdog(client: Client, state: WAClientState, sk: string): void {
  clearReadyWatchdog(state);
  const startedAt = Date.now();
  const maxMs = Math.max(
    15_000,
    Math.min(180_000, Number(process.env.WHATSAPP_READY_WATCHDOG_MS || 60_000)),
  );

  state.readyWatchdog = setInterval(() => {
    void (async () => {
      if (state.client !== client) {
        clearReadyWatchdog(state);
        return;
      }
      if (state.status === 'ready') {
        clearReadyWatchdog(state);
        return;
      }

      try {
        const waState = await client.getState();
        if (waState === 'CONNECTED') {
          console.log(`[WhatsApp] Ready watchdog: promoting via getState=CONNECTED (${sk})`);
          markClientReady(client, state, sk);
          return;
        }
      } catch {
        /* page may be mid-navigation */
      }

      if (Date.now() - startedAt < maxMs) {
        return;
      }

      clearReadyWatchdog(state);
      console.warn(`[WhatsApp] Ready watchdog timeout (${sk}) — forcing re-init`);
      state.status = 'disconnected';
      state.qrString = null;
      await destroyClientSafe(client);
      if (state.client === client) {
        state.client = null;
      }
      clearPuppeteerLocks(getSessionDir(sk));
      scheduleAutoReconnect(sk, 2000);
    })();
  }, 2500);
}

function scheduleAutoReconnect(sessionKey: string, delayMs = 3000): void {
  const state = getState(sessionKey);
  clearReconnectTimer(state);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (state.status !== 'disconnected') return;
    if (!isSessionSaved(sessionKey)) return;
    console.log(`[WhatsApp] Auto-reconnecting (${sessionKey})…`);
    autoInit(sessionKey);
  }, delayMs);
}

function attachClientEvents(client: Client, state: WAClientState, sessionKey: string): void {
  const sk = normalizeSessionKey(sessionKey);

  /** Ignore events from a client that was replaced by a newer initialize() call. */
  const isCurrentClient = (): boolean => state.client === client;

  client.on('qr', (qr: string) => {
    if (!isCurrentClient()) return;
    state.qrString = qr;
    state.status = 'qr';
    console.log(`[WhatsApp] QR code received (${sk})`);
    // Emit to Laravel (so the dashboard can show the QR without polling)
    emitWebhook('session.qr', { session_key: sk, qr });
  });

  client.on('authenticated', () => {
    if (!isCurrentClient()) return;
    state.qrString = null;
    // Keep send path waiting (do NOT leave status as `qr` — that rejects immediately)
    if (state.status !== 'ready') {
      state.status = 'reconnecting';
    }
    console.log(`[WhatsApp] Authenticated (${sk})`);
    startReadyWatchdog(client, state, sk);
  });

  client.on('ready', () => {
    if (!isCurrentClient()) return;
    markClientReady(client, state, sk);
  });

  client.on('auth_failure', (msg: string) => {
    if (!isCurrentClient()) return;
    console.error(`[WhatsApp] Auth failure (${sk}):`, msg);
    clearReadyWatchdog(state);
    state.status = 'disconnected';
    state.lastError = msg;
    state.qrString = null;
    state.client = null;
    clearSavedSessionForSession(sk);
    emitWebhook('session.status', {
      session_key: sk,
      status: 'auth_failure',
      error: msg,
    });
  });

  client.on('disconnected', (reason: string) => {
    if (!isCurrentClient()) return;
    const reasonStr = String(reason ?? '');
    clearReadyWatchdog(state);
    state.status = 'disconnected';
    state.qrString = null;
    state.info = null;
    console.log(`[WhatsApp] Disconnected (${sk}):`, reasonStr);
    emitWebhook('session.status', {
      session_key: sk,
      status: 'disconnected',
      reason: reasonStr,
    });

    void (async () => {
      await destroyClientSafe(client);
      if (state.client === client) {
        state.client = null;
      }
      clearPuppeteerLocks(getSessionDir(sk));

      if (/logout/i.test(reasonStr)) {
        console.warn(`[WhatsApp] Logged out (${sk}) — QR required on next connect`);
        return;
      }

      if (isSessionSaved(sk)) {
        scheduleAutoReconnect(sk, 3500);
      }
    })();
  });

  client.on('message_ack', (msg: Message, ack: number) => {
    if (!isCurrentClient()) return;
    state.ackMap.set(msg.id.id, ack as AckStatus);
    console.log(`[WhatsApp] Message ACK (${sk}) — id=${msg.id.id} ack=${ack}`);
    emitWebhook('message.ack', {
      session_key: sk,
      message_id: msg.id.id,
      ack,
      to: msg.to,
      timestamp: Math.floor(Date.now() / 1000),
    });
  });

  // Incoming message handler — filters out self-sent messages and non-chat
  // types, then forwards to Laravel for auto-reply / chatbot flow processing.
  client.on('message', (msg: Message) => {
    if (!isCurrentClient()) return;
    try {
      if (msg.fromMe) return;
      const allowed = ['chat', 'image', 'audio', 'document', 'video', 'ptt', 'sticker'];
      if (!allowed.includes(msg.type)) return;

      emitWebhook('message.received', {
        session_key: sk,
        message_id: msg.id.id,
        from: msg.from,
        to: msg.to,
        type: msg.type,
        body: msg.body ?? '',
        has_media: msg.hasMedia === true,
        timestamp: msg.timestamp ?? Math.floor(Date.now() / 1000),
        is_group: typeof msg.from === 'string' && msg.from.endsWith('@g.us'),
      });
    } catch (err) {
      console.error(`[WhatsApp] Failed to forward incoming message (${sk}):`, err);
    }
  });
}

/**
 * إنشاء عميل جديد وتسجيل الأحداث ثم client.initialize() مع إعادة محاولة عند أخطاء سياق Puppeteer.
 */
async function performInitializeWithRetries(state: WAClientState, sessionKey: string): Promise<void> {
  const defaultAttempts = process.platform === 'win32' ? 3 : 2;
  const maxAttempts = Math.max(
    1,
    Math.min(4, Number(process.env.WHATSAPP_INIT_MAX_ATTEMPTS || defaultAttempts)),
  );
  const key = normalizeSessionKey(sessionKey);

  clearReadyWatchdog(state);
  clearReconnectTimer(state);
  state.lastError = null;
  if (state.status === 'disconnected' && isSessionSaved(key)) {
    state.status = 'reconnecting';
  }

  try {
    fs.mkdirSync(AUTH_BASE, { recursive: true });
  } catch (err) {
    console.warn('[WhatsApp] Could not pre-create auth directory:', err);
  }

  const sessionDir = getSessionDir(key);

  // Windows: always clear locks + orphan wwebjs Chrome before first launch
  if (process.platform === 'win32') {
    killOrphanedChromeProcesses();
    await new Promise((r) => setTimeout(r, 800));
  }
  clearPuppeteerLocks(sessionDir);

  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await destroyClientSafe(state.client);
    state.client = null;
    clearPuppeteerLocks(sessionDir);

    const authStrategy =
      key === 'default'
        ? new LocalAuth({ dataPath: AUTH_BASE })
        : new LocalAuth({ dataPath: AUTH_BASE, clientId: key });

    const client = new Client({
      authStrategy,
      puppeteer: getPuppeteerOptions(),
    });

    state.client = client;
    state.qrString = null;
    if (state.status !== 'reconnecting' && state.status !== 'qr') {
      state.info = null;
    }

    attachClientEvents(client, state, key);

    try {
      await client.initialize();
      // initialize() resolves before ready — start watchdog if session already on disk
      if (state.status !== 'ready' && state.status !== 'qr') {
        startReadyWatchdog(client, state, key);
      }
      return;
    } catch (err: unknown) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[WhatsApp] client.initialize() failed (${key}) (attempt ${attempt}/${maxAttempts}):`, message);

      try {
        await client.destroy();
      } catch {
        /* ignore */
      }
      state.client = null;
      state.status = 'disconnected';
      state.qrString = null;
      state.info = null;

      const retry = attempt < maxAttempts && isTransientInitError(message);
      if (retry) {
        console.warn(`[WhatsApp] Transient browser error — retrying in ${INIT_RETRY_DELAY_MS}ms…`);
        if (
          message.toLowerCase().includes('already running') ||
          message.toLowerCase().includes('ebusy') ||
          message.toLowerCase().includes('eperm')
        ) {
          killOrphanedChromeProcesses({ forceAll: true });
          await new Promise((r) => setTimeout(r, process.platform === 'win32' ? 2000 : 500));
        }
        await new Promise((r) => setTimeout(r, INIT_RETRY_DELAY_MS));
        clearPuppeteerLocks(sessionDir);
        continue;
      }

      state.lastError = message;
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Shared hosting often has no system dbus; avoids noisy failures and some launch issues */
function applyHeadlessChromeEnvDefaults(): void {
  if (process.env.WHATSAPP_SKIP_DBUS_FIX === '1') {
    return;
  }
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
    process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/nonexistent';
  }
}

function getPuppeteerOptions(): {
  headless: boolean;
  executablePath?: string;
  args: string[];
} {
  applyHeadlessChromeEnvDefaults();

  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
    process.env.CHROME_PATH?.trim() ||
    process.env.GOOGLE_CHROME_BIN?.trim() ||
    undefined;

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    // Minimal / container-friendly (Hostinger, Docker, no systemd dbus)
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-component-extensions-with-background-pages',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-features=AudioServiceOutOfProcess,Translate,BackForwardCache,IsolateOrigins,site-per-process',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--use-mock-keychain',
  ];

  // pthread_create EAGAIN / ulimit على استضافة مشتركة — يقلّل العمليات (قد يقلّل الاستقرار)
  if (process.env.WHATSAPP_PUPPETEER_LOW_THREADS === '1') {
    args.push('--single-process', '--no-zygote');
  }

  const extra = process.env.WHATSAPP_PUPPETEER_EXTRA_ARGS?.trim();
  if (extra) {
    args.push(...extra.split(/\s+/).filter(Boolean));
  }

  return {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args,
  };
}

/**
 * Auto-initialise the client when a saved session exists and the client
 * is currently disconnected.  This is called by the status endpoint so
 * that a page reload after a server restart reconnects automatically.
 */
export function autoInit(sessionKey?: string | null): void {
  const key = normalizeSessionKey(sessionKey);
  const state = getState(key);
  if (state.status === 'reconnecting') {
    return;
  }
  if (state.status !== 'disconnected' || !isSessionSaved(key)) {
    return;
  }
  if (
    state.lastAutoInitFailureAt !== null &&
    Date.now() - state.lastAutoInitFailureAt < AUTO_INIT_FAILURE_COOLDOWN_MS
  ) {
    return;
  }

  state.status = 'reconnecting';
  state.lastError = null;
  initialize(key).catch((err: Error) => {
    console.error(`[WhatsApp] Auto-reconnect failed (${key}):`, err.message);
    state.status = 'disconnected';
    state.lastError = err.message;
    state.lastAutoInitFailureAt = Date.now();
  });
}

const READY_WAIT_MS = Math.max(
  5000,
  Math.min(120000, Number(process.env.SENDSTACK_SEND_WAIT_FOR_READY_MS || 45_000)),
);
const READY_POLL_MS = Math.max(
  300,
  Math.min(3000, Number(process.env.SENDSTACK_SEND_POLL_MS || 800)),
);

async function waitUntilSessionReady(sessionKey: string): Promise<void> {
  const deadline = Date.now() + READY_WAIT_MS;
  while (Date.now() < deadline) {
    reconcileStaleReady(sessionKey);
    if (isSessionReady(sessionKey)) {
      return;
    }
    const state = getState(sessionKey);
    const status = state.status;
    // Reject only when waiting for a fresh QR scan (qrString present).
    // authenticated→reconnecting leaves qrString null while watchdog runs.
    if (status === 'disconnected') {
      break;
    }
    if (status === 'qr' && state.qrString) {
      break;
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }

  reconcileStaleReady(sessionKey);
  const state = getState(sessionKey);
  if (!isSessionReady(sessionKey)) {
    throw new Error(
      state.lastError ?? `WhatsApp session not ready (status: ${state.status})`,
    );
  }
}

/**
 * Wait until the session is ready (or fail). Used by /send and /connect so parallel
 * requests share one initPromise instead of spawning multiple Chrome profiles.
 */
export async function ensureSessionReady(sessionKey?: string | null): Promise<void> {
  const key = normalizeSessionKey(sessionKey);
  reconcileStaleReady(key);

  if (isSessionReady(key)) {
    return;
  }

  const state = getState(key);
  if (state.initPromise) {
    await state.initPromise;
  } else if (!(state.client && (state.status === 'qr' || state.status === 'reconnecting'))) {
    await initialize(key);
  }

  await waitUntilSessionReady(key);
}

export async function initialize(sessionKey?: string | null): Promise<void> {
  const key = normalizeSessionKey(sessionKey);
  const state = getState(key);

  if (state.initPromise) {
    await state.initPromise;
    return;
  }

  if (state.status === 'ready' && state.client) {
    return;
  }

  // Existing live client waiting for QR scan or finishing auth — do not spawn another Chrome
  if (state.client && (state.status === 'qr' || state.status === 'reconnecting')) {
    if (!state.readyWatchdog && state.status === 'reconnecting') {
      startReadyWatchdog(state.client, state, key);
    }
    return;
  }

  if (state.client) {
    await destroyClientSafe(state.client);
    state.client = null;
  }

  state.initPromise = (async () => {
    try {
      await performInitializeWithRetries(state, key);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      state.status = 'disconnected';
      state.lastError = message;
      await destroyClientSafe(state.client);
      state.client = null;
      throw err;
    } finally {
      state.initPromise = null;
    }
  })();

  await state.initPromise;
}

/** Validate and normalize a phone number. Returns normalized digits or throws. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[\s\-\(\)\+]/g, '');
  if (!/^\d{7,15}$/.test(digits)) {
    throw new Error(`Invalid phone number format: "${phone}". Expected 7–15 digits.`);
  }
  return digits;
}

/**
 * Puppeteer / whatsapp-web.js غالبًا يُرجع Error برسالة حرف واحد (مثل "t") من كود WA المُصغّر.
 * نبني وصفًا أوضح من الـ stack و cause.
 */
export function describeSendError(err: unknown): string {
  if (err == null) {
    return 'Unknown error';
  }
  if (typeof err === 'string') {
    const t = err.trim();
    if (t.length > 0 && t.length < 4) {
      return `WhatsApp Web returned a short error code (${JSON.stringify(t)}). Usually a crashed browser tab or WA Web update — retry, reconnect QR, or restart SendStack.`;
    }
    return t || 'Unknown string error';
  }
  if (err instanceof Error) {
    const e = err as Error & { cause?: unknown };
    const parts: string[] = [];
    const msg = (e.message ?? '').trim();
    const name = (e.name ?? '').trim();
    if (msg.length >= 4) {
      parts.push(msg);
    } else if (msg.length > 0) {
      parts.push(`opaque code "${msg}"`);
    }
    if (name && name !== 'Error' && name.length > 1) {
      parts.push(`type: ${name}`);
    }
    if (e.cause !== undefined && e.cause !== null) {
      const c = describeSendError(e.cause);
      if (c && c !== 'Unknown error') {
        parts.push(`cause: ${c}`);
      }
    }
    const stack = e.stack ?? '';
    if (stack) {
      const line =
        stack
          .split('\n')
          .find((l) =>
            /ExecutionContext|evaluate|IsolatedWorld|Client\.js|puppeteer|whatsapp-web/i.test(l),
          ) ?? stack.split('\n')[0];
      if (line) {
        const trimmed = line.trim();
        if (!parts.some((p) => trimmed.includes(p.slice(0, 15)))) {
          parts.push(`at ${trimmed}`);
        }
      }
    }
    if (parts.length === 0) {
      return 'WhatsApp Web / Puppeteer send failed (empty error). Try: reconnect QR, restart SendStack, or update whatsapp-web.js.';
    }
    const joined = parts.join(' — ');
    if (joined.trim().length < 8 && msg.length > 0) {
      return `WhatsApp Web send failed (code: ${JSON.stringify(msg)}). Retry or reconnect the WhatsApp session in SendStack.`;
    }
    return joined;
  }
  try {
    const s = JSON.stringify(err);
    if (s && s !== '{}') {
      return s;
    }
  } catch {
    /* ignore */
  }
  return String(err);
}

function isTransientSendError(err: unknown, described: string): boolean {
  const d = described.toLowerCase();
  if (d.includes('not registered') || d.includes('invalid wid')) {
    return false;
  }
  if (err instanceof Error) {
    const m = (err.message ?? '').trim();
    if (m.length > 0 && m.length <= 4) {
      return true;
    }
    const st = (err.stack ?? '').toLowerCase();
    if (
      st.includes('executioncontext') ||
      st.includes('evaluate') ||
      st.includes('isolatedworld') ||
      st.includes('cdp/')
    ) {
      return true;
    }
  }
  const hints = [
    'execution context',
    'target closed',
    'session closed',
    'protocol error',
    'websocket',
    'navigation',
    'detached',
    'timeout',
    'econnreset',
    'opaque code',
    'empty error',
  ];
  return hints.some((h) => d.includes(h));
}

const SEND_RETRY_DELAYS_MS = [3000, 5000, 8000, 12000, 15000, 20000];

/**
 * Send a text message to a phone number (E.164 format without '+').
 * يعيد المحاولة عند أخطاء Puppeteer/WA العابرة (بما فيها رسائل خطأ قصيرة غامضة).
 */
export async function sendMessage(phone: string, text: string, sessionKey?: string | null): Promise<string> {
  const key = normalizeSessionKey(sessionKey);
  await ensureSessionReady(key);
  const state = getState(key);

  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }

  const chatId = `${phone}@c.us`;
  const sendMax = Math.max(3, Math.min(8, Number(process.env.WHATSAPP_SEND_MAX_ATTEMPTS || 6)));

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < sendMax; attempt++) {
    try {
      const result = await state.client.sendMessage(chatId, text);
      const msgId = (result as any)?.id?.id || (result as any)?.id?._serialized || String((result as any)?.id || 'sent');
      return msgId;
    } catch (err: unknown) {
      const described = describeSendError(err);
      const low = described.toLowerCase();

      if (low.includes('not registered') || low.includes('invalid wid')) {
        throw err instanceof Error ? err : new Error(described);
      }

      if (state.status !== 'ready') {
        throw new Error('WhatsApp client disconnected during send');
      }

      lastError = new Error(described, { cause: err instanceof Error ? err : undefined });
      const transient = isTransientSendError(err, described);

      if (!transient) {
        throw lastError;
      }

      if (attempt >= sendMax - 1) {
        throw lastError;
      }

      const delay = SEND_RETRY_DELAYS_MS[Math.min(attempt, SEND_RETRY_DELAYS_MS.length - 1)];
      console.warn(
        `[WhatsApp] Send failed (attempt ${attempt + 1}/${sendMax}): ${described.slice(0, 220)} — retry in ${delay / 1000}s`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError ?? new Error('Failed to send message after retries');
}

/**
 * Send a media message (image / document) with an optional caption.
 *
 * @param phone      - Phone number digits (no '+' or spaces)
 * @param mediaBase64 - Base64-encoded file content
 * @param mimeType   - MIME type, e.g. 'image/png', 'application/pdf'
 * @param filename   - Original filename shown in WhatsApp
 * @param caption    - Optional text caption
 */
export async function sendMedia(
  phone: string,
  mediaBase64: string,
  mimeType: string,
  filename: string,
  caption?: string,
  sessionKey?: string | null,
): Promise<string> {
  const key = normalizeSessionKey(sessionKey);
  await ensureSessionReady(key);
  const state = getState(key);

  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }

  const chatId = `${phone}@c.us`;
  const media = new MessageMedia(mimeType, mediaBase64, filename);

  const result = await state.client.sendMessage(chatId, media, { caption });
  return (result as any)?.id?.id || (result as any)?.id?._serialized || String((result as any)?.id || 'sent');
}

export interface SimpleContact {
  id: string;
  name: string | null;
  number: string | null;
  is_business: boolean;
  is_my_contact: boolean;
}

/**
 * List contacts from the connected session.
 * Filters out status broadcast and groups; returns a compact shape.
 */
export async function listContacts(
  sessionKey?: string | null,
  search?: string | null,
  limit: number = 500,
): Promise<SimpleContact[]> {
  const key = normalizeSessionKey(sessionKey);
  const state = getState(key);
  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }

  const raw = await state.client.getContacts();
  const q = (search ?? '').trim().toLowerCase();
  const out: SimpleContact[] = [];

  for (const c of raw) {
    // Skip groups and status broadcast
    if (c.isGroup || !c.id?.user) continue;

    const name = c.name || c.pushname || null;
    const number = c.number ?? c.id.user;

    if (q) {
      const hay = `${name ?? ''} ${number ?? ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    out.push({
      id: c.id._serialized,
      name,
      number,
      is_business: Boolean(c.isBusiness),
      is_my_contact: Boolean(c.isMyContact),
    });

    if (out.length >= limit) break;
  }

  return out;
}

export interface SimpleGroup {
  id: string;
  name: string;
  participants_count: number;
  is_admin: boolean;
}

export async function listGroups(sessionKey?: string | null): Promise<SimpleGroup[]> {
  const key = normalizeSessionKey(sessionKey);
  const state = getState(key);
  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }

  const chats = await state.client.getChats();
  const out: SimpleGroup[] = [];
  for (const chat of chats) {
    if (!chat.isGroup) continue;
    // whatsapp-web.js GroupChat has participants
    const gc = chat as unknown as {
      id: { _serialized: string };
      name: string;
      participants?: Array<{ isAdmin?: boolean; isSuperAdmin?: boolean; id: { _serialized: string } }>;
    };
    const me = state.info?.wid;
    const admin = (gc.participants ?? []).some(
      (p) => (p.isAdmin || p.isSuperAdmin) && me && p.id._serialized.startsWith(me),
    );
    out.push({
      id: gc.id._serialized,
      name: gc.name,
      participants_count: gc.participants?.length ?? 0,
      is_admin: admin,
    });
  }
  return out;
}

export async function createGroup(
  name: string,
  participants: string[],
  sessionKey?: string | null,
): Promise<{ id: string; missing: string[] }> {
  const key = normalizeSessionKey(sessionKey);
  const state = getState(key);
  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }

  const chatIds = participants.map((p) => `${normalizePhone(p)}@c.us`);
  // whatsapp-web.js createGroup returns CreateGroupResult (string id on old versions)
  const result = await state.client.createGroup(name, chatIds);
  if (typeof result === 'string') {
    return { id: result, missing: [] };
  }
  // New shape: { gid: { _serialized }, missingParticipants: string[] }
  const r = result as unknown as {
    gid?: { _serialized: string };
    missingParticipants?: Record<string, string> | string[];
  };
  const missing = Array.isArray(r.missingParticipants)
    ? r.missingParticipants
    : Object.keys(r.missingParticipants ?? {});
  return { id: r.gid?._serialized ?? '', missing };
}

export async function addGroupParticipants(
  groupId: string,
  participants: string[],
  sessionKey?: string | null,
): Promise<unknown> {
  const key = normalizeSessionKey(sessionKey);
  const state = getState(key);
  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }
  const chat = await state.client.getChatById(groupId);
  const gc = chat as unknown as {
    isGroup: boolean;
    addParticipants(ids: string[]): Promise<unknown>;
  };
  if (!gc.isGroup) {
    throw new Error('Not a group chat: ' + groupId);
  }
  const chatIds = participants.map((p) => `${normalizePhone(p)}@c.us`);
  return gc.addParticipants(chatIds);
}

export async function removeGroupParticipants(
  groupId: string,
  participants: string[],
  sessionKey?: string | null,
): Promise<unknown> {
  const key = normalizeSessionKey(sessionKey);
  const state = getState(key);
  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }
  const chat = await state.client.getChatById(groupId);
  const gc = chat as unknown as {
    isGroup: boolean;
    removeParticipants(ids: string[]): Promise<unknown>;
  };
  if (!gc.isGroup) {
    throw new Error('Not a group chat: ' + groupId);
  }
  const chatIds = participants.map((p) => `${normalizePhone(p)}@c.us`);
  return gc.removeParticipants(chatIds);
}

export async function isRegisteredUser(phone: string, sessionKey?: string | null): Promise<boolean> {
  const key = normalizeSessionKey(sessionKey);
  const state = getState(key);

  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }

  const chatId = `${phone}@c.us`;
  return state.client.isRegisteredUser(chatId);
}

export async function disconnect(sessionKey?: string | null): Promise<void> {
  const key = normalizeSessionKey(sessionKey);
  const state = getState(key);

  clearReadyWatchdog(state);
  clearReconnectTimer(state);

  if (state.initPromise) {
    try {
      await state.initPromise;
    } catch {
      /* ignore — may be mid-failed init */
    }
  }

  await destroyClientSafe(state.client);
  state.client = null;
  state.status = 'disconnected';
  state.qrString = null;
  state.info = null;
  state.initPromise = null;

  if (process.platform === 'win32') {
    await new Promise((r) => setTimeout(r, 1500));
    killOrphanedChromeProcesses();
    clearPuppeteerLocks(getSessionDir(key));
  }
}
