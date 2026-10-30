// The kitchen tablet check: the app in Chromium 80 (puppeteer 2.1.1), the engine of the tablet's Chrome 81.
// A fresh server, then every page on a tablet-sized screen, the main dialogs, cook mode and a language switch.
// Any script error fails it, so a `??=`, `.at()` or `replaceAll` that Chrome 81 can't run is caught before it
// reaches the tablet.
//
//   cd tests/chrome80 && npm install && node run.cjs
//
// GitHub runs it in .github/workflows/tests.yml ("Kitchen tablet (Chromium 80)").
const { spawn } = require('child_process');
const { mkdtempSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const net = require('net');
const puppeteer = require('puppeteer');

const root = join(__dirname, '..', '..');
const fail = [];
const log = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve) => { const probe = net.createServer().listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });

async function main() {
  const port = await freePort();
  const data = mkdtempSync(join(tmpdir(), 'goodstock-chrome80-'));
  const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: data }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    server.stdout.on('data', (chunk) => { if (/listening/i.test(chunk)) { clearTimeout(timer); resolve(); } });
  });
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const version = await browser.version();
    log.push(`browser: ${version}`);
    if (!/Chrome\/80\./.test(version)) fail.push(`expected Chromium 80, got ${version}`);
    const page = await browser.newPage();
    page.on('pageerror', (error) => fail.push(`script error: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error' && !/favicon|net::ERR|Failed to load resource/.test(message.text())) fail.push(`console error: ${message.text()}`); });
    await page.setViewport({ width: 1280, height: 800 }); // The GT-P5210 in landscape.
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#view-container .page-heading', { timeout: 15000 });
    const flexGap = await page.evaluate(() => document.documentElement.classList.contains('no-flex-gap'));
    log.push(`no-flex-gap fallback: ${flexGap}`);
    if (!flexGap) fail.push('the .no-flex-gap fallback is not switched on in Chromium 80');

    for (const view of ['inventory', 'week', 'shopping', 'recipes', 'tools']) {
      // Clicked in the page: the text size zooms it (115% by default), and Chromium 80 reports element boxes
      // without that zoom, so page.click() would land on the button above.
      await page.evaluate((name) => document.querySelector(`.nav-item[data-view="${name}"]`).click(), view);
      await wait(200);
      const heading = await page.evaluate(() => (document.querySelector('#view-container .page-heading h1') || {}).textContent || '');
      log.push(`${view}: ${heading}`);
      if (!heading) fail.push(`${view}: page did not render`);
    }
    // The Tools tab's other parts, a recipe page, and the main dialogs.
    await page.evaluate(() => { for (const tab of ['convert', 'terms', 'timers']) document.querySelector(`[data-action="tools-tab"][data-tab="${tab}"]`).click(); });
    await page.evaluate(() => openRecipePage(state.recipes[0].id));
    await wait(200);
    if (!(await page.$('.recipe-method-step'))) fail.push('recipe page has no steps');
    const dialogs = await page.evaluate(async () => {
      const open = [];
      const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
      document.querySelector('#settings-button').click(); await pause();
      for (const tab of ['connections', 'data', 'general']) { showSettingsTab(tab); await pause(); }
      open.push(document.querySelector('#settings-dialog').open); document.querySelector('#settings-dialog').close();
      openItemDialog(); await pause(); open.push(document.querySelector('#item-dialog').open); document.querySelector('#item-dialog').close();
      openRecipeEditor(); await pause(); open.push(document.querySelector('#recipe-edit-dialog').open); document.querySelector('#recipe-edit-dialog').close();
      startCookSteps(state.recipes[0], ''); await pause();
      for (let step = 0; step < 4; step++) { moveCookStep(1); await pause(); }
      open.push(document.querySelector('#steps-dialog').open); document.querySelector('#steps-dialog').close();
      return open;
    });
    if (dialogs.some((open) => !open)) fail.push(`a dialog did not open: ${JSON.stringify(dialogs)}`);
    // Another language, and the week page with a plan in it.
    await page.evaluate(async () => {
      await setLanguage('nl');
      state.plan.push({ id: 'chrome80', date: dateKey(new Date()), recipeId: state.recipes[1].id, cooked: false });
      activeView = 'week';
      render();
    });
    await wait(300);
    const dutch = await page.evaluate(() => document.querySelector('#view-container .page-heading h1').textContent);
    log.push(`week in Dutch: ${dutch}`);
    if (dutch === 'Make room for dinner.') fail.push('switching to Dutch did not translate the page');
    // A phone-sized screen too (other people's phones may use the same server).
    await page.setViewport({ width: 400, height: 800 });
    await page.evaluate(() => { activeView = 'inventory'; render(); });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) fail.push(`phone width: page is ${overflow}px wider than the screen`);
  } finally {
    await browser.close();
    server.kill();
    rmSync(data, { recursive: true, force: true });
  }
}

main().catch((error) => fail.push(String(error && error.stack || error))).then(() => {
  for (const line of log) console.log(`  ${line}`);
  for (const line of fail) console.log(`✗ ${line}`);
  console.log(fail.length ? `FAIL  kitchen tablet (Chromium 80): ${fail.length} problem(s)` : 'PASS  kitchen tablet (Chromium 80)');
  process.exit(fail.length ? 1 : 0);
});
