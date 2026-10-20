// Goodstock test suite: `npm test` (or `node tests/run.mjs [name …]` for some suites only).
//
// 1. The translation check (lang/check-translations.mjs).
// 2. Page tests (tests/page/*.js): run inside the real app in Chromium. Each file is the body of an async
//    function that returns { fail: [...], log: [...] }.
// 3. End-to-end tests (tests/e2e/*.mjs): each gets its own fresh server (empty data folder, free port) and a browser.
//    A module exports `default async ({ browser, base, phoneShim }) => ({ fail, log })`; `skip` instead of
//    `fail` marks a test that could not run here (e.g. no internet for Open Food Facts).
//
// Needs Node 22 and the dev dependency puppeteer (`npm install`). Without Node on the machine, see tests/README.md.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2);
const wanted = (name) => !only.length || only.some((part) => name.includes(part));
const results = [];

function report(name, outcome) {
  const failed = outcome.fail?.length ? outcome.fail : [];
  const status = failed.length ? 'FAIL' : outcome.skip ? 'SKIP' : 'PASS';
  results.push({ name, status });
  console.log(`${status.padEnd(4)}  ${name}${outcome.skip ? ` (${outcome.skip})` : ''}`);
  for (const line of failed) console.log(`        ✗ ${line}`);
  if (process.env.VERBOSE) for (const line of outcome.log || []) console.log(`          ${line}`);
}

const freePort = () => new Promise((resolve) => {
  const probe = createServer().listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

// A Goodstock server on a free port with an empty data folder; stopped and cleaned up afterwards.
async function withServer(run) {
  const port = await freePort();
  const data = await mkdtemp(join(tmpdir(), 'goodstock-test-'));
  const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 15_000);
      server.stdout.on('data', (chunk) => { if (/listening/i.test(chunk)) { clearTimeout(timer); resolve(); } });
      server.on('exit', (code) => reject(new Error(`server exited (${code})`)));
    });
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.kill();
    await rm(data, { recursive: true, force: true });
  }
}

const phoneShim = (await readFile(join(root, 'tests/helpers/phone-shim.js'), 'utf8'));

async function main() {
  if (wanted('translations')) {
    const check = spawnSync(process.execPath, ['lang/check-translations.mjs'], { cwd: root, encoding: 'utf8' });
    report('translations', { fail: check.status === 0 ? [] : check.stdout.split('\n').filter((line) => /missing|fix:/.test(line)).slice(0, 10), log: check.stdout.trim().split('\n') });
  }
  if (wanted('version')) {
    const check = spawnSync(process.execPath, ['tools/bump-version.mjs', '--check'], { cwd: root, encoding: 'utf8' });
    report('version', { fail: check.status === 0 ? [] : [(check.stdout + check.stderr).trim()], log: [check.stdout.trim()] });
  }
  if (wanted('chrome81')) {
    // The kitchen tablet's Chrome 81: a static check of every browser file (tools/check-chrome81.mjs), and that the
    // check itself still notices a planted ??= and .replaceAll().
    const check = spawnSync(process.execPath, ['tools/check-chrome81.mjs'], { cwd: root, encoding: 'utf8' });
    const { checkScript } = await import('../tools/check-chrome81.mjs');
    const planted = checkScript('let a; a ??= "x".replaceAll("x", "y");');
    const fail = check.status === 0 ? [] : check.stdout.trim().split('\n').slice(0, 10);
    if (planted.length !== 2) fail.push(`the check missed a planted problem: ${JSON.stringify(planted)}`);
    report('chrome81-static', { fail, log: [check.stdout.trim()] });
  }
  if (wanted('legacy')) {
    // The copy for old tablets (tools/build-legacy.mjs): it builds, every script is plain ES5, and the page runs
    // (all pages, a dialog and cook mode) without a script error. Chromium here is new, so this catches mistakes in
    // the build itself (like scripts overwriting each other's helpers); old engines need the emulator
    // (android/test-apk.sh … 19).
    const fail = [];
    const log = [];
    const build = spawnSync(process.execPath, ['tools/build-legacy.mjs'], { cwd: root, encoding: 'utf8' });
    if (build.status !== 0) fail.push(`build failed: ${(build.stderr || build.stdout).trim().split('\n').slice(0, 5).join(' / ')}`);
    else {
      const { parse } = await import('acorn');
      const files = (await readdir(join(root, 'legacy'), { recursive: true })).filter((file) => file.endsWith('.js') && file !== 'polyfills.js');
      for (const file of files) {
        try { parse(await readFile(join(root, 'legacy', file), 'utf8'), { ecmaVersion: 5 }); } catch (error) { fail.push(`legacy/${file} is not ES5: ${error.message}`); }
      }
      log.push(`${files.length} scripts are ES5`);
      const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        page.on('pageerror', (error) => fail.push(`page error: ${error.message}`));
        page.on('console', (message) => { if (message.type() === 'error' && /Goodstock:|Unhandled/.test(message.text())) fail.push(`console: ${message.text()}`); });
        await page.setRequestInterception(true);
        page.on('request', async (request) => {
          const path = decodeURIComponent(new URL(request.url()).pathname).replace(/^\/+/, '');
          if (!request.url().startsWith('http://legacy.test/') || path.startsWith('api/')) return request.respond({ status: 404, body: '{}' });
          try {
            const body = await readFile(join(root, path));
            const type = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', woff2: 'font/woff2' }[path.split('.').pop()] || 'application/octet-stream';
            request.respond({ status: 200, contentType: type, body });
          } catch { request.respond({ status: 404, body: '' }); }
        });
        await page.goto('http://legacy.test/legacy/index.html');
        await page.waitForSelector('#view-container .page-heading', { timeout: 15000 });
        for (const view of ['inventory', 'week', 'shopping', 'recipes', 'tools']) {
          await page.click(`.nav-item[data-view="${view}"]`);
          const heading = await page.evaluate(() => (document.querySelector('#view-container .page-heading h1') || {}).textContent || '');
          if (!heading) fail.push(`${view}: page did not render`);
        }
        const cook = await page.evaluate(async () => {
          openRecipePage(state.recipes[0].id);
          startCookSteps(state.recipes[0], '');
          await new Promise((resolve) => setTimeout(resolve, 300));
          moveCookStep(1);
          return document.querySelector('#steps-dialog').open;
        });
        if (!cook) fail.push('cook mode did not open');
        log.push(`classes: ${await page.evaluate(() => document.documentElement.className)}`);
      } finally {
        await browser.close();
      }
    }
    report('legacy-build', { fail, log });
  }
  if (wanted('client-files')) {
    // Every client script is loaded by index.html, served by the server and kept in the offline cache.
    const scripts = (await readdir(join(root, 'app'))).filter((file) => file.endsWith('.js')).map((file) => `app/${file}`);
    const [html, server, sw] = await Promise.all(['index.html', 'server.mjs', 'sw.js'].map((file) => readFile(join(root, file), 'utf8')));
    const fail = [];
    for (const script of scripts) {
      if (!html.includes(`<script src="${script}" defer></script>`)) fail.push(`${script} is not loaded in index.html`);
      if (!server.includes(`['/${script}', ['${script}',`)) fail.push(`${script} is not in the server's static file list`);
      if (!sw.includes(`'/${script}'`)) fail.push(`${script} is not in APP_SHELL in sw.js`);
    }
    report('client-files', { fail, log: scripts });
  }
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'] });
  try {
    const pageTests = (await readdir(join(root, 'tests/page'))).filter((file) => file.endsWith('.js') && wanted(file)).sort();
    if (pageTests.length) {
      await withServer(async (base) => {
        for (const file of pageTests) {
          const page = await browser.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
          page.on('dialog', (dialog) => dialog.accept());
          try {
            await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
            await page.waitForSelector('#view-container .page-heading');
            const body = await readFile(join(root, 'tests/page', file), 'utf8');
            const outcome = await page.evaluate(`(async () => { ${body} })()`);
            report(`page/${file}`, { ...outcome, fail: [...errors, ...(outcome.fail || [])] });
          } catch (error) {
            report(`page/${file}`, { fail: [...errors, String(error.message || error)] });
          } finally {
            await page.close();
          }
        }
      });
    }
    const e2eTests = (await readdir(join(root, 'tests/e2e'))).filter((file) => file.endsWith('.mjs') && wanted(file)).sort();
    for (const file of e2eTests) {
      const { default: run } = await import(`./e2e/${file}`);
      try {
        report(`e2e/${file}`, await withServer((base) => run({ browser, base, phoneShim })));
      } catch (error) {
        report(`e2e/${file}`, { fail: [String(error.stack || error)] });
      }
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter((result) => result.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `, ${failed.length} failed` : ''}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
