// Old browsers on the server version (0.43): index.html sends a browser that can't run the app (no ?. and ??, so
// older than Chrome 80) to legacy/index.html, the copy built by tools/build-legacy.mjs, which the server serves and
// which uses the shared kitchen like any page. A new browser stays where it is. The "old" browser here is Chromium
// with a Function constructor that refuses ?., which is what the check tries.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  if (!existsSync('legacy/index.html')) {
    const build = spawnSync(process.execPath, ['tools/build-legacy.mjs'], { encoding: 'utf8' });
    if (build.status !== 0) return { fail: [`legacy build failed: ${build.stderr.slice(0, 300)}`], log };
  }

  const modern = await browser.newPage();
  await modern.goto(`${base}/`, { waitUntil: 'networkidle2' });
  log.push(`new browser: ${new URL(modern.url()).pathname}`);
  if (new URL(modern.url()).pathname.startsWith('/legacy/')) fail.push('a new browser was sent to the old-browser page');
  await modern.close();

  const old = await browser.newPage();
  old.on('pageerror', (error) => fail.push(`page error: ${error.message}`));
  await old.evaluateOnNewDocument(() => {
    // Only on the normal page: the old-browser page's polyfills need the real Function.
    if (location.pathname.startsWith('/legacy/')) return;
    const RealFunction = window.Function;
    window.Function = function (...args) {
      if (/\?\.|\?\?/.test(String(args[args.length - 1]))) throw new SyntaxError('Unexpected token .');
      return RealFunction(...args);
    };
  });
  await old.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  log.push(`old browser: ${new URL(old.url()).pathname}`);
  if (new URL(old.url()).pathname !== '/legacy/index.html') fail.push(`an old browser was not sent to /legacy/index.html: ${old.url()}`);
  try {
    await old.waitForSelector('#view-container .page-heading h1', { timeout: 15000 });
    // The legacy page talks to the server: an item added there reaches the shared kitchen.
    await old.evaluate(() => {
      state.inventory.push({ id: 'from-old-browser', name: 'Old tablet rice', quantity: 1, unit: 'bag', location: state.locations[0], kind: 'Food' });
      persist();
    });
    let saved = false;
    for (let attempt = 0; attempt < 20 && !saved; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const shared = await (await fetch(`${base}/api/state`)).json();
      saved = (shared.inventory || shared.state?.inventory || []).some((item) => item.id === 'from-old-browser');
    }
    if (!saved) fail.push('an item added on the old-browser page did not reach the server');
    log.push(`legacy page saved to the server: ${saved}, standalone: ${await old.evaluate(() => STANDALONE)}`);
  } catch (error) {
    fail.push(`the old-browser page did not start: ${error.message}`);
  }
  await old.close();
  return { fail, log };
}
