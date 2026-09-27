import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { extractRecipeFromHtml, NO_RECIPE_MESSAGE } from './recipe-import.mjs';
import { mapMealieRecipe, mealieErrorMessage, mealieRecipePageUrl, mealieRows, normalizeMealieUrl } from './mealie.mjs';
import { deeplChunks, deeplErrorMessage, deeplHeaders, deeplRequestBody, deeplUrl, deeplUsageText } from './deepl.mjs';

const port = Number(process.env.PORT || 8080);
const dataDirectory = process.env.DATA_DIR || './data';
const statePath = join(dataDirectory, 'state.json');

// Mealie connection: set in the app's Settings (saved to /data/mealie.json), or else from the MEALIE_URL,
// MEALIE_API_KEY and MEALIE_PUBLIC_URL environment variables. The API key never goes back to the browser.
const mealieConfigPath = join(dataDirectory, 'mealie.json');
const envMealie = {
  url: normalizeMealieUrl(process.env.MEALIE_URL),
  key: process.env.MEALIE_API_KEY || '',
  publicUrl: normalizeMealieUrl(process.env.MEALIE_PUBLIC_URL),
  source: 'environment',
};
let mealie = { ...envMealie };
let mealieGroupSlug = '';
const mealieConfigured = () => Boolean(mealie.url && mealie.key);
const mealiePublicUrl = () => mealie.publicUrl || mealie.url;

async function loadMealieConfig() {
  try {
    const saved = JSON.parse(await readFile(mealieConfigPath, 'utf8'));
    if (saved?.url && saved?.key) mealie = { url: normalizeMealieUrl(saved.url), key: saved.key, publicUrl: normalizeMealieUrl(saved.publicUrl), source: 'settings' };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read the saved Mealie settings:', error.message);
  }
}

async function saveMealieConfig(config) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${mealieConfigPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ url: config.url, key: config.key, publicUrl: config.publicUrl }), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, mealieConfigPath);
}

function mealieStatus() {
  return { configured: mealieConfigured(), url: mealie.url, publicUrl: mealie.publicUrl, source: mealieConfigured() ? mealie.source : '' };
}
const shoppingShares = new Map();
const shoppingShareLifetime = 30 * 60 * 1000;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/ingredients.json', ['ingredients.json', 'application/json; charset=utf-8']],
  ['/kitchen-tools.js', ['kitchen-tools.js', 'text/javascript; charset=utf-8']],
  ['/kitchen-reference.js', ['kitchen-reference.js', 'text/javascript; charset=utf-8']],
  ['/recipe-import.mjs', ['recipe-import.mjs', 'text/javascript; charset=utf-8']],
  ['/mealie.mjs', ['mealie.mjs', 'text/javascript; charset=utf-8']],
  ['/deepl.mjs', ['deepl.mjs', 'text/javascript; charset=utf-8']],
]);

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8_000_000) throw new Error('Request body is too large');
  }
  return JSON.parse(body || '{}');
}

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveState(state) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state), 'utf8');
  await rename(temporaryPath, statePath);
}

// The shared kitchen (Docker/server version): one state for everyone who opens this server, with a revision number.
// A save must say which revision it started from; a save based on an older revision is refused (409) and gets the
// current state back, so the device merges its changes in and tries again. Every open page hears about new
// revisions straight away through Server-Sent Events (/api/events), which also report how many devices are live.
let kitchen = { revision: 0, state: null };
let kitchenWrites = Promise.resolve();
const liveClients = new Set();

async function loadKitchen() {
  const saved = await readState();
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    const { _revision: revision, ...state } = saved;
    kitchen = { revision: Number(revision) || 1, state };
  }
}

// Writes go one after another, so a slow disk can never put an older state on top of a newer one.
function writeKitchen() {
  const snapshot = { ...kitchen.state, _revision: kitchen.revision };
  kitchenWrites = kitchenWrites.then(() => saveState(snapshot)).catch((error) => console.error('Could not save the kitchen:', error.message));
  return kitchenWrites;
}

function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of liveClients) client.write(message);
}

const broadcastPresence = () => broadcast('presence', { devices: liveClients.size });

// Keeps idle connections open through proxies and phones that drop silent streams.
setInterval(() => { for (const client of liveClients) client.write(': ping\n\n'); }, 25_000).unref();

function openLiveStream(request, response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  response.write('retry: 3000\n\n');
  response.write(`event: state\ndata: ${JSON.stringify({ revision: kitchen.revision, origin: '' })}\n\n`);
  liveClients.add(response);
  broadcastPresence();
  request.on('close', () => {
    liveClients.delete(response);
    broadcastPresence();
  });
}

async function receiveKitchen(payload) {
  // New pages send { state, baseRevision, client }; older cached pages send the bare state and simply overwrite.
  const tracked = payload && typeof payload === 'object' && payload.state && Object.hasOwn(payload, 'baseRevision');
  const state = tracked ? payload.state : payload;
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.inventory) || !Array.isArray(state.recipes)) {
    return { status: 400, body: { error: 'Invalid kitchen state' } };
  }
  if (tracked && kitchen.state && Number(payload.baseRevision) !== kitchen.revision) {
    return { status: 409, body: { error: 'The kitchen changed on another device.', revision: kitchen.revision, state: kitchen.state } };
  }
  const { _revision, ...clean } = state;
  kitchen = { revision: kitchen.revision + 1, state: clean };
  await writeKitchen();
  broadcast('state', { revision: kitchen.revision, origin: tracked ? String(payload.client || '') : '' });
  return { status: 200, body: { saved: true, revision: kitchen.revision } };
}

async function fetchMealie(path, config = mealie) {
  let result;
  try {
    result = await fetch(`${config.url}/api${path}`, {
      headers: { authorization: `Bearer ${config.key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw Object.assign(new Error(timedOut ? `Mealie at ${config.url} took too long to answer.` : `Could not reach Mealie at ${config.url}.`), { status: 502 });
  }
  if (!result.ok) throw Object.assign(new Error(mealieErrorMessage(result.status, config.url)), { status: 502 });
  return result.json();
}

async function openMealieRecipeUrl(slug) {
  if (!mealieGroupSlug) {
    try {
      mealieGroupSlug = (await fetchMealie('/groups/self')).slug || '';
    } catch { /* Fall back to Mealie's default group below. */ }
  }
  return mealieRecipePageUrl(mealiePublicUrl(), mealieGroupSlug, slug);
}

// Tests a connection before saving it. A new address needs the key typed again, so a saved key is never sent
// to a different server.
async function connectMealie(body) {
  const url = normalizeMealieUrl(body?.url);
  if (!url) throw Object.assign(new Error('Enter the address of your Mealie server.'), { status: 400 });
  try { new URL(url); } catch { throw Object.assign(new Error('That does not look like a web address.'), { status: 400 }); }
  const typedKey = String(body?.apiKey || '').trim();
  const key = typedKey || (url === mealie.url ? mealie.key : '');
  if (!key) throw Object.assign(new Error('Enter a Mealie API key. You can create one in Mealie under your user profile → API Tokens.'), { status: 400 });
  const config = { url, key, publicUrl: normalizeMealieUrl(body?.publicUrl), source: 'settings' };
  const user = await fetchMealie('/users/self', config);
  await saveMealieConfig(config);
  mealie = config;
  mealieGroupSlug = '';
  return { ...mealieStatus(), user: user?.fullName || user?.username || '' };
}

async function disconnectMealie() {
  try { await unlink(mealieConfigPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  mealie = { ...envMealie };
  mealieGroupSlug = '';
  return mealieStatus();
}

// Recipe import from a web page: fetched here, parsed by the shared recipe-import.mjs (also used by the Android app).
async function importRecipeFromUrl(address) {
  let target;
  try { target = new URL(address); } catch { throw Object.assign(new Error('That does not look like a web address.'), { status: 400 }); }
  if (!/^https?:$/.test(target.protocol)) throw Object.assign(new Error('Only http and https links can be imported.'), { status: 400 });
  const result = await fetch(target, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; GoodstockRecipeImport/1.0)', accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (!result.ok) throw Object.assign(new Error(`The website refused the import (HTTP ${result.status}). Some sites block this; copy the recipe text and paste it instead.`), { status: 502 });
  const recipe = extractRecipeFromHtml(await result.text(), result.url || target.href);
  if (!recipe) throw Object.assign(new Error(NO_RECIPE_MESSAGE), { status: 422 });
  return recipe;
}

function safeExportText(value, limit) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

// DeepL translation: the key is set in the app's Settings (saved to /data/deepl.json) or the DEEPL_API_KEY
// environment variable. Like the Mealie key, it never goes back to the browser.
const deeplConfigPath = join(dataDirectory, 'deepl.json');
const envDeepl = { key: process.env.DEEPL_API_KEY || '', source: 'environment' };
let deepl = { ...envDeepl };

async function loadDeeplConfig() {
  try {
    const saved = JSON.parse(await readFile(deeplConfigPath, 'utf8'));
    if (saved?.key) deepl = { key: saved.key, source: 'settings' };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read the saved DeepL settings:', error.message);
  }
}

async function callDeepl(path, key, body) {
  let result;
  try {
    result = await fetch(deeplUrl(key, path), {
      method: body ? 'POST' : 'GET',
      headers: deeplHeaders(key),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw Object.assign(new Error(timedOut ? 'DeepL took too long to answer.' : 'Could not reach DeepL. Check that the server has internet access.'), { status: 502 });
  }
  if (!result.ok) throw Object.assign(new Error(deeplErrorMessage(result.status)), { status: 502 });
  return result.json();
}

async function deeplStatus() {
  if (!deepl.key) return { configured: false, source: '' };
  const usage = await callDeepl('/usage', deepl.key).catch(() => null);
  return { configured: true, source: deepl.source, usage: deeplUsageText(usage) };
}

// Tests the key with DeepL's usage call before saving it.
async function connectDeepl(body) {
  const key = String(body?.apiKey || '').trim();
  if (!key) throw Object.assign(new Error('Paste your DeepL API key. You find it in your DeepL account under API Keys.'), { status: 400 });
  const usage = await callDeepl('/usage', key);
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${deeplConfigPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ key }), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, deeplConfigPath);
  deepl = { key, source: 'settings' };
  return { configured: true, source: 'settings', usage: deeplUsageText(usage) };
}

async function disconnectDeepl() {
  try { await unlink(deeplConfigPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  deepl = { ...envDeepl };
  return { configured: Boolean(deepl.key), source: deepl.key ? deepl.source : '' };
}

// Translates a list of texts, keeping their order.
async function translateTexts(body) {
  if (!deepl.key) throw Object.assign(new Error('Add a DeepL API key in Settings to translate recipes.'), { status: 503 });
  const texts = Array.isArray(body?.texts) ? body.texts.map((text) => String(text ?? '')) : [];
  const target = body?.target === 'nl' ? 'nl' : 'en';
  if (!texts.length || texts.length > 400 || texts.join('').length > 60000) throw Object.assign(new Error('Nothing to translate, or too much at once.'), { status: 400 });
  const translated = [];
  for (const chunk of deeplChunks(texts)) {
    const result = await callDeepl('/translate', deepl.key, deeplRequestBody(chunk, target, body?.source === 'nl' || body?.source === 'en' ? body.source : ''));
    translated.push(...(result.translations || []).map((entry) => entry.text));
  }
  return { texts: translated };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, kitchen.state ? { ...kitchen.state, _revision: kitchen.revision } : null);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/state/revision') {
      sendJson(response, 200, { revision: kitchen.revision, devices: liveClients.size });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      openLiveStream(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/state') {
      const result = await receiveKitchen(await requestBody(request));
      sendJson(response, result.status, result.body);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/recipes/import') {
      try {
        sendJson(response, 200, await importRecipeFromUrl(url.searchParams.get('url') || ''));
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        sendJson(response, error?.status || 502, { error: timedOut ? 'The website took too long to answer.' : error?.status ? error.message : 'Could not reach that website.' });
      }
      return;
    }
    if (url.pathname === '/api/translate/status' || url.pathname === '/api/translate/config' || url.pathname === '/api/translate') {
      try {
        if (request.method === 'GET' && url.pathname === '/api/translate/status') sendJson(response, 200, await deeplStatus());
        else if (request.method === 'POST' && url.pathname === '/api/translate/config') sendJson(response, 200, await connectDeepl(await requestBody(request)));
        else if (request.method === 'DELETE' && url.pathname === '/api/translate/config') sendJson(response, 200, await disconnectDeepl());
        else if (request.method === 'POST' && url.pathname === '/api/translate') sendJson(response, 200, await translateTexts(await requestBody(request)));
        else sendJson(response, 405, { error: 'Method not allowed' });
      } catch (error) {
        sendJson(response, error?.status || 502, { error: error?.status ? error.message : 'Translation failed.' });
      }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/mealie/status') {
      sendJson(response, 200, mealieStatus());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/mealie/config') {
      try {
        sendJson(response, 200, await connectMealie(await requestBody(request)));
      } catch (error) {
        sendJson(response, error?.status || 502, { error: error?.status ? error.message : 'Could not save the Mealie settings.' });
      }
      return;
    }
    if (request.method === 'DELETE' && url.pathname === '/api/mealie/config') {
      sendJson(response, 200, await disconnectMealie());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/shopping/share') {
      const payload = await requestBody(request);
      if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 200) {
        sendJson(response, 400, { error: 'The shopping list must contain between 1 and 200 items' });
        return;
      }
      const items = payload.items.map((item) => ({
        name: safeExportText(item?.name, 120),
        quantity: safeExportText(item?.quantity, 30),
        unit: safeExportText(item?.unit, 30),
        checked: Boolean(item?.checked),
      })).filter((item) => item.name);
      if (!items.length) {
        sendJson(response, 400, { error: 'The shopping list has no named items' });
        return;
      }
      const now = Date.now();
      for (const [token, share] of shoppingShares) if (share.expiresAt <= now) shoppingShares.delete(token);
      const token = randomBytes(18).toString('base64url');
      const expiresAt = now + shoppingShareLifetime;
      shoppingShares.set(token, { items, expiresAt });
      let shareOrigin;
      try {
        const origin = new URL(request.headers.origin || '');
        if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid origin');
        shareOrigin = origin.origin;
      } catch {
        const protocol = String(request.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
        if (!request.headers.host || !['http', 'https'].includes(protocol)) {
          sendJson(response, 400, { error: 'Could not determine the application address for the QR code' });
          return;
        }
        shareOrigin = `${protocol}://${request.headers.host}`;
      }
      const shareUrl = new URL(`/api/shopping/download/${token}`, shareOrigin).toString();
      const qrCode = await QRCode.toDataURL(shareUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
        color: { dark: '#1e3528', light: '#ffffff' },
      });
      sendJson(response, 201, { url: shareUrl, qrCode, expiresAt });
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/shopping/download/')) {
      const token = url.pathname.slice('/api/shopping/download/'.length);
      const share = shoppingShares.get(token);
      if (!share || share.expiresAt <= Date.now()) {
        shoppingShares.delete(token);
        response.writeHead(410, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        response.end('This shopping-list download link has expired. Create a new QR code in Goodstock.');
        return;
      }
      const lines = [
        'Goodstock shopping list',
        `Created: ${new Date().toLocaleString()}`,
        '',
        ...share.items.map((item) => {
          const amount = [item.quantity, item.unit].filter(Boolean).join(' ');
          return `[${item.checked ? 'x' : ' '}] ${item.name}${amount ? ` (${amount})` : ''}`;
        }),
      ];
      response.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': 'attachment; filename="goodstock-shopping-list.txt"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(lines.join('\n'));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/mealie/recipes') {
      if (!mealieConfigured()) {
        sendJson(response, 503, { error: 'Mealie is not configured' });
        return;
      }
      const search = url.searchParams.get('search') || '';
      const query = new URLSearchParams({ search, perPage: '40' });
      const payload = await fetchMealie(`/recipes?${query}`);
      sendJson(response, 200, mealieRows(payload).map(mapMealieRecipe));
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/mealie/open/')) {
      if (!mealieConfigured()) {
        sendJson(response, 503, { error: 'Mealie is not configured' });
        return;
      }
      const slug = decodeURIComponent(url.pathname.slice('/api/mealie/open/'.length));
      response.writeHead(302, { location: await openMealieRecipeUrl(slug), 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/mealie/recipes/')) {
      if (!mealieConfigured()) {
        sendJson(response, 503, { error: 'Mealie is not configured' });
        return;
      }
      const slug = decodeURIComponent(url.pathname.slice('/api/mealie/recipes/'.length));
      const recipe = await fetchMealie(`/recipes/${encodeURIComponent(slug)}`);
      sendJson(response, 200, mapMealieRecipe(recipe));
      return;
    }
    // Bundled fonts: only plain names from the fonts folder, never other paths.
    const fontFile = /^\/fonts\/([a-z0-9-]+\.(woff2|css))$/.exec(url.pathname);
    if (request.method === 'GET' && fontFile) {
      try {
        const contents = await readFile(join(process.cwd(), 'fonts', fontFile[1]));
        response.writeHead(200, { 'content-type': fontFile[2] === 'css' ? 'text/css; charset=utf-8' : 'font/woff2', 'cache-control': 'public, max-age=604800' });
        response.end(contents);
      } catch {
        sendJson(response, 404, { error: 'Not found' });
      }
      return;
    }
    if (request.method === 'GET' && staticFiles.has(url.pathname)) {
      const [file, contentType] = staticFiles.get(url.pathname);
      const contents = await readFile(join(process.cwd(), file));
      response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
      response.end(contents);
      return;
    }
    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    const status = error.message === 'Request body is too large' ? 413 : 502;
    sendJson(response, status, { error: error.message || 'Request failed' });
  }
});

await loadKitchen();
await loadMealieConfig();
await loadDeeplConfig();
server.listen(port, '0.0.0.0', () => {
  console.log(`Goodstock listening on port ${port}`);
});