// The Node side of the desktop bridge (see main.js): web requests, backups and alarm lists. Kept free of Electron so
// the tests can run it with plain Node (tests/e2e/desktop-bridge.mjs). Mirrors android/…/NativeBridge.java.
const { randomBytes, randomInt } = require('node:crypto');
const { createServer } = require('node:http');
const { networkInterfaces } = require('node:os');
const { readFile, readdir, rename, stat, unlink, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

const MAX_PAGE_BYTES = 4_000_000;
const BACKUP_PREFIX = 'goodstock-auto-backup-';
const KEEP_BACKUPS = 4;
// setTimeout cannot wait longer than this (about 24 days); the app schedules its reminders again on every start.
const MAX_DELAY = 2_147_483_647;

async function readText(response) {
  const reader = response.body && response.body.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const bytes = Buffer.concat(chunks).subarray(0, MAX_PAGE_BYTES);
  const charset = /charset=([\w.-]+)/i.exec(response.headers.get('content-type') || '');
  try { return new TextDecoder(charset ? charset[1] : 'utf-8').decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

/**
 * A web request for recipe import, Mealie, DeepL and the home server, without the page's CORS limits. Answers
 * { status, url, body } like the phone apps. Redirects are followed here so a key (the Authorization header) is never
 * sent on to another host, and requests with a body are not re-sent to another address.
 */
async function httpRequest({ method = 'GET', url, headers = {}, body = null, fetchImpl = fetch }) {
  let address = new URL(url);
  const originalHost = address.hostname.toLowerCase();
  const verb = String(method || 'GET').toUpperCase();
  for (let redirects = 0; redirects < 6; redirects += 1) {
    if (address.protocol !== 'http:' && address.protocol !== 'https:') throw new Error('Only http and https links are supported');
    const sent = { 'user-agent': 'Mozilla/5.0 (Desktop) GoodstockRecipeImport/1.0', accept: 'text/html,application/xhtml+xml' };
    for (const [name, value] of Object.entries(headers || {})) {
      if (name.toLowerCase() === 'authorization' && address.hostname.toLowerCase() !== originalHost) continue;
      sent[name.toLowerCase()] = String(value);
    }
    const response = await fetchImpl(address.toString(), { method: verb, headers: sent, body: body == null ? undefined : body, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location && body == null) {
      address = new URL(location, address);
      continue;
    }
    return { status: response.status, url: address.toString(), body: await readText(response) };
  }
  throw new Error('Too many redirects');
}

/**
 * A recipe photo from a website as a data URL, for keeping a small copy with an imported recipe (the page shrinks it).
 * Only images (JPEG, PNG, WebP, GIF), at most 8 MB, like the server's /api/photo.
 */
async function fetchImage({ url, fetchImpl = fetch }) {
  const address = new URL(url);
  if (address.protocol !== 'http:' && address.protocol !== 'https:') throw new Error('Only http and https links are supported');
  const response = await fetchImpl(address.toString(), { headers: { 'user-agent': 'Mozilla/5.0 (Desktop) GoodstockRecipeImport/1.0', accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!response.ok || !/^image\/(?:jpeg|png|webp|gif)$/.test(type)) throw new Error('That photo could not be loaded.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 8_000_000) throw new Error('That photo is too large.');
  return `data:${type};base64,${bytes.toString('base64')}`;
}

const safeFileName = (name, fallback) => {
  const clean = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
  return clean && !/^\.+$/.test(clean) ? clean : fallback;
};

/** Writes an automatic backup into the chosen folder and keeps the newest four. */
async function writeBackup(folder, fileName, content) {
  await writeFile(join(folder, safeFileName(fileName, `${BACKUP_PREFIX}backup.json`)), content, 'utf8');
  const backups = (await readdir(folder)).filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.json')).sort().reverse();
  await Promise.all(backups.slice(KEEP_BACKUPS).map((name) => unlink(join(folder, name)).catch(() => {})));
}

/**
 * The alarms still to ring from the page's list: timers [{id, endsAt, done, title, text}] or use-soon reminders
 * [{id, at, title, text}]. Null when the list cannot be read, so the alarms already set are kept.
 */
function upcomingAlarms(json, timeKey, now = Date.now()) {
  let list;
  try { list = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(list)) return null;
  return list
    .filter((entry) => entry && entry.id && !entry.done && Number(entry[timeKey]) > now && Number(entry[timeKey]) - now <= MAX_DELAY)
    .map((entry) => ({ id: String(entry.id), delay: Number(entry[timeKey]) - now, title: String(entry.title || 'Goodstock'), text: String(entry.text || '') }));
}

// Shared folder sync: each device writes goodstock-sync-<device>.json and reads the others' (see app/sync.js).
const SYNC_FILE = /^goodstock-sync-[\w-]{4,64}\.json$/;

async function listSyncFolder(folder) {
  const names = (await readdir(folder)).filter((name) => SYNC_FILE.test(name));
  const files = await Promise.all(names.map(async (name) => {
    try {
      const info = await stat(join(folder, name));
      return { name, modified: Math.round(info.mtimeMs), size: info.size };
    } catch { return null; }
  }));
  return files.filter(Boolean);
}

async function readSyncFile(folder, name) {
  if (!SYNC_FILE.test(name)) throw new Error('Not a Goodstock sync file');
  return readFile(join(folder, name), 'utf8');
}

// Written beside the target and then renamed, so a folder-sync app never picks up half a file.
async function writeSyncFile(folder, name, content) {
  if (!SYNC_FILE.test(name)) throw new Error('Not a Goodstock sync file');
  const temporary = join(folder, `.${name}.tmp`);
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, join(folder, name));
}

// Hosting: a small home server on this computer with the kitchen API of server.mjs (state, revision, 409 when another
// device saved first) and a PIN that gives each phone the household token. Mirrors android/…/KitchenHost.java.
const HOST_PORTS = [8486, 8487, 8488, 8489, 8490];
const MAX_BODY = 20_000_000;
const DEVICE_SEEN_MS = 45_000;

function lanAddresses() {
  const found = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if ((entry.family === 'IPv4' || entry.family === 4) && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}

const makeHostSecrets = () => ({ pin: String(randomInt(0, 1_000_000)).padStart(6, '0'), token: randomBytes(24).toString('hex') });

/**
 * The kitchen host's answers, without the network: handle({ method, path, headers, body }) gives
 * { status, body }. The kitchen is kept in `file` so it survives a restart.
 */
// Any other GET answers the app's own web files (webRoot), so a browser on the Wi-Fi can open the host's address and
// use the shared kitchen without the app; the pages are marked data-hosted (HOSTED in app/core.js). Browsers sign in
// with the same PIN and keep the token as a cookie. Mirrors KitchenHost.java.
const HOST_COOKIE = 'goodstock-host';
const HOST_FILE_TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', woff: 'font/woff',
};

function createKitchenHost({ file, pin, token, webRoot = '', now = Date.now }) {
  let kitchen = { revision: 0, state: null };
  let writes = Promise.resolve();
  const devices = new Map();
  const wrongPins = { count: 0, until: 0 };

  async function load() {
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (saved && saved.state && Array.isArray(saved.state.inventory)) kitchen = { revision: Number(saved.revision) || 1, state: saved.state };
    } catch { /* A new host starts empty; the first device to save fills it. */ }
  }

  function save() {
    const snapshot = JSON.stringify(kitchen);
    writes = writes.then(async () => {
      await writeFile(`${file}.tmp`, snapshot, 'utf8');
      await rename(`${file}.tmp`, file);
    }).catch(() => {});
    return writes;
  }

  async function webFile(path) {
    let name = '';
    try { name = decodeURIComponent(path).replace(/^\/+/, ''); } catch { return null; }
    if (!name || name.endsWith('/')) name += 'index.html';
    const type = HOST_FILE_TYPES[(/\.(\w+)$/.exec(name) || [])[1]];
    if (!webRoot || !type || name.includes('..') || name.includes('\\') || name.includes(':') || name === 'sw.js') return null;
    try {
      let bytes = await readFile(join(webRoot, name));
      if (name.endsWith('index.html')) bytes = Buffer.from(bytes.toString('utf8').replace('<html', '<html data-hosted="1"'));
      return { status: 200, type, bytes };
    } catch { return null; }
  }

  async function handle({ method, path, headers = {}, body = '' }) {
    const verb = String(method).toUpperCase();
    const pathname = String(path).split('?')[0];
    const route = `${verb} ${pathname}`;
    if ((verb === 'GET' || verb === 'HEAD') && !pathname.startsWith('/api/')) {
      return (await webFile(pathname)) || { status: 404, type: 'text/plain; charset=utf-8', bytes: Buffer.from('Not found') };
    }
    const cookie = String(headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${HOST_COOKIE}=`));
    if (!headers.authorization && cookie) headers = { ...headers, authorization: `Bearer ${cookie.slice(HOST_COOKIE.length + 1)}` };
    if (route === 'GET /api/health') return { status: 200, body: { ok: true, app: 'goodstock', host: true } };
    if (route === 'POST /api/auth/login') {
      if (now() < wrongPins.until) return { status: 429, body: { error: 'Too many wrong PINs.' } };
      let given = '';
      try { given = String(JSON.parse(body || '{}').pin || ''); } catch { /* Wrong below. */ }
      if (given !== pin) {
        wrongPins.count += 1;
        if (wrongPins.count >= 5) { wrongPins.count = 0; wrongPins.until = now() + 5 * 60_000; }
        return { status: 401, body: { error: 'Wrong PIN' } };
      }
      wrongPins.count = 0;
      // A browser keeps the token as a cookie (the apps read it from the answer).
      return { status: 200, body: { token }, cookie: `${HOST_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` };
    }
    if (String(headers.authorization || '') !== `Bearer ${token}`) return { status: 401, body: { error: 'PIN required', code: 'pin' } };
    // Devices are told apart by the id each app sends; the revision answer counts the others than the one asking.
    const client = String(headers['x-goodstock-client'] || '');
    if (client) devices.set(client, now());
    if (route === 'GET /api/state') return { status: 200, body: kitchen.state ? { ...kitchen.state, _revision: kitchen.revision } : null };
    if (route === 'GET /api/state/revision') {
      for (const [id, seen] of devices) if (now() - seen > DEVICE_SEEN_MS) devices.delete(id);
      return { status: 200, body: { revision: kitchen.revision, devices: devices.size - (devices.has(client) ? 1 : 0) } };
    }
    if (route === 'POST /api/state') {
      let payload;
      try { payload = JSON.parse(body); } catch { return { status: 400, body: { error: 'Invalid kitchen state' } }; }
      const state = payload && payload.state;
      if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.inventory) || !Array.isArray(state.recipes)) {
        return { status: 400, body: { error: 'Invalid kitchen state' } };
      }
      if (kitchen.state && Number(payload.baseRevision) !== kitchen.revision) {
        return { status: 409, body: { error: 'The kitchen changed on another device.', revision: kitchen.revision, state: kitchen.state } };
      }
      const { _revision, ...clean } = state;
      kitchen = { revision: kitchen.revision + 1, state: clean };
      await save();
      return { status: 200, body: { saved: true, revision: kitchen.revision } };
    }
    return { status: 404, body: { error: 'Not found' } };
  }

  return { load, handle };
}

/** Starts the host on the first free port of HOST_PORTS; answers { server, port }. */
async function startKitchenHost(host, ports = HOST_PORTS) {
  const server = createServer((request, response) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { response.writeHead(413).end(); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', async () => {
      if (response.writableEnded) return;
      const answer = await host.handle({
        method: request.method, path: request.url, headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }).catch(() => ({ status: 500, body: { error: 'Host error' } }));
      const head = { 'content-type': answer.type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      if (answer.cookie) head['set-cookie'] = answer.cookie;
      response.writeHead(answer.status, head);
      response.end(request.method === 'HEAD' ? undefined : answer.bytes || JSON.stringify(answer.body));
    });
  });
  for (const port of ports) {
    const started = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '0.0.0.0', () => resolve(true));
    });
    if (started) return { server, port: server.address().port };
  }
  throw new Error('No free port for hosting');
}

module.exports = {
  httpRequest, fetchImage, writeBackup, upcomingAlarms, safeFileName, BACKUP_PREFIX, KEEP_BACKUPS,
  listSyncFolder, readSyncFile, writeSyncFile, createKitchenHost, startKitchenHost, makeHostSecrets, lanAddresses,
};
