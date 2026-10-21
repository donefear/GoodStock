// Share into Goodstock (0.52): the Android app takes text from the share menu (takeSharedText). A link (with a
// title) opens Import with it; other text asks: shopping list (each line an item, amounts read) or recipe.
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.evaluateOnNewDocument(phoneShim);
  await page.evaluateOnNewDocument(() => {
    window.__shared = 'Pancakes for Sunday\nhttps://example.com/pancakes';
    window.GoodstockNative.takeSharedText = () => { const text = window.__shared || ''; window.__shared = ''; return text; };
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(300);

  // A link with its title: Import with the address filled in.
  const link = await page.evaluate(() => ({ open: document.querySelector('#recipe-edit-dialog').open, url: document.querySelector('#recipe-edit-form').elements.importUrl.value }));
  log.push(`link: ${JSON.stringify(link)}`);
  if (!link.open || link.url !== 'https://example.com/pancakes') fail.push('a shared link did not open Import with the address');

  // A list: the shopping list.
  await page.evaluate(() => {
    document.querySelector('#recipe-edit-dialog').close();
    window.__shared = '- 2 kg potatoes\n• milk\n[ ] Bread';
    window.goodstockResume();
  });
  await wait(100);
  const asked = await page.evaluate(() => document.querySelector('#shared-in-dialog').open);
  if (!asked) fail.push('shared text did not ask what it is');
  await page.click('[data-action="share-to-shopping"]');
  await wait(100);
  const shopping = await page.evaluate(() => state.shopping.filter((item) => item.source === t('Shared')).map((item) => `${item.quantity} ${item.unit} ${item.name}`.trim()));
  log.push(`shopping: ${JSON.stringify(shopping)}`);
  if (shopping.join('|') !== '2 kg Potatoes|Milk|Bread') fail.push(`shared lines became ${JSON.stringify(shopping)}`);

  // A recipe: the editor, filled in from the text.
  await page.evaluate(() => {
    window.__shared = 'Tomato soup\n\nIngredients\n1 onion\n1 can tomatoes\n\nInstructions\nChop the onion. Simmer with the tomatoes for 15 minutes.';
    window.goodstockResume();
  });
  await wait(100);
  await page.click('[data-action="share-to-recipe"]');
  await wait(200);
  const recipe = await page.evaluate(() => ({ name: document.querySelector('#recipe-edit-form [name="name"]').value, ingredients: document.querySelector('#recipe-edit-form [name="ingredients"]').value.trim().split('\n').length }));
  log.push(`recipe: ${JSON.stringify(recipe)}`);
  if (recipe.name !== 'Tomato soup' || recipe.ingredients !== 2) fail.push(`shared recipe text gave ${JSON.stringify(recipe)}`);
  await page.close();
  return { fail, log };
}
