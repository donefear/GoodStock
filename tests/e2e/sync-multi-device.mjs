// Several devices on one server kitchen: live updates, saves at the same moment (409 → merge → send again, no lost
// updates, no doubles, no endless loop), a delete never beating an edit made elsewhere, the offline queue, the device
// count, a kitchen tidied by this page (normalizeState) not beating the next edit made elsewhere, a browser whose
// storage is full, and a restore asking the server for a safety copy.
export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const LISTS = ['inventory', 'recipes', 'plan', 'shopping', 'recipeNotes'];
  const serverState = async () => { const { _revision, ...state } = await (await fetch(`${base}/api/state`)).json(); return { revision: _revision, state }; };
  const view = (state) => JSON.stringify(LISTS.map((key) => [...(state[key] || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))));

  // An empty kitchen to start from (a bare save, as old pages send).
  await fetch(`${base}/api/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inventory: [], recipes: [], plan: [], shopping: [], locations: ['Fridge', 'Pantry'] }) });

  const devices = [];
  async function device(name, setup) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const entry = { name, page, context, posts: 0 };
    page.on('pageerror', (error) => fail.push(`${name}: ${error.message}`));
    page.on('dialog', (dialog) => dialog.accept());
    page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/api/state')) entry.posts++; });
    if (setup) await page.evaluateOnNewDocument(setup);
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#view-container .page-heading');
    devices.push(entry);
    return entry;
  }
  const change = (entry, code, arg) => entry.page.evaluate(`(() => { const arg = ${JSON.stringify(arg ?? null)}; ${code}; persist(); })()`);
  const add = (entry, list, item) => change(entry, `state[${JSON.stringify(list)}].unshift(arg)`, item);
  const edit = (entry, list, id, fields) => change(entry, `Object.assign(state[${JSON.stringify(list)}].find((entry) => entry.id === arg.id), arg.fields)`, { id, fields });
  const remove = (entry, list, id) => change(entry, `state[${JSON.stringify(list)}] = state[${JSON.stringify(list)}].filter((entry) => entry.id !== arg)`, id);
  const item = (id, name, extra = {}) => ({ id, name, quantity: 1, unit: '', location: 'Fridge', kind: 'Food', ...extra });
  const pending = (entry) => entry.page.evaluate(() => Boolean(localStorage.getItem(PENDING_KEY)));
  // Waits until every open device holds the server's kitchen and has nothing left to send.
  async function settled(label, timeout = 12_000) {
    const until = Date.now() + timeout;
    let last = '';
    while (Date.now() < until) {
      // As a page holds it: pages tidy what they load (normalizeState) without saving it back.
      const raw = (await serverState()).state;
      const server = view(JSON.parse(await devices[0].page.evaluate((value) => JSON.stringify(normalizeState(value)), raw)));
      const views = await Promise.all(devices.map(async (entry) => [entry.name, await entry.page.evaluate(() => JSON.stringify(state)).then((text) => view(JSON.parse(text))), await pending(entry)]));
      const off = views.filter(([, mine, waiting]) => mine !== server || waiting).map(([name]) => name);
      if (!off.length) return true;
      last = off.join(', ');
      await wait(250);
    }
    fail.push(`${label}: not in step after ${timeout / 1000} s (${last})`);
    return false;
  }
  const has = (state, list, id) => (state[list] || []).filter((entry) => entry.id === id);
  const noDoubles = (state, label) => {
    for (const key of LISTS) {
      const ids = (state[key] || []).map((entry) => entry.id);
      if (new Set(ids).size !== ids.length) fail.push(`${label}: doubles in ${key}`);
    }
  };

  const a = await device('A');
  const b = await device('B');
  const c = await device('C');
  await wait(500);

  // The device count over the event stream.
  const counts = await Promise.all(devices.map((entry) => entry.page.evaluate(() => [liveSync.connected, liveSync.devices])));
  log.push(`live: ${JSON.stringify(counts)}`);
  if (counts.some(([connected, count]) => !connected || count !== 3)) fail.push(`device count wrong: ${JSON.stringify(counts)}`);
  const { devices: counted } = await (await fetch(`${base}/api/state/revision`)).json();
  if (counted !== 3) fail.push(`/api/state/revision counts ${counted} devices`);

  // 1. Live: one device's change reaches the others straight away.
  await add(a, 'inventory', item('a1', 'Milk'));
  const started = Date.now();
  await settled('live add');
  log.push(`live add in step after ${Date.now() - started} ms`);

  // 2. Three devices save different things at the same moment.
  const postsBefore = devices.reduce((sum, entry) => sum + entry.posts, 0);
  await Promise.all([
    add(a, 'inventory', item('a2', 'Butter')),
    add(b, 'inventory', item('b2', 'Cheese')),
    (async () => {
      await add(c, 'recipes', { id: 'c-r1', name: 'Soup', ingredients: ['1 onion'], instructions: ['Cook.'] });
      await add(c, 'recipeNotes', { id: 'c-n1', recipeId: 'c-r1', date: '2026-01-01', text: 'Good' });
    })(),
  ]);
  await settled('three at once');
  let { state: now } = await serverState();
  for (const [list, id] of [['inventory', 'a2'], ['inventory', 'b2'], ['recipes', 'c-r1'], ['recipeNotes', 'c-n1'], ['inventory', 'a1']]) {
    if (has(now, list, id).length !== 1) fail.push(`three at once: ${list} ${id} lost or doubled`);
  }
  noDoubles(now, 'three at once');
  const postsAtOnce = devices.reduce((sum, entry) => sum + entry.posts, 0) - postsBefore;
  log.push(`three at once: ${postsAtOnce} saves`);
  if (postsAtOnce > 12) fail.push(`three at once took ${postsAtOnce} saves`);

  // 3. Two devices edit the same item at the same moment: one version wins whole, everywhere.
  await Promise.all([edit(a, 'inventory', 'a1', { quantity: 5 }), edit(b, 'inventory', 'a1', { quantity: 7 })]);
  await settled('same item at once');
  ({ state: now } = await serverState());
  const milk = has(now, 'inventory', 'a1');
  log.push(`same item at once: ${JSON.stringify(milk.map((entry) => entry.quantity))}`);
  if (milk.length !== 1 || ![5, 7].includes(milk[0].quantity)) fail.push(`same item at once: ${JSON.stringify(milk)}`);

  // 4. Edited on an offline device, deleted on another: the edit wins when it comes back.
  await b.page.setOfflineMode(true);
  await edit(b, 'inventory', 'a2', { quantity: 9 });
  await remove(a, 'inventory', 'a2');
  await wait(800);
  if (has((await serverState()).state, 'inventory', 'a2').length) fail.push('the delete did not reach the server');
  await b.page.setOfflineMode(false);
  await settled('edit offline, delete elsewhere');
  ({ state: now } = await serverState());
  if (has(now, 'inventory', 'a2')[0]?.quantity !== 9) fail.push(`a delete beat an edit made offline: ${JSON.stringify(has(now, 'inventory', 'a2'))}`);

  // 5. The other way round: deleted on an offline device, edited online. The edit wins.
  await a.page.setOfflineMode(true);
  await remove(a, 'inventory', 'b2');
  await edit(b, 'inventory', 'b2', { name: 'Cheese, grated' });
  await wait(800);
  await a.page.setOfflineMode(false);
  await settled('delete offline, edit elsewhere');
  ({ state: now } = await serverState());
  if (has(now, 'inventory', 'b2')[0]?.name !== 'Cheese, grated') fail.push(`a delete made offline beat an edit: ${JSON.stringify(has(now, 'inventory', 'b2'))}`);
  // A delete nobody argues with does go through.
  await remove(c, 'recipeNotes', 'c-n1');
  await settled('plain delete');
  if (has((await serverState()).state, 'recipeNotes', 'c-n1').length) fail.push('a plain delete came back');

  // 6. The offline queue: several lists changed while offline, the page says so, and it all arrives afterwards.
  await c.page.setOfflineMode(true);
  await add(c, 'shopping', { id: 'c-s1', name: 'Bread', quantity: 1, unit: '', checked: false });
  await add(c, 'plan', { id: 'c-p1', date: '2026-01-02', recipeId: 'c-r1' });
  await edit(c, 'recipes', 'c-r1', { name: 'Onion soup' });
  await add(a, 'shopping', { id: 'a-s1', name: 'Apples', quantity: 1, unit: '', checked: false });
  const offlineLabel = await c.page.evaluate(() => document.querySelector('#sync-label').textContent);
  log.push(`offline label: ${offlineLabel}`);
  if (!(await pending(c))) fail.push('offline changes are not queued');
  if ((await serverState()).state.shopping.some((entry) => entry.id === 'c-s1')) fail.push('an offline change reached the server');
  await c.page.setOfflineMode(false);
  await settled('offline queue');
  ({ state: now } = await serverState());
  for (const [list, id] of [['shopping', 'c-s1'], ['shopping', 'a-s1'], ['plan', 'c-p1']]) if (has(now, list, id).length !== 1) fail.push(`offline queue: ${list} ${id} lost or doubled`);
  if (has(now, 'recipes', 'c-r1')[0]?.name !== 'Onion soup') fail.push('offline queue: the recipe edit was lost');
  noDoubles(now, 'offline queue');

  // 7. No endless loop: once in step, nobody keeps saving.
  const quietFrom = devices.map((entry) => entry.posts);
  await wait(3000);
  const extra = devices.map((entry, index) => entry.posts - quietFrom[index]);
  if (extra.some(Boolean)) fail.push(`devices keep saving when in step: ${extra.join(' ')}`);

  // 8. A kitchen this page tidies (imperial amounts become metric) must not look "changed here": another device's
  // later edit of that item wins. The other device here is a plain API client that saves pounds.
  const apiSave = async (mutate) => {
    for (let tries = 0; tries < 5; tries++) {
      const { revision, state } = await serverState();
      mutate(state);
      const answer = await fetch(`${base}/api/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, baseRevision: revision, client: 'api' }) });
      if (answer.status === 200) return;
    }
    fail.push('the API client could not save');
  };
  await apiSave((state) => { state.inventory.unshift(item('lb1', 'Flour', { quantity: 2, unit: 'lb' })); });
  await settled('tidied item');
  const tidied = await a.page.evaluate(() => state.inventory.find((entry) => entry.id === 'lb1'));
  log.push(`2 lb held as ${tidied?.quantity} ${tidied?.unit}`);
  await a.page.setOfflineMode(true);
  await add(a, 'inventory', item('a8', 'Sugar'));
  await apiSave((state) => { state.inventory.find((entry) => entry.id === 'lb1').quantity = 3; });
  await a.page.setOfflineMode(false);
  await settled('tidied item, edited elsewhere');
  const flour = has((await serverState()).state, 'inventory', 'lb1')[0];
  log.push(`after the edit elsewhere: ${flour?.quantity} ${flour?.unit}`);
  if (tidied && tidied.unit !== 'lb' && Math.abs(Number(flour?.quantity) - Number(tidied.quantity)) < 1) fail.push(`the page's tidied copy beat the edit made elsewhere: ${JSON.stringify(flour)}`);
  if (!has((await serverState()).state, 'inventory', 'a8').length) fail.push('the offline add was lost');

  // normalizeState is idempotent for kitchens like these, so a tidied base stays tidied.
  const idempotent = await a.page.evaluate(() => {
    const sample = { inventory: [{ id: 'x', name: 'Flour', quantity: 2, unit: 'lb' }, { name: 'No id', quantity: 1, unit: 'oz' }, { id: 'd', name: 'Bad date', expiresOn: '2026-02-30' }],
      recipes: [{ id: 'r', name: 'Cake', ingredients: ['2 cups flour', '1 lb butter', '8 oz sugar'], instructions: ['Bake at 350°F for 30 minutes.'] }], plan: [], shopping: [{ name: '3 lb potatoes', quantity: 3, unit: 'lb' }] };
    const once = normalizeState(sample);
    return JSON.stringify(normalizeState(JSON.parse(JSON.stringify(once)))) === JSON.stringify(once);
  });
  if (!idempotent) fail.push('normalizeState is not idempotent');

  // 9. The sync base is kept as fingerprints, not a third full copy of the kitchen (photos!).
  await add(a, 'recipes', { id: 'a-photo', name: 'Photo pie', ingredients: [], instructions: [], photo: `data:image/jpeg;base64,${'A'.repeat(300_000)}` });
  await settled('photo recipe');
  const sizes = await a.page.evaluate(() => [localStorage.getItem(STORAGE_KEY).length, (localStorage.getItem('goodstock-synced-v1') || '').length]);
  log.push(`stored kitchen ${sizes[0]} characters, sync base ${sizes[1]}`);
  if (!sizes[1] || sizes[1] > sizes[0] / 10) fail.push(`the sync base is not compact (${sizes[1]} of ${sizes[0]})`);

  // 10. A browser whose storage refuses the sync base still keeps in step without saving over and over.
  const d = await device('D', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === 'goodstock-synced-v1') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return real.call(this, key, value);
    };
  });
  await settled('full storage, first visit');
  await d.page.setOfflineMode(true);
  await add(d, 'inventory', item('d1', 'Yoghurt'));
  await edit(b, 'inventory', 'b2', { quantity: 4 });
  await wait(800);
  const dPosts = d.posts;
  await d.page.setOfflineMode(false);
  await settled('full storage');
  await wait(2000);
  log.push(`full storage: ${d.posts - dPosts} saves after reconnecting`);
  if (d.posts - dPosts > 3) fail.push(`a device with full storage saved ${d.posts - dPosts} times for one change (409 loop)`);
  ({ state: now } = await serverState());
  if (!has(now, 'inventory', 'd1').length || has(now, 'inventory', 'b2')[0]?.quantity !== 4) fail.push('full storage: a change was lost');
  const dBase = await d.page.evaluate(() => readSyncBase()?.revision);
  if (dBase !== (await serverState()).revision) fail.push(`full storage: the in-memory base is at ${dBase}`);

  // 11. A restore asks for a safety copy: the kitchen as it was is kept on the server, even for a small change.
  const safetyBefore = (await (await fetch(`${base}/api/backups`)).json()).backups.filter((backup) => backup.safety).length;
  const itemsBefore = (await serverState()).state.inventory.length;
  await a.page.evaluate(() => { requestSafetyCopy(); state.inventory = state.inventory.slice(0, -1); persist(); });
  await settled('restore');
  const safetyCopies = (await (await fetch(`${base}/api/backups`)).json()).backups.filter((backup) => backup.safety);
  log.push(`safety copies: ${safetyBefore} → ${safetyCopies.length}`);
  if (safetyCopies.length !== safetyBefore + 1 || safetyCopies[0].inventory !== itemsBefore) fail.push(`no safety copy of the kitchen before the restore (${JSON.stringify(safetyCopies[0])})`);
  if (await a.page.evaluate(() => localStorage.getItem('goodstock-safety-copy-v1'))) fail.push('the safety-copy request was not cleared after the save');
  await edit(a, 'inventory', 'a1', { quantity: 6 });
  await settled('after restore');
  if ((await (await fetch(`${base}/api/backups`)).json()).backups.filter((backup) => backup.safety).length !== safetyCopies.length) fail.push('the next save made another safety copy');

  for (const entry of devices) await entry.context.close();
  return { fail, log };
}
