// The server's own API, without a page: parallel saves from the same revision (exactly one wins, the others get 409),
// a large body full of multi-byte characters survives unchanged, bodies that are not JSON get 400, shopping-list
// shares refuse a null payload, and static files answer HEAD.
export default async function run({ base }) {
  const fail = [];
  const log = [];
  const post = (path, body, raw = false) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? body : JSON.stringify(body) });
  const kitchen = (name) => ({ inventory: [{ id: name, name }], recipes: [], shopping: [], plan: [] });

  const first = await post('/api/state', { state: kitchen('start'), baseRevision: 0, client: 'test' });
  const { revision } = await first.json();
  if (first.status !== 200) fail.push(`first save: ${first.status}`);

  // Three devices save from the same revision at once.
  const answers = await Promise.all(['a', 'b', 'c'].map((name) => post('/api/state', { state: kitchen(name), baseRevision: revision, client: name })));
  const statuses = answers.map((answer) => answer.status).sort();
  log.push(`parallel saves: ${statuses.join(' ')}`);
  if (statuses.join(' ') !== '200 409 409') fail.push(`parallel saves from one revision should give one 200 and two 409, got ${statuses.join(' ')}`);
  const winner = await answers.find((answer) => answer.status === 200)?.json();
  const now = await fetch(`${base}/api/state`).then((answer) => answer.json());
  if (winner?.revision !== revision + 1 || now._revision !== revision + 1) fail.push(`revision after the race: ${winner?.revision} / ${now._revision}`);

  // About 3 MB of text in many languages: read as bytes, so characters split between network chunks stay whole.
  const text = 'Crème brûlée · Ψάρι · 寿司 · 🍅🥕 · ש״ח · '.repeat(60_000);
  const big = await post('/api/state', { state: { ...kitchen('big'), notes: text }, baseRevision: now._revision, client: 'test' });
  const back = await fetch(`${base}/api/state`).then((answer) => answer.json());
  log.push(`large body: ${big.status}, ${Buffer.byteLength(text)} bytes`);
  if (big.status !== 200 || back.notes !== text) fail.push(`a large UTF-8 body did not come back unchanged (${big.status}, ${back.notes?.length} vs ${text.length})`);

  // Broken JSON is the sender's mistake: 400, not a 502 with the parser's message.
  for (const path of ['/api/state', '/api/shopping/share', '/api/auth/login']) {
    const broken = await post(path, '{"state": [1, 2', true);
    if (broken.status !== 400) fail.push(`broken JSON to ${path}: ${broken.status}`);
  }
  for (const body of ['null', '42', '"text"']) {
    const share = await post('/api/shopping/share', body, true);
    if (share.status !== 400) fail.push(`a shopping share of ${body}: ${share.status}`);
    const login = await post('/api/auth/login', body, true);
    if (login.status >= 500) fail.push(`a login with ${body}: ${login.status}`);
  }

  // HEAD: headers only.
  for (const path of ['/', '/index.html', '/styles.css', '/fonts/fonts.css']) {
    const head = await fetch(`${base}${path}`, { method: 'HEAD' });
    if (head.status !== 200 || (await head.text()) !== '') fail.push(`HEAD ${path}: ${head.status}`);
  }
  return { fail, log };
}
