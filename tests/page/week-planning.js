// Faster week planning (0.15): Repeat last week, Copy this day to…, and recipes using Use soon items first.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
state.recipes = [
  { id: 'w1', name: 'Soup', ingredients: ['1 onion'] },
  { id: 'w2', name: 'Pancakes', ingredients: ['2 eggs'] },
  { id: 'w3', name: 'Potato tray', ingredients: ['1 kg potatoes'] },
];
const [soup, pancakes, potatoes] = state.recipes;
selectedDate = new Date();
weekStart = startOfWeek(selectedDate);
const day = (offset) => dateKey(dateAtOffset(offset));
state.plan = [
  { id: 'p1', date: day(-7), recipeId: soup.id, cooked: true },
  { id: 'p2', date: day(-5), recipeId: pancakes.id, cooked: true, scale: 2 },
  { id: 'p3', date: day(-5), recipeId: 'deleted-recipe', cooked: true },
  { id: 'p4', date: day(0), recipeId: soup.id, cooked: false },
];
state.inventory = [];
activeView = 'week';
render();

// Repeat last week: only the pancakes (the soup is already on Monday, the deleted recipe is skipped).
const repeat = document.querySelector('[data-action="repeat-last-week"]');
if (!repeat) fail.push('no Repeat last week button');
repeat?.click();
await wait();
const added = state.plan.filter((entry) => !['p1', 'p2', 'p3', 'p4'].includes(entry.id));
log.push(`repeated: ${JSON.stringify(added.map(({ date, recipeId, scale, cooked }) => ({ date, recipeId, scale, cooked })))}`);
if (added.length !== 1 || added[0].recipeId !== pancakes.id || added[0].date !== day(2) || added[0].scale !== 2 || added[0].cooked) fail.push('last week not repeated as expected');
if (document.querySelector('[data-action="repeat-last-week"]')) fail.push('Repeat last week still offered with nothing left to copy');
document.querySelector('#undo-bar [data-action="undo"]').click();
if (state.plan.length !== 4) fail.push('Undo did not take the repeated meals back');

// Copy this day to another day; a second copy doesn't double it.
selectedDate = dateAtOffset(0);
render();
document.querySelector('[data-action="copy-day"]').click();
await wait();
const targets = document.querySelectorAll('[data-action="copy-day-to"]');
if (targets.length !== 13) fail.push(`expected 13 target days, got ${targets.length}`);
document.querySelector(`[data-action="copy-day-to"][data-date="${day(9)}"]`).click();
await wait();
const copied = () => state.plan.filter((entry) => entry.date === day(9) && entry.recipeId === soup.id).length;
if (copied() !== 1) fail.push('day not copied to next week');
if (document.querySelector('.copy-day-targets')) fail.push('day picker stayed open');
document.querySelector('[data-action="copy-day"]').click();
document.querySelector(`[data-action="copy-day-to"][data-date="${day(9)}"]`).click();
await wait();
if (copied() !== 1) fail.push('copying again doubled the meal');

// Plan these first: a recipe using something from Use soon leads the picker.
const soonDate = new Date();
soonDate.setDate(soonDate.getDate() + 1);
const ingredient = parseIngredient(potatoes.ingredients[0]).name;
state.inventory = [{ id: 'x1', name: ingredient, quantity: 5, unit: '', location: state.locations[0], kind: 'Food', expiresOn: dateKey(soonDate), expirationSource: 'manual' }];
render();
const first = document.querySelector('.picker-item');
log.push(`first pick: ${first?.querySelector('strong').textContent} · ${first?.querySelector('.use-soon-tag')?.textContent}`);
if (first?.querySelector('strong').textContent !== potatoes.name || !first.querySelector('.use-soon-tag')) fail.push('recipe using a Use soon item is not first');
state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
