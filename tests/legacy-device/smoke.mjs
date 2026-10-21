// The old-tablet page (legacy/, tools/build-legacy.mjs) on a real old WebView, through its DevTools (0.42).
// android/legacy-check.sh installs the app on an Android 4.4 emulator and forwards the WebView's DevTools to
// localhost:9222; this reloads the page while listening for script errors, then opens every page, the main dialogs,
// cook mode, another language and the dark theme, and saves a screenshot of each page in dist/test/legacy/.
// Exits 1 on any script error or failed step. `node tests/legacy-device/smoke.mjs [port]`
//
// The code sent to the page is plain ES5 text, because Chrome 30 runs it as it is.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const port = process.argv[2] || 9222;
const out = 'dist/test/legacy';
mkdirSync(out, { recursive: true });
const fail = [];
const log = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pages = [];
for (let attempt = 0; attempt < 30 && !pages.length; attempt++) {
  try { pages = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((page) => page.type === 'page'); } catch { await wait(2000); }
}
if (!pages.length) { console.log('FAIL  no WebView page to connect to'); process.exit(1); }
log.push(`page: ${pages[0].url}`);
if (!/\/legacy\/index\.html/.test(pages[0].url)) fail.push(`the app did not open the legacy page: ${pages[0].url}`);

// Old DevTools servers reject compressed frames, so no permessage-deflate.
const socket = new WebSocket(pages[0].webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let nextId = 0;
const pending = new Map();
socket.on('message', (data) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
  if (message.method === 'Console.messageAdded') {
    const { level, text, url, line } = message.params.message;
    // CSS the old engine doesn't know is expected (the fallbacks sit next to it); script errors are not.
    if (level === 'error' && !/Invalid CSS/.test(text)) fail.push(`console: ${text} ${url || ''}:${line || ''}`);
  }
});
// A frozen device must fail the check, not hang it: every call gets two minutes (a software emulator can freeze that long while taking a screenshot).
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: no answer from the WebView within two minutes`)); }, 120_000);
  pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.wasThrown) throw new Error(`${expression.slice(0, 60)}…: ${JSON.stringify(result.result).slice(0, 300)}`);
  return result.result.value;
};
// Screenshots through adb (the whole screen, as the tablet shows it); without adb, DevTools tries (Chrome 33+).
// A screenshot that fails is noted, never a failure of the check.
const adb = (...args) => spawnSync('adb', args, { stdio: 'ignore', timeout: 20_000 }).status === 0;
const hasAdb = spawnSync('adb', ['version'], { stdio: 'ignore' }).status === 0;
const screenshot = async (name) => {
  try {
    if (hasAdb ? adb('shell', 'screencap', '-p', '/data/local/tmp/goodstock-smoke.png') && adb('pull', '/data/local/tmp/goodstock-smoke.png', `${out}/${name}.png`) : false) return;
    if (!hasAdb) {
      const { result } = await send('Page.captureScreenshot');
      if (result && result.data) { writeFileSync(`${out}/${name}.png`, Buffer.from(result.data, 'base64')); return; }
    }
  } catch {
    // Noted below.
  }
  if (!screenshot.warned) log.push('some screenshots could not be taken');
  screenshot.warned = true;
};
const step = async (name, expression, check) => {
  try {
    const value = await evaluate(`(function () { ${expression} })()`);
    // An old tablet (or a slow emulator) can take a while to load a language file or a stylesheet: the check gets
    // up to 20 seconds to come true.
    let outcome = true;
    for (let attempt = 0; attempt < 20; attempt++) {
      await wait(attempt ? 1000 : 1500);
      outcome = check ? await evaluate(`(function () { ${check} })()`) : true;
      if (outcome !== false && outcome !== null && outcome !== '') break;
    }
    log.push(`${name}: ${outcome}`);
    if (outcome === false || outcome === null || outcome === '') fail.push(`${name}: ${value} / ${outcome}`);
  } catch (error) {
    fail.push(`${name}: ${error.message}`);
  }
};

// Reload with the console on, so start-up errors are seen too, and wait for the app.
await send('Console.enable');
await send('Page.enable');
await send('Page.reload');
let started = false;
for (let attempt = 0; attempt < 60 && !started; attempt++) {
  await wait(2000);
  started = await evaluate("!!document.querySelector('#view-container .page-heading h1')").catch(() => false);
}
if (!started) fail.push('the app did not show its first page within two minutes');
// How long the page took until its scripts had run (DOMContentLoaded comes after the deferred scripts).
const timing = await evaluate('JSON.stringify({ scripts: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart, load: performance.timing.loadEventEnd - performance.timing.navigationStart })').catch(() => '{}');
log.push(`start: ${timing} ms`);
await evaluate("window.__errors = []; window.onerror = function (message, url, line) { window.__errors.push(message + ' ' + url + ':' + line); }; 1");

const heading = "var h = document.querySelector('#view-container .page-heading h1'); return h ? h.textContent : '';";
if (started) {
  for (const view of ['inventory', 'week', 'shopping', 'recipes', 'tools']) {
    await step(`page ${view}`, `document.querySelector('.nav-item[data-view="${view}"]').click(); return 1;`, heading);
    await screenshot(`light-${view}`);
  }
  await step('tools tabs', "['convert', 'terms', 'timers'].forEach(function (tab) { document.querySelector('[data-action=\"tools-tab\"][data-tab=\"' + tab + '\"]').click(); }); return 1;");
  await step('recipe page', 'openRecipePage(state.recipes[0].id); return 1;', "return document.querySelectorAll('.recipe-method-step').length;");
  await screenshot('light-recipe');
  await step('settings', "document.querySelector('#settings-button').click(); showSettingsTab('data'); return 1;", "var open = document.querySelector('#settings-dialog').open; document.querySelector('#settings-dialog').close(); return open;");
  await step('item dialog', 'openItemDialog(); return 1;', "var open = document.querySelector('#item-dialog').open; document.querySelector('#item-dialog').close(); return open;");
  await step('recipe editor', 'openRecipeEditor(); return 1;', "var open = document.querySelector('#recipe-edit-dialog').open; document.querySelector('#recipe-edit-dialog').close(); return open;");
  await step('cook mode', "startCookSteps(state.recipes[0], ''); return 1;", "moveCookStep(1); moveCookStep(1); return document.querySelector('#steps-dialog').open;");
  await screenshot('light-cook');
  await step('cook mode closed', "document.querySelector('#steps-dialog').close(); return 1;");
  await step('amounts', 'return 1;', "return metricText('8 oz butter') === '225 g butter' && kitchenToolsIn('Whisk in a bowl').length === 2;");
  await step('Dutch', "setLanguage('nl'); return 1;", "activeView = 'week'; render(); return document.querySelector('#view-container .page-heading h1').textContent !== 'Make room for dinner.';");
  await step('English again', "setLanguage('en').then(function () { activeView = 'inventory'; render(); }); return 1;", "return document.querySelector('#view-container .page-heading h1').textContent === 'Good things on hand.';");
  // Right to left: Arabic swaps in legacy/styles-rtl.css; on a tablet the sidebar's space moves to the right (a phone
  // has a bottom bar instead, so GitHub's phone-sized emulator only checks the sheet).
  await step('Arabic', "setLanguage('ar').then(function () { activeView = 'inventory'; render(); }); return 1;", "return document.getElementById('legacy-styles').getAttribute('href') === 'legacy/styles-rtl.css' && document.documentElement.dir === 'rtl' && (innerWidth <= 960 || getComputedStyle(document.querySelector('.main-area')).marginRight === '236px');");
  await wait(5000); // fonts for the new stylesheet
  await screenshot('rtl-inventory');
  await step('English after Arabic', "setLanguage('en').then(function () { render(); }); return 1;", "return document.getElementById('legacy-styles').getAttribute('href') === 'legacy/styles.css';");
  // Dark theme: legacy/styles-dark.css replaces the light sheet and the page turns dark.
  await step('dark theme', "applyTheme('dark'); return 1;", "var sheet = document.getElementById('legacy-styles'); return sheet && /styles-dark/.test(sheet.getAttribute('href')) && getComputedStyle(document.body).backgroundColor === 'rgb(21, 29, 25)';");
  for (const view of ['inventory', 'recipes']) {
    await step(`dark ${view}`, `document.querySelector('.nav-item[data-view="${view}"]').click(); return 1;`, heading);
    await screenshot(`dark-${view}`);
  }
  await step('light theme', "applyTheme('light'); return 1;", "return getComputedStyle(document.body).backgroundColor === 'rgb(244, 245, 239)';");
  const errors = await evaluate('JSON.stringify(window.__errors)').catch(() => '[]');
  for (const error of JSON.parse(errors)) fail.push(`script error: ${error}`);
}

socket.close();
for (const line of log) console.log(`  ${line}`);
for (const line of fail) console.log(`✗ ${line}`);
// On GitHub every problem is also an annotation, readable on the run page without the full log.
if (process.env.GITHUB_ACTIONS) for (const line of fail) console.log(`::error title=Old tablet::${line.replace(/\s+/g, ' ')}`);
console.log(fail.length ? `FAIL  old-tablet page: ${fail.length} problem(s)` : 'PASS  old-tablet page');
process.exit(fail.length ? 1 : 0);
