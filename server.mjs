import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const port = Number(process.env.PORT || 8080);
const dataDirectory = process.env.DATA_DIR || './data';
const statePath = join(dataDirectory, 'state.json');
const mealieUrl = (process.env.MEALIE_URL || '').replace(/\/+$/, '');
const mealieKey = process.env.MEALIE_API_KEY || '';
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/ingredients.json', ['ingredients.json', 'application/json; charset=utf-8']],
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
    const amount = row.quantity == null ? '' : String(row.quantity);
    const unit = row.unit?.name || row.unit || '';
    return [amount, unit, name].filter(Boolean).join(' ').trim();
  }).filter(Boolean);
  return {
    id: String(recipe.slug || recipe.id || recipe.name),
    slug: String(recipe.slug || recipe.id || ''),
    name: recipe.name || 'Untitled recipe',
    description: recipe.description || '',
    image: recipe.image || recipe.recipeImage || '',
    ingredients,
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