// The shared shopping list text (phone apps) and the QR download (server) use the same supermarket groups as the
// list on screen, with the headings in the app's language (0.12).
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
state.shopping = [
  { id: 'a', name: 'Milk', quantity: 1, unit: 'l', checked: false },
  { id: 'b', name: 'Carrots', quantity: 500, unit: 'g', checked: false },
  { id: 'c', name: 'Batteries', quantity: 4, unit: '', checked: false },
  { id: 'd', name: 'Onions', quantity: 3, unit: '', checked: true },
];
const text = shoppingListText(state.shopping.filter((item) => !item.checked));
log.push(text.replace(/\n/g, ' / '));
const order = ['VEGETABLES', 'Carrots', 'DAIRY', 'Milk', 'OTHER', 'Batteries'].map((part) => text.indexOf(part));
if (order.some((index) => index < 0) || order.some((index, i) => i && index < order[i - 1])) fail.push(`share text not grouped in shop order: ${text}`);

await setLanguage('nl');
const dutch = shoppingListText(state.shopping);
if (!/GROENTEN/.test(dutch) || !/ZUIVEL/.test(dutch)) fail.push(`headings not in Dutch: ${dutch}`);

// One group only: no headings.
const single = shoppingListText([{ name: 'Milk', quantity: 1, unit: 'l' }]);
if (single.split('\n').length !== 2) fail.push(`a single group got a heading: ${single}`);

// The QR download, through the server.
const response = await fetch('/api/shopping/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: groupedShoppingItems(state.shopping), title: t('Shopping list') }) });
const share = await response.json();
const download = await (await fetch(share.url.replace(/^https?:\/\/[^/]+/, ''))).text();
log.push(download.replace(/\n/g, ' / '));
if (!/^Goodstock · Boodschappenlijst/.test(download)) fail.push('download title not in the app language');
const lines = download.split('\n');
const heading = lines.indexOf('GROENTEN');
if (heading < 0 || !/Carrots/.test(lines[heading + 1]) || !lines.includes('[x] Onions (3)')) fail.push('download not grouped');
await setLanguage('en');
state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
