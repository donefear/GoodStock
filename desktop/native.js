// The Node side of the desktop bridge (see main.js): web requests, backups and alarm lists. Kept free of Electron so
// the tests can run it with plain Node (tests/e2e/desktop-bridge.mjs). Mirrors android/…/NativeBridge.java.
const { readdir, unlink, writeFile } = require('node:fs/promises');
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

module.exports = { httpRequest, writeBackup, upcomingAlarms, safeFileName, BACKUP_PREFIX, KEEP_BACKUPS };
