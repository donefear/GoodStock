// The server restarts (an update, a reboot): open pages reconnect their live stream by themselves, a change made
// while it was down is sent afterwards and reaches the other page, the kitchen and its revision survive, and a page
// whose network blocks event streams still catches up through /api/state/revision (every 30 seconds).
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const freePort = () => new Promise((resolve) => {
  const probe = createServer().listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

export default async function run({ browser }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const port = await freePort();
  const data = await mkdtemp(join(tmpdir(), 'goodstock-restart-'));
  const base = `http://127.0.0.1:${port}`;
  let child = null;
  const start = () => new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => reject(new Error('server did not start')), 15_000);
    child.stdout.on('data', (chunk) => { if (/listening/i.test(chunk)) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code})`)); });
  });
  const stop = () => new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  const contexts = [];
  const open = async (name, blockEvents = false) => {
    const context = await browser.createBrowserContext();
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', (error) => fail.push(`${name}: ${error.message}`));
    page.on('dialog', (dialog) => dialog.accept());
    if (blockEvents) {
      await page.setRequestInterception(true);
      page.on('request', (request) => (request.url().includes('/api/events') ? request.abort() : request.continue()));
    }
    await page.goto(`${base}/index.html`, { waitUntil: blockEvents ? 'networkidle0' : 'networkidle2' });
    await page.waitForSelector('#view-container .page-heading');
    return page;
  };
  const add = (page, id, name) => page.evaluate((entry) => { state.inventory.unshift({ ...entry, quantity: 1, unit: '', location: state.locations[0], kind: 'Food' }); persist(); }, { id, name });
  const holds = (page, id) => page.evaluate((wanted) => state.inventory.some((entry) => entry.id === wanted), id);
  const waitFor = async (check, timeout) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await check()) return true; await wait(250); }
    return false;
  };
  try {
    await start();
    await fetch(`${base}/api/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inventory: [], recipes: [], plan: [], shopping: [], locations: ['Fridge'] }) });
    const a = await open('A');
    const b = await open('B');
    await add(a, 'r1', 'Before the restart');
    if (!(await waitFor(() => holds(b, 'r1'), 5000))) fail.push('a change did not reach the other page before the restart');
    const revisionBefore = (await (await fetch(`${base}/api/state/revision`)).json()).revision;

    // Down: the page queues its change and says it will retry.
    await stop();
    await waitFor(() => a.evaluate(() => !liveSync.connected), 5000);
    await add(a, 'r2', 'While the server was down');
    await wait(500);
    const label = await a.evaluate(() => [document.querySelector('#sync-label').textContent, document.querySelector('#sync-detail').textContent]);
    log.push(`while down: ${label.join(' · ')}`);
    if (!(await a.evaluate(() => Boolean(localStorage.getItem(PENDING_KEY))))) fail.push('the change made while the server was down is not queued');

    // Up again: the live streams reconnect, the queued change is sent and reaches the other page.
    await start();
    const back = Date.now();
    if (!(await waitFor(() => holds(b, 'r2'), 15_000))) fail.push('the change made while the server was down never reached the other page');
    log.push(`in step again ${Date.now() - back} ms after the restart`);
    const live = await waitFor(async () => (await Promise.all([a, b].map((page) => page.evaluate(() => liveSync.connected && liveSync.devices === 2)))).every(Boolean), 10_000);
    if (!live) fail.push(`live streams not back: ${JSON.stringify(await Promise.all([a, b].map((page) => page.evaluate(() => [liveSync.connected, liveSync.devices]))))}`);
    const { revision, state } = await (await fetch(`${base}/api/state`)).json().then(({ _revision, ...rest }) => ({ revision: _revision, state: rest }));
    if (!(revision > revisionBefore)) fail.push(`the revision went from ${revisionBefore} to ${revision} over the restart`);
    if (!state.inventory.some((entry) => entry.id === 'r1')) fail.push('the kitchen did not survive the restart');
    await wait(1500);
    if (await a.evaluate(() => Boolean(localStorage.getItem(PENDING_KEY)))) fail.push('the page still has changes waiting after the restart');

    // No event stream (blocked): the 30-second revision check catches up.
    const c = await open('C', true);
    if (await c.evaluate(() => liveSync.connected)) fail.push('the event stream was not blocked');
    await add(a, 'r3', 'Seen by polling');
    const polled = Date.now();
    if (!(await waitFor(() => holds(c, 'r3'), 40_000))) fail.push('a page without the event stream never caught up through /api/state/revision');
    else log.push(`page without events caught up after ${Math.round((Date.now() - polled) / 1000)} s`);
  } catch (error) {
    fail.push(String(error.message || error));
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    if (child && child.exitCode === null) await stop();
    await rm(data, { recursive: true, force: true });
  }
  return { fail, log };
}
