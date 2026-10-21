// Accessibility (0.40): axe-core on every page and the main dialogs, in light, dark and the largest text size, at
// tablet width. Any WCAG 2 A/AA violation fails, with the rule, the first element and how many there are.
import { createRequire } from 'node:module';

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const VIEWS = [
  ['inventory', () => { activeView = 'inventory'; render(); }],
  ['week', () => { activeView = 'week'; render(); }],
  ['shopping', () => { activeView = 'shopping'; render(); }],
  ['recipes', () => { activeView = 'recipes'; render(); }],
  ['recipe page', () => { openRecipePage(state.recipes[0].id); }],
  ['tools: timers', () => { activeView = 'tools'; toolsTab = 'timers'; render(); }],
  ['tools: converter', () => { activeView = 'tools'; toolsTab = 'converter'; render(); }],
  ['tools: terms', () => { activeView = 'tools'; toolsTab = 'terms'; render(); }],
  ['item dialog', () => { openItemDialog(); }],
  ['recipe editor', () => { openRecipeEditor(); }],
  ['settings: general', () => { document.querySelector('#settings-button').click(); showSettingsTab('general'); }],
  ['settings: connections', () => { document.querySelector('#settings-button').click(); showSettingsTab('connections'); }],
  ['settings: your data', () => { document.querySelector('#settings-button').click(); showSettingsTab('data'); }],
  // 0.54: cook mode, the scan and put-away dialogs, the cooked dialog and a running timer.
  ['cook mode: get ready', () => { startCookSteps(state.recipes[0], ''); }],
  ['cook mode: a step', () => { startCookSteps(state.recipes[0], ''); moveCookStep(1); moveCookStep(1); }],
  ['cooked dialog', () => {
    state.plan.push({ id: 'a11y-cook', date: dateKey(new Date()), recipeId: state.recipes[0].id, cooked: false });
    openCookDialog(state.plan.find((entry) => entry.id === 'a11y-cook'));
  }],
  ['put away', () => {
    state.shopping.push({ id: 'a11y-shop', name: 'Milk', quantity: 1, unit: 'l', checked: true });
    openPutawayDialog(state.shopping.find((entry) => entry.id === 'a11y-shop'));
  }],
  ['scan: in stock', () => { showScanResult({ code: '123', item: state.inventory[0] }); }],
  ['scan: unknown', () => { showScanResult({ code: '456', product: null }); }],
  ['running timer', () => {
    cookTimers.push({ id: 'a11y-timer', label: 'Pasta', name: 'Pasta', endsAt: Date.now() + 300000, done: false });
    activeView = 'tools'; toolsTab = 'timers'; render();
  }],
  ['kitchen screen', () => {
    state.plan.push({ id: 'a11y-meal', date: dateKey(new Date()), recipeId: state.recipes[0].id, cooked: false });
    cookTimers.push({ id: 'a11y-timer', label: 'Pasta', name: 'Pasta', endsAt: Date.now() + 300000, done: false });
    openKitchenScreen();
  }],
];

export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  await page.addScriptTag({ path: axePath });
  for (const [mode, setup] of [['light', "applyTheme('light'); applyTextSize('normal');"], ['dark', "applyTheme('dark'); applyTextSize('normal');"], ['large text', "applyTheme('light'); applyTextSize('xlarge');"]]) {
    for (const [name, open] of VIEWS) {
      const violations = await page.evaluate(async (setupCode, openCode) => {
        document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
        if (!document.querySelector('#kitchen-screen').hidden) closeKitchenScreen();
        cookTimers = cookTimers.filter((timer) => timer.id !== 'a11y-timer');
        state.plan = state.plan.filter((entry) => !['a11y-meal', 'a11y-cook'].includes(entry.id));
        state.shopping = state.shopping.filter((entry) => entry.id !== 'a11y-shop');
        new Function(setupCode)();
        new Function(`(${openCode})()`)();
        await new Promise((resolve) => setTimeout(resolve, 350)); // past the colour transitions
        const kitchen = document.querySelector('#kitchen-screen');
        const scope = document.querySelector('dialog[open]') || (kitchen && !kitchen.hidden ? kitchen : document.body);
        const result = await window.axe.run(scope, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
        return result.violations.map((violation) => ({ id: violation.id, count: violation.nodes.length, target: String(violation.nodes[0].target[0]), summary: (violation.nodes[0].failureSummary || '').split('\n').slice(1, 2).join(' ').trim() }));
      }, setup, open.toString());
      for (const violation of violations) fail.push(`${mode} · ${name}: ${violation.id} ×${violation.count} (${violation.target}) ${violation.summary}`);
    }
  }
  log.push(`${VIEWS.length} views × 3 modes checked`);
  // Cook mode is used with wet hands, often from a step away: everything to tap there is at least 44 × 44 pixels
  // (WCAG 2.5.5), on a tablet and on a phone.
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    await page.setViewport({ width, height });
    const small = await page.evaluate(async () => {
      document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
      startCookSteps(state.recipes[0], '');
      const found = [];
      for (let step = 0; step < 4; step++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        for (const element of document.querySelectorAll('#steps-dialog button, #steps-dialog input, #steps-dialog [role="button"], #steps-dialog label.cook-check')) {
          const box = element.getBoundingClientRect();
          if (!box.width || !box.height || getComputedStyle(element).visibility === 'hidden') continue;
          if (box.width < 44 || box.height < 44) found.push(`${element.dataset.action || element.className || element.tagName} ${Math.round(box.width)}×${Math.round(box.height)}`);
        }
        moveCookStep(1);
      }
      document.querySelector('#steps-dialog').close();
      return [...new Set(found)];
    });
    for (const target of small) fail.push(`cook mode at ${width}px: ${target} is smaller than 44 × 44`);
  }
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close()); closeKitchenScreen(); applyTheme('light'); applyTextSize('normal'); });
  await page.close();
  return { fail, log };
}
