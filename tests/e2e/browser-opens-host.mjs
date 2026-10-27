// A browser opens a hosting phone or computer by its address (4.6.2): the host serves the app's own files, marks the
// page as hosted, asks for the PIN once (then a cookie), and the browser shares the kitchen with the host. The
// desktop host from desktop/native.js stands in for KitchenHost.java, which works the same way.
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const native = createRequire(import.meta.url)('../../desktop/native.js');

export default async function run({ browser }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const folder = await mkdtemp(join(tmpdir(), 'goodstock-hosted-'));
  const secrets = native.makeHostSecrets();
  const host = native.createKitchenHost({ file: join(folder, 'host-kitchen.json'), webRoot: process.cwd(), ...secrets });
  await host.load();
  const running = await native.startKitchenHost(host, [0]);
  const address = `http://127.0.0.1:${running.port}`;
  const context = await browser.createBrowserContext();
  try {
    // The files: pages are marked hosted; nothing outside the web files, and no service worker.
    const index = await fetch(`${address}/`);
    if (!(await index.text()).includes('<html data-hosted="1"')) fail.push('the page is not marked as hosted');
    for (const path of ['/..%2Fpackage.json', '/sw.js', '/server.mjs.bak', '/nothing.js']) {
      const answer = await fetch(`${address}${path}`);
      if (answer.status !== 404) fail.push(`${path} answered ${answer.status}`);
    }
    if ((await fetch(`${address}/api/state`)).status !== 401) fail.push('the kitchen is open without the PIN');

    // The browser asks for the PIN, keeps a cookie and puts its kitchen on the host.
    const page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    page.on('pageerror', (error) => fail.push(`page: ${error.message}`));
    await page.goto(`${address}/`, { waitUntil: 'networkidle2' });
    await wait(800);
    if (!(await page.evaluate(() => HOSTED && document.documentElement.classList.contains('is-hosted')))) fail.push('the page does not know it is hosted');
    if (!(await page.evaluate(() => document.querySelector('#pin-dialog').open))) fail.push('the browser was not asked for the PIN');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.evaluate((pin) => unlockWithPin(pin), secrets.pin)]);
    const cookies = await page.cookies();
    if (!cookies.some((cookie) => cookie.name === 'goodstock-host' && cookie.httpOnly)) fail.push('no sign-in cookie after the PIN');
    await page.evaluate(() => { state.inventory.unshift({ id: makeId(), name: 'Browser Pears', quantity: 3, unit: 'pcs', location: state.locations[0], kind: 'Food' }); persist(); });
    await wait(1200);
    const kitchen = await (await fetch(`${address}/api/state`, { headers: { authorization: `Bearer ${secrets.token}` } })).json();
    if (!kitchen || !kitchen.inventory.some((item) => item.name === 'Browser Pears')) fail.push('the browser kitchen did not reach the host');

    // A change on the host side (another device) shows up in the browser by polling.
    const changed = { ...kitchen, inventory: [{ id: 'host-1', name: 'Host Lemons', quantity: 2, unit: 'pcs', location: kitchen.locations[0], kind: 'Food' }, ...kitchen.inventory] };
    const saved = await fetch(`${address}/api/state`, { method: 'POST', headers: { authorization: `Bearer ${secrets.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ state: changed, baseRevision: kitchen._revision }) });
    if (!saved.ok) fail.push(`saving on the host failed: ${saved.status}`);
    await wait(7000);
    const names = await page.evaluate(() => state.inventory.map((item) => item.name));
    if (!names.includes('Host Lemons')) fail.push(`the browser did not pick up the host's change: ${names.join(', ')}`);
    const status = await page.evaluate(() => document.querySelector('#sync-detail').textContent);
    log.push(`status: ${status}`);
    if (!status.includes(`127.0.0.1:${running.port}`)) fail.push(`status does not name the host: ${status}`);

    // What only the Docker server has is not offered: Mealie, DeepL, server backups, PIN settings, QR lists.
    await page.evaluate(() => document.querySelector('#settings-button').click());
    await wait(300);
    const shown = await page.evaluate(() => ['#mealie-settings', '#deepl-settings', '#pin-settings', '#calendar-settings', '#server-backups-zone']
      .filter((selector) => { const element = document.querySelector(selector); return element && !element.hidden && getComputedStyle(element).display !== 'none'; }));
    if (shown.length) fail.push(`server-only settings shown: ${shown.join(', ')}`);
    await page.evaluate(() => { document.querySelector('#settings-dialog').close(); activeView = 'shopping'; state.shopping = [{ id: 's1', name: 'Milk', quantity: 1, unit: 'l' }]; render(); });
    if (await page.evaluate(() => Boolean(document.querySelector('[data-action="show-shopping-qr"]')))) fail.push('the QR share button is shown');
    await page.close();
  } finally {
    running.server.close();
    await context.close();
    await rm(folder, { recursive: true, force: true });
  }
  return { fail, log };
}
