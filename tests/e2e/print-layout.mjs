// Printing (0.14), with print media emulated: menus and buttons are gone, checked shopping items are left out,
// and the recipe page keeps its ingredients and numbered steps. Also in dark mode, which prints light.
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    localStorage.setItem(THEME_KEY, 'dark');
    applyTheme('dark');
    state.shopping = [{ id: 'a', name: 'Carrots', quantity: 1, unit: 'kg', checked: false }, { id: 'b', name: 'Milk', quantity: 1, unit: 'l', checked: true }];
    activeView = 'shopping';
    render();
  });
  await page.emulateMediaType('print');
  const shopping = await page.evaluate(() => {
    const shown = (selector) => [...document.querySelectorAll(selector)].filter((element) => element.getClientRects().length > 0).length;
    return {
      sidebar: shown('.sidebar'), topbar: shown('.topbar'), buttons: shown('#view-container button'),
      rows: [...document.querySelectorAll('.shopping-row')].filter((row) => row.getClientRects().length > 0).map((row) => row.textContent.trim()),
      headings: shown('.shopping-group'), footer: shown('.print-footer'),
      background: getComputedStyle(document.body).backgroundColor,
    };
  });
  log.push(`shopping: ${JSON.stringify(shopping)}`);
  if (shopping.sidebar || shopping.topbar) fail.push('menus are printed');
  if (shopping.buttons) fail.push(`${shopping.buttons} buttons are printed on the shopping list`);
  if (shopping.rows.length !== 1 || !/Carrots/.test(shopping.rows[0])) fail.push('checked items are printed, or unchecked ones missing');
  if (shopping.headings !== 1) fail.push('a heading of a group with nothing left is printed');
  if (!shopping.footer) fail.push('no footer on the printed list');
  if (shopping.background !== 'rgb(255, 255, 255)') fail.push(`dark mode prints a ${shopping.background} background`);

  await page.emulateMediaType('screen');
  await page.evaluate(() => openRecipePage(state.recipes[0].id));
  await page.emulateMediaType('print');
  const recipe = await page.evaluate(() => {
    const shown = (selector) => [...document.querySelectorAll(selector)].filter((element) => element.getClientRects().length > 0).length;
    return { buttons: shown('#view-container button'), links: shown('.recipe-page-links'), ingredients: shown('.recipe-page-ingredients li'), steps: shown('.recipe-method-step') };
  });
  log.push(`recipe: ${JSON.stringify(recipe)}`);
  if (recipe.links || recipe.buttons) fail.push('recipe links or buttons are printed');
  if (!recipe.ingredients || !recipe.steps) fail.push('ingredients or steps missing from the printed recipe');
  await page.evaluate(() => { localStorage.removeItem(THEME_KEY); state.shopping = []; persist(); });
  await page.close();

  // The phone apps (0.32) print through their bridge: Android's print service, iOS's print sheet.
  const phone = await browser.newPage();
  phone.on('pageerror', (error) => fail.push(error.message));
  await phone.evaluateOnNewDocument(phoneShim);
  await phone.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  const printed = await phone.evaluate(async () => {
    state.shopping = [{ id: 'a', name: 'Carrots', quantity: 1, unit: 'kg', checked: false }];
    activeView = 'shopping';
    render();
    const button = document.querySelector('[data-action="print"]');
    if (button) button.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { button: Boolean(button), calls: window.__calls.filter((call) => call[0] === 'print').length };
  });
  if (!printed.button) fail.push('no Print button in the phone app');
  if (printed.calls !== 1) fail.push('Print did not go through the phone bridge');
  await phone.close();
  return { fail, log };
}
