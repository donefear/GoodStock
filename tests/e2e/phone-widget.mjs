// Android home-screen widget (0.31): the page sends the use-soon list and the shopping list's size in the app's
// language whenever the kitchen changes, and a widget tap opens the app on that page.
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  // A tap on the widget's shopping line started the app.
  await page.evaluateOnNewDocument(`${phoneShim}; window.__openView = 'shopping';`);
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const start = await page.evaluate(() => ({ view: activeView, widget: window.__widget }));
  log.push(`opened on ${start.view}`);
  if (start.view !== 'shopping') fail.push(`a widget tap should open the shopping list, got ${start.view}`);

  const sent = await page.evaluate(async () => {
    const inDays = (n) => { const day = new Date(); day.setDate(day.getDate() + n); return dateKey(day); };
    state.inventory = ['Milk', 'Spinach', 'Yoghurt', 'Cream', 'Ham', 'Cheese'].map((name, index) => ({ id: `w${index}`, name, quantity: 1, unit: '', location: 'Fridge', kind: 'Food', expiresOn: inDays(index % 3) }));
    state.shopping = [{ id: 's1', name: 'Bread', quantity: 1, unit: '', checked: false }, { id: 's2', name: 'Eggs', quantity: 6, unit: '', checked: false }, { id: 's3', name: 'Rice', quantity: 1, unit: '', checked: true }];
    persist();
    const english = window.__widget;
    const updates = window.__widgetUpdates;
    persist();
    const unchanged = window.__widgetUpdates === updates;
    await setLanguage('nl');
    persist();
    const dutch = window.__widget;
    await setLanguage('en');
    return { english, dutch, unchanged };
  });
  log.push(JSON.stringify(sent.english), JSON.stringify(sent.dutch));
  if (!sent.english || sent.english.soonTitle !== 'Use soon') fail.push('widget title missing');
  if (!sent.english || sent.english.soon.split('\n').length !== 5 || !/\+ 2 more/.test(sent.english.soon)) fail.push('widget should list four items and "+ 2 more"');
  if (!sent.english || !/·/.test(sent.english.soon.split('\n')[0])) fail.push('widget lines should carry a date');
  if (!sent.english || sent.english.shopping !== '2 things on the shopping list') fail.push(`shopping line: ${sent.english && sent.english.shopping}`);
  if (!sent.unchanged) fail.push('the widget was sent again although nothing changed');
  if (!sent.dutch || sent.dutch.shopping === sent.english.shopping) fail.push('the widget text did not follow the app language');

  // While the app is open: a widget tap comes in through onResume.
  const resumed = await page.evaluate(() => { activeView = 'week'; render(); window.__openView = 'inventory'; window.goodstockResume(); return activeView; });
  if (resumed !== 'inventory') fail.push(`a widget tap while open should switch to the inventory, got ${resumed}`);
  await page.close();
  return { fail, log };
}
