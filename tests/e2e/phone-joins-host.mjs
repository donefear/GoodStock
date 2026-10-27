// One app hosts the kitchen (the desktop host from desktop/native.js, the same API as KitchenHost.java) and another
// phone joins it under Home server with the host's PIN. Both pages talk to the host through Node, as the apps'
// native bridges do, so no browser CORS rules get in the way.
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const native = createRequire(import.meta.url)('../../desktop/native.js');

// Replaces the shim's web requests with Node ones, and gives the host page the native host calls.
const bridgeOverrides = `
  (function () {
    function answer(id, ok, payload) { setTimeout(function () { window.__goodstockNativeCallback(id, ok, payload); }, 5); }
    function node(id, method, url, headers, body) {
      window.__nodeHttp(method, url, headers || '{}', body || '').then(function (json) { answer(id, true, json); }, function (error) { answer(id, false, String(error)); });
    }
    GoodstockNative.httpRequest = function (id, url, headers) { node(id, 'GET', url, headers, ''); };
    GoodstockNative.httpSend = function (id, method, url, headers, body) { node(id, method, url, headers, body); };
    if (window.__startHost) {
      GoodstockNative.canHostKitchen = function () { return true; };
      GoodstockNative.startKitchenHost = function (id) { window.__startHost().then(function (json) { answer(id, true, json); }, function (error) { answer(id, false, String(error)); }); };
      GoodstockNative.stopKitchenHost = function () { window.__stopHost(); };
    }
  })();
`;

export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const folder = await mkdtemp(join(tmpdir(), 'goodstock-host-'));
  const secrets = native.makeHostSecrets();
  let running = null;
  const nodeHttp = async (method, url, headers, body) => JSON.stringify(await native.httpRequest({ method, url, headers: JSON.parse(headers), body: method === 'GET' ? null : body }));

  async function openApp(hosting) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    page.on('pageerror', (error) => fail.push(`page: ${error.message}`));
    await page.exposeFunction('__nodeHttp', nodeHttp);
    if (hosting) {
      await page.exposeFunction('__startHost', async () => {
        if (!running) {
          const host = native.createKitchenHost({ file: join(folder, 'host-kitchen.json'), ...secrets });
          await host.load();
          running = await native.startKitchenHost(host, [0]);
        }
        return JSON.stringify({ port: running.port, addresses: ['192.168.1.50'], pin: secrets.pin, token: secrets.token });
      });
      await page.exposeFunction('__stopHost', () => { if (running) running.server.close(); running = null; });
    }
    await page.evaluateOnNewDocument(phoneShim);
    await page.evaluateOnNewDocument(bridgeOverrides);
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
    return { context, page };
  }

  const hostApp = await openApp(true);
  const phoneApp = await openApp(false);
  const host = hostApp.page;
  const phone = phoneApp.page;
  try {
    // The host and its own API, straight over HTTP.
    await host.evaluate(() => { state.inventory.unshift({ id: makeId(), name: 'Host Rice', quantity: 1, unit: 'kg', location: state.locations[0], kind: 'Food' }); persist(); });
    await host.evaluate(() => { document.querySelector('#settings-button').click(); });
    await wait(300);
    if (await host.evaluate(() => document.querySelector('#host-settings').hidden)) fail.push('the Host section is not shown');
    // Mealie is for the Docker server only (4.6.2).
    if (await host.evaluate(() => getComputedStyle(document.querySelector('#mealie-settings')).display !== 'none')) fail.push('the phone app offers Mealie');
    if (await host.evaluate(() => { activeView = 'recipes'; render(); return Boolean(document.querySelector('.integration-note')); })) fail.push('the phone app shows "Already using Mealie?" on Recipes');
    await host.evaluate(() => beginHosting());
    await wait(800);
    const details = await host.evaluate(() => document.querySelector('#host-details').textContent);
    log.push(`host shows: ${details}`);
    if (!details.includes(secrets.pin) || !details.includes(`192.168.1.50:${running.port}`)) fail.push(`the address and PIN are not shown: ${details}`);
    const address = `http://127.0.0.1:${running.port}`;
    const closed = await fetch(`${address}/api/state`);
    if (closed.status !== 401 || (await closed.json()).code !== 'pin') fail.push('the host answers without the PIN');
    const wrong = await fetch(`${address}/api/auth/login`, { method: 'POST', body: '{"pin":"x"}' });
    if (wrong.status !== 401) fail.push(`a wrong PIN was accepted: ${wrong.status}`);
    const hosted = await (await fetch(`${address}/api/state`, { headers: { authorization: `Bearer ${secrets.token}` } })).json();
    if (!hosted || !hosted.inventory.some((item) => item.name === 'Host Rice')) fail.push('the host page did not put its kitchen on the host');

    // The phone joins with the PIN and gets the host's kitchen; changes go both ways.
    await phone.evaluate(() => { state.inventory.unshift({ id: makeId(), name: 'Phone Apples', quantity: 6, unit: 'pcs', location: state.locations[0], kind: 'Food' }); persist(); });
    await phone.evaluate(() => document.querySelector('#settings-button').click());
    await wait(300);
    await phone.evaluate((value) => { document.querySelector('#settings-form').elements.homeServer.value = value; return connectHomeServer(); }, `127.0.0.1:${running.port}`);
    await wait(500);
    if (!(await phone.evaluate(() => document.querySelector('#pin-dialog').open))) fail.push('the phone was not asked for the host PIN');
    await phone.evaluate((pin) => unlockWithPin(pin), secrets.pin);
    await wait(1500);
    const phoneNames = await phone.evaluate(() => state.inventory.map((item) => item.name));
    if (!phoneNames.includes('Host Rice') || !phoneNames.includes('Phone Apples')) fail.push(`the phone did not get both kitchens: ${phoneNames.join(', ')}`);
    await host.evaluate(() => checkRemoteRevision());
    await wait(1200);
    const hostNames = await host.evaluate(() => state.inventory.map((item) => item.name));
    if (!hostNames.includes('Phone Apples')) fail.push('the phone item did not reach the host page');
    const hostStatus = await host.evaluate(() => document.querySelector('#sync-detail').textContent);
    log.push(`host status: ${hostStatus}`);
    if (!/1/.test(hostStatus)) fail.push(`the host does not count the phone: ${hostStatus}`);

    // A restart of the host keeps the kitchen and the phone's link.
    running.server.close();
    running = null;
    await host.reload({ waitUntil: 'networkidle2' });
    await wait(800);
    if (!running) fail.push('the host did not start again after a restart');
    else {
      const after = await (await fetch(`http://127.0.0.1:${running.port}/api/state`, { headers: { authorization: `Bearer ${secrets.token}` } })).json();
      if (!after || !after.inventory.some((item) => item.name === 'Phone Apples')) fail.push('the hosted kitchen was lost on restart');
    }

    await host.evaluate(() => endHosting());
    if (running) fail.push('the host still runs after Stop hosting');
    if (await host.evaluate(() => isShared() || Boolean(hosting()))) fail.push('the host page still shares after Stop hosting');
  } finally {
    if (running) running.server.close();
    await hostApp.context.close();
    await phoneApp.context.close();
    await rm(folder, { recursive: true, force: true });
  }
  return { fail, log };
}
