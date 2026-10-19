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
        new Function(setupCode)();
        new Function(`(${openCode})()`)();
        await new Promise((resolve) => setTimeout(resolve, 350)); // past the colour transitions
        const scope = document.querySelector('dialog[open]') || document.body;
        const result = await window.axe.run(scope, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
        return result.violations.map((violation) => ({ id: violation.id, count: violation.nodes.length, target: String(violation.nodes[0].target[0]), summary: (violation.nodes[0].failureSummary || '').split('\n').slice(1, 2).join(' ').trim() }));
      }, setup, open.toString());
      for (const violation of violations) fail.push(`${mode} · ${name}: ${violation.id} ×${violation.count} (${violation.target}) ${violation.summary}`);
    }
  }
  log.push(`${VIEWS.length} views × 3 modes checked`);
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close()); applyTheme('light'); applyTextSize('normal'); });
  await page.close();
  return { fail, log };
}
