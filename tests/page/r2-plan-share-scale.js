// r2: "Plan this week" from a recipe plans this week even after › on the Week page; the QR download gets what is
// still to buy, in this device's units; scaled grams are rounded the way a cook weighs them.
const fail = []; const log = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
const kitchenBefore = JSON.stringify(state);
const thisWeek = startOfWeek(new Date());
const sunday = new Date(thisWeek); sunday.setDate(sunday.getDate() + 6);

// 5. Week page, › to next week, then Recipes → Plan this week.
state.recipes = [{ id: 'r-plan', name: 'Plan soup', ingredients: ['1 onion'], instructions: ['Cook.'] }];
state.plan = [];
activeView = 'week';
render();
document.querySelector('[data-action="next-week"]').click();
await wait();
activeView = 'recipes';
render();
const button = document.querySelector('[data-action="plan-recipe"][data-id="r-plan"]');
if (!button) fail.push('no Plan this week button');
else {
  button.click();
  await wait();
  const planned = state.plan.find((entry) => entry.recipeId === 'r-plan');
  log.push(`planned on ${planned && planned.date} (this week ${dateKey(thisWeek)}–${dateKey(sunday)})`);
  if (!planned || planned.date < dateKey(thisWeek) || planned.date > dateKey(sunday)) fail.push(`Plan this week landed outside this week: ${planned && planned.date}`);
}
// The Week page's own Add still plans the day shown there (next week).
state.plan = [];
activeView = 'week';
render();
document.querySelector('[data-action="next-week"]').click();
await wait();
const shown = dateKey(selectedDate);
const add = document.querySelector('.recipe-picker [data-action="plan-recipe"]');
if (add) {
  add.click();
  await wait();
  if (!state.plan.some((entry) => entry.date === shown)) fail.push(`Add on the Week page did not plan the shown day ${shown}`);
}
document.querySelector('[data-action="go-today"]') && document.querySelector('[data-action="go-today"]').click();

// 6. QR download payload: unticked only, amounts as shown (imperial device: lb).
localStorage.setItem(UNITS_KEY, 'imperial');
state.shopping = [
  { id: 'a', name: 'Flour', quantity: 1, unit: 'kg', checked: false },
  { id: 'b', name: 'Beans', quantity: 2, unit: 'can', checked: false },
  { id: 'c', name: 'Onions', quantity: 3, unit: '', checked: true },
];
const items = shoppingShareItems();
log.push(`share items: ${JSON.stringify(items)}`);
if (items.some((item) => item.name === 'Onions')) fail.push('a ticked item is in the QR download');
const flour = items.find((item) => item.name === 'Flour');
if (!flour || !/lb/.test(flour.quantity) || /kg/.test(flour.quantity)) fail.push(`QR amounts not as shown on this device: ${flour && flour.quantity}`);
const response = await fetch('/api/shopping/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items, title: t('Shopping list') }) });
const share = await response.json();
const download = await (await fetch(share.url.replace(/^https?:\/\/[^/]+/, ''))).text();
log.push(download.replace(/\n/g, ' / '));
if (!/Flour \(2\.2\d* lb\)/.test(download)) fail.push('the download does not show the imperial amount');
if (/Onions/.test(download)) fail.push('the download lists the ticked item');
localStorage.removeItem(UNITS_KEY);

// 7. Scaled grams.
const cases = [['375 g flour', 1.5, '565 g flour'], ['650 g potatoes', 1.75, '1140 g potatoes'], ['5 g yeast', 1.5, '7.5 g yeast'], ['15 ml oil', 1.5, '23 ml oil'], ['1.5 kg beef', 1.5, '2.25 kg beef'], ['2 eggs', 1.5, '3 eggs']];
for (const [line, factor, want] of cases) {
  const got = scaleIngredientLine(line, factor);
  log.push(`${line} ×${factor} → ${got}`);
  if (got !== want) fail.push(`${line} ×${factor}: expected "${want}", got "${got}"`);
}
const recipe = { id: 'r-keep', name: 'Keep', ingredients: ['375 g flour'], instructions: [] };
scaledRecipe(recipe, 1.5);
if (recipe.ingredients[0] !== '375 g flour') fail.push('scaling changed the stored recipe');

state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
