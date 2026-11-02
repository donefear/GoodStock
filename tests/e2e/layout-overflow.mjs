// Phone-sized layouts (4.8): no page wider than the screen, and dialog buttons inside it, on a 360px phone at Large
// text and on the 800px kitchen tablet at Large text (about 615 CSS pixels wide, so html.compact-layout is on).
// Also in German, whose long words broke the tabs, stats and dialog buttons.
const VIEWS = ['inventory', 'week', 'shopping', 'recipes', 'tools'];

async function seed(page) {
  await page.evaluate(() => {
    const day = (offset) => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); };
    const [pantry, fridge] = state.locations;
    const item = (name, quantity, unit, location, extra = {}) => ({ id: makeId(), name, quantity, unit, location, kind: 'Food', addedOn: day(-3), ...extra });
    state.inventory = [
      item('Extra mature farmhouse cheddar cheese with caramelised onion', 400, 'g', fridge, { expiresOn: day(1), expirationSource: 'package' }),
      item('Whole milk', 1, 'l', fridge, { expiresOn: day(0), expirationSource: 'package' }),
      item('Spaghetti', 500, 'g', pantry, { minimum: 1 }),
    ];
    state.recipes.push({ id: 'my-layout-test', name: 'Slow-roasted Mediterranean vegetable and chickpea traybake with feta and herbs', description: 'A long title.', ingredients: ['400 g chickpeas', '200 g feta', '2 red peppers'], instructions: ['Heat the oven to 200°C.', 'Roast for 35 minutes.'], source: 'My recipes' });
    state.plan = [{ id: makeId(), date: day(0), recipeId: 'my-layout-test', cooked: false }];
    state.shopping = [{ id: makeId(), name: 'Butter', quantity: 250, unit: 'g', checked: true }, { id: makeId(), name: 'Lemons', quantity: 3, unit: 'pcs', checked: false }];
    persist();
    render();
  });
}

export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  for (const [lang, viewport] of [['en', { width: 360, height: 740, isMobile: true, hasTouch: true }], ['de', { width: 360, height: 740, isMobile: true, hasTouch: true }], ['en', { width: 800, height: 1280, hasTouch: true }], ['de', { width: 800, height: 1280, hasTouch: true }]]) {
    const tag = `${lang} ${viewport.width}px large`;
    const page = await browser.newPage();
    await page.setViewport(viewport);
    page.on('pageerror', (error) => fail.push(`${tag}: ${error.message}`));
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.evaluate((code) => { localStorage.setItem('goodstock-language-v1', code); localStorage.setItem('goodstock-text-size-v2', 'large'); }, lang);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('#view-container .page-heading');
    await seed(page);
    // The app sets html.compact-layout when the zoomed page is 720 CSS pixels or narrower; set it here too, so this
    // checks the styles even where the app's own check did not run.
    const compact = await page.evaluate(() => {
      const zoom = parseFloat(document.documentElement.style.zoom) || 1;
      const byApp = document.documentElement.classList.contains('compact-layout');
      if (innerWidth / zoom <= 720) document.documentElement.classList.add('compact-layout');
      return { byApp, width: Math.round(innerWidth / zoom) };
    });
    log.push(`${tag}: ${compact.width} CSS px, compact-layout set by the app: ${compact.byApp}`);
    for (const view of VIEWS) {
      await page.evaluate((name) => document.querySelector(`.nav-item[data-view="${name}"]`).click(), view);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const wide = await page.evaluate(() => {
        const root = document.documentElement;
        const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
        return { overflow: root.scrollWidth - root.clientWidth, sidebarAtBottom: sidebar.top > root.clientHeight / 2 };
      });
      if (wide.overflow > 1) fail.push(`${tag} ${view}: the page is ${wide.overflow}px wider than the screen`);
      if (!wide.sidebarAtBottom) fail.push(`${tag} ${view}: the menu is not the bottom bar`);
    }
    // Dialogs: the item dialog (with Remove item), cook, and every Settings tab keep their buttons on the screen.
    const dialogs = [
      ['item', async () => { await page.evaluate(() => document.querySelector('.nav-item[data-view="inventory"]').click()); await page.evaluate(() => document.querySelector('[data-action="edit-item"]').click()); }],
      ['cook', async () => { await page.evaluate(() => document.querySelector('.nav-item[data-view="week"]').click()); await page.evaluate(() => document.querySelector('[data-action="cook"]').click()); }],
      ...['general', 'connections', 'data'].map((tab) => [`settings ${tab}`, async () => { await page.evaluate(() => document.querySelector('#settings-button').click()); await page.evaluate((name) => document.querySelector(`[data-action="settings-tab"][data-tab="${name}"]`).click(), tab); }]),
    ];
    for (const [name, open] of dialogs) {
      await open();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const outside = await page.evaluate(() => {
        const dialog = document.querySelector('dialog[open]');
        if (!dialog) return ['no dialog opened'];
        const box = dialog.getBoundingClientRect();
        const width = document.documentElement.clientWidth;
        if (box.left < -1 || box.right > width + 1) return [`the dialog itself (${Math.round(box.left)}–${Math.round(box.right)} of ${width})`];
        return [...dialog.querySelectorAll('button, .button, input, select, textarea')].filter((element) => {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height || element.closest('[hidden]')) return false;
          return rect.left < box.left - 1 || rect.right > box.right + 1;
        }).map((element) => `"${(element.textContent || element.name || element.id).trim().slice(0, 30)}"`);
      });
      if (outside.length) fail.push(`${tag} ${name} dialog: outside the dialog: ${outside.slice(0, 4).join(', ')}`);
      await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close()));
    }
    await page.close();
  }
  return { fail, log };
}
