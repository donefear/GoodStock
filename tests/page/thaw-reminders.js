// Thaw reminders (0.27): tomorrow's meal needs something that is only in the freezer.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const offset = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return date; };
state.recipes = [
  { id: 't1', name: 'Chicken curry', ingredients: ['500 g chicken', '1 onion', '200 ml coconut milk'] },
  { id: 't2', name: 'Pea soup', ingredients: ['400 g peas', '1 onion'] },
];
state.plan = [
  { id: 'tp1', date: dateKey(offset(1)), recipeId: 't1', cooked: false },
  { id: 'tp2', date: dateKey(offset(1)), recipeId: 't2', cooked: false },
  { id: 'tp3', date: dateKey(offset(3)), recipeId: 't1', cooked: false },
];
state.locations = ['Fridge', 'Freezer', 'Pantry'];
state.inventory = [
  { id: 'f1', name: 'Chicken', quantity: 500, unit: 'g', location: 'Freezer', kind: 'Food', frozenOn: dateKey(offset(-20)), expiresOn: dateKey(offset(100)) },
  { id: 'f2', name: 'Onions', quantity: 3, unit: 'pcs', location: 'Pantry', kind: 'Food' },
  { id: 'f3', name: 'Peas', quantity: 300, unit: 'g', location: 'Freezer', kind: 'Food' },
  { id: 'f4', name: 'Peas', quantity: 100, unit: 'g', location: 'Fridge', kind: 'Food' },
];
const needs = thawNeeds(offset(1)).map((need) => `${need.item.name} for ${need.recipe.name}`);
log.push(`tomorrow: ${needs.join(', ')}`);
if (needs.join() !== 'Chicken for Chicken curry') fail.push('only the chicken is freezer-only (there are peas in the fridge, onions in the pantry)');
if (thawNeeds(offset(2)).length) fail.push('nothing planned the day after tomorrow');

activeView = 'inventory';
render();
const panel = document.querySelector('.thaw-panel');
log.push(panel ? panel.textContent.replace(/\s+/g, ' ').trim() : '(no panel)');
if (!panel || !/Chicken/.test(panel.textContent) || !/tomorrow/.test(panel.textContent)) fail.push('Inventory page has no "Take out of the freezer" panel for the chicken');

// "Moved to the fridge": the chicken goes to the fridge with about two days, and Undo brings it back.
document.querySelector('[data-action="thaw-item"][data-id="f1"]').click();
await new Promise((resolve) => setTimeout(resolve, 50));
const chicken = state.inventory.find((item) => item.id === 'f1');
log.push(`after: ${chicken.location}, ${chicken.expiresOn}, frozenOn ${chicken.frozenOn}`);
if (chicken.location !== 'Fridge' || chicken.expiresOn !== dateKey(offset(2)) || chicken.frozenOn) fail.push('chicken not moved to the fridge with two days');
if (document.querySelector('.thaw-panel')) fail.push('panel still shown after moving the only freezer item');
undoLastChange();
if (state.inventory.find((item) => item.id === 'f1').location !== 'Freezer') fail.push('Undo did not put it back in the freezer');
state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
