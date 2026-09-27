import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';

const port = Number(process.env.PORT || 8080);
const dataDirectory = process.env.DATA_DIR || './data';
const statePath = join(dataDirectory, 'state.json');
// Accept "mealie.example.com" as well as full URLs; without a scheme, redirects become relative and loop.
const normalizeBaseUrl = (value) => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  return trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
};
const mealieUrl = normalizeBaseUrl(process.env.MEALIE_URL);
const mealieKey = process.env.MEALIE_API_KEY || '';
const mealiePublicUrl = normalizeBaseUrl(process.env.MEALIE_PUBLIC_URL) || mealieUrl;
let mealieGroupSlug = '';
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
]);

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body is too large');
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

function mapMealieRecipe(recipe) {
  const ingredientRows = recipe.recipeIngredient || recipe.ingredients || [];
  const ingredients = ingredientRows.map((row) => {
    const name = row.food?.name || row.ingredient?.name || row.note || row.name || '';
    const amount = Number(row.quantity) > 0 ? String(Math.round(Number(row.quantity) * 1000) / 1000) : '';
    const unit = row.unit?.name || row.unit || '';
    return [amount, unit, name].filter(Boolean).join(' ').trim();
  }).filter(Boolean);
  const instructions = (recipe.recipeInstructions || [])
    .flatMap((step) => [step.title, typeof step === 'string' ? step : step.text])
    .map((text) => String(text || '').trim())
    .filter((text) => text && !/^could not detect instructions$/i.test(text));
  return {
    id: String(recipe.slug || recipe.id || recipe.name),
    slug: String(recipe.slug || recipe.id || ''),
    name: recipe.name || 'Untitled recipe',
    description: recipe.description || '',
    image: recipe.image || recipe.recipeImage || '',
    ingredients,
    instructions,
    source: 'Mealie',
  };
}

async function fetchMealie(path) {
  const result = await fetch(`${mealieUrl}/api${path}`, {
    headers: { authorization: `Bearer ${mealieKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!result.ok) throw new Error(`Mealie returned HTTP ${result.status}`);
  return result.json();
}

async function mealieRecipePageUrl(slug) {
  if (!mealieGroupSlug) {
    try {
      mealieGroupSlug = (await fetchMealie('/groups/self')).slug || '';
    } catch { /* Fall back to Mealie's default group below. */ }
  }
  return `${mealiePublicUrl}/g/${encodeURIComponent(mealieGroupSlug || 'home')}/r/${encodeURIComponent(slug)}`;
}

function safeExportText(value, limit) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, await readState());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/state') {
      const state = await requestBody(request);
      if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.inventory) || !Array.isArray(state.recipes)) {
        sendJson(response, 400, { error: 'Invalid kitchen state' });
        return;
      }
      await saveState(state);
      sendJson(response, 200, { saved: true });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/mealie/status') {
      sendJson(response, 200, { configured: Boolean(mealieUrl && mealieKey) });
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
      if (!mealieUrl || !mealieKey) {
        sendJson(response, 503, { error: 'Mealie is not configured' });
        return;
      }
      const search = url.searchParams.get('search') || '';
      const query = new URLSearchParams({ search, perPage: '40' });
      const payload = await fetchMealie(`/recipes?${query}`);
      const rows = Array.isArray(payload) ? payload : payload.items || payload.recipes || [];
      sendJson(response, 200, rows.map(mapMealieRecipe));
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/mealie/open/')) {
      if (!mealiePublicUrl || !mealieKey) {
        sendJson(response, 503, { error: 'Mealie is not configured' });
        return;
      }
      const slug = decodeURIComponent(url.pathname.slice('/api/mealie/open/'.length));
      response.writeHead(302, { location: await mealieRecipePageUrl(slug), 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/mealie/recipes/')) {
      if (!mealieUrl || !mealieKey) {
        sendJson(response, 503, { error: 'Mealie is not configured' });
        return;
      }
      const slug = decodeURIComponent(url.pathname.slice('/api/mealie/recipes/'.length));
      const recipe = await fetchMealie(`/recipes/${encodeURIComponent(slug)}`);
      sendJson(response, 200, mapMealieRecipe(recipe));
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

server.listen(port, '0.0.0.0', () => {
  console.log(`Goodstock listening on port ${port}`);
});