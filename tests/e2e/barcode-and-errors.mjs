// Barcode lookup through the server and through a phone app (4.2), and server errors in the app's language (3.3).
// The barcode part needs internet (Open Food Facts); without it that part is skipped.
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let skip = '';
  const online = await fetch('https://world.openfoodfacts.org/api/v2/product/3017620422003?fields=product_name', { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false);
  if (!online) skip = 'no internet for Open Food Facts';
  for (const mode of online ? ['server', 'phone'] : []) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', (error) => fail.push(`${mode}: ${error.message}`));
    if (mode === 'phone') await page.evaluateOnNewDocument(phoneShim);
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => document.querySelector('[data-action="add-item"]').click());
    if (mode === 'phone') await page.evaluate(() => document.querySelector('#scan-barcode-button').click());
    else await page.evaluate(() => { const input = document.querySelector('#item-form').elements.name; input.value = '3017620422003'; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => /nutella/i.test(document.querySelector('#item-form').elements.name.value), { timeout: 15000 }).catch(() => fail.push(`${mode}: product not filled in`));
    log.push(`${mode}: ${await page.evaluate(() => { const form = document.querySelector('#item-form'); return `${form.elements.name.value}, ${form.elements.quantity.value} ${form.elements.unit.value}`; })}`);
    await context.close();
  }
  // Server errors with a value in them arrive in the app's language.
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.evaluate(() => setLanguage('de'));
  await page.evaluate(() => document.querySelector('#settings-button').click());
  await wait(300);
  const note = await page.evaluate(async () => {
    const form = document.querySelector('#settings-form');
    form.elements.mealieUrl.value = 'http://127.0.0.1:9';
    form.elements.mealieKey.value = 'test-key';
    await saveMealieSettings();
    return document.querySelector('#mealie-note').textContent;
  });
  log.push(`Mealie error in German: ${note}`);
  if (!/^Mealie unter http:\/\/127\.0\.0\.1:9 ist nicht erreichbar\.$/.test(note)) fail.push(`server error not translated: "${note}"`);
  return { fail, log, skip };
}
