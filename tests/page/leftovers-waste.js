// Leftovers after "Cooked ✓" go into the fridge with 3 days; removing items asks why, and the month overview on
// the Inventory page counts what was used up and what was thrown away.
const fail = []; const log = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
const inDays = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return dateKey(date); };
const fridge = state.locations.find((place) => FRIDGE_WORDS.test(place));
state.recipes = [{ id: 'lw1', name: 'Pea soup', ingredients: ['500 g peas'] }];
state.plan = [{ id: 'p1', date: dateKey(new Date()), recipeId: 'lw1', cooked: false }];
state.inventory = [
  { id: 'w1', name: 'Bread', quantity: 1, unit: '', location: state.locations[0], kind: 'Food' },
  { id: 'w2', name: 'Bread rolls', quantity: 1, unit: '', location: state.locations[0], kind: 'Food' },
  { id: 'w3', name: 'Yogurt', quantity: 1, unit: '', location: fridge, kind: 'Food' },
];
state.log = [];

// Cooked with leftovers.
openCookDialog(state.plan[0]);
if ($('#cook-form').elements.leftovers.checked) fail.push('leftovers ticked by default');
$('#cook-form').elements.leftovers.checked = true;
$('#cook-form').requestSubmit();
await wait();
const leftovers = state.inventory.find((item) => item.leftovers);
log.push(`leftovers: ${JSON.stringify(leftovers)}`);
if (!leftovers || !leftovers.name.includes('Pea soup') || leftovers.location !== fridge || leftovers.expiresOn !== inDays(3)) fail.push('leftovers not added to the fridge with 3 days');
if (!itemsNeedingExpiryAttention().some((item) => item.id === leftovers?.id)) fail.push('leftovers are not in Use soon');
// Not ticked: nothing added.
state.plan.push({ id: 'p2', date: dateKey(new Date()), recipeId: 'lw1', cooked: false });
const count = state.inventory.length;
openCookDialog(state.plan[1]);
$('#cook-form').requestSubmit();
await wait();
if (state.inventory.length !== count) fail.push('leftovers added without the box ticked');

// Removing with a reason, through the dialog.
activeView = 'inventory';
render();
if (document.querySelector('.month-overview')) fail.push('month overview shows with nothing removed');
const removeWith = async (id, action) => {
  document.querySelector(`[data-action="edit-item"][data-id="${id}"]`).click();
  await wait();
  $('#item-remove').click();
  document.querySelector(`[data-action="${action}"]`).click();
  await wait();
};
await removeWith('w1', 'remove-wasted');
await removeWith('w3', 'remove-used');
state.inventory.unshift({ id: 'w4', name: 'Bread', quantity: 1, unit: '', location: state.locations[0], kind: 'Food' });
render();
await removeWith('w4', 'remove-wasted');
log.push(`log: ${JSON.stringify(state.log.map(({ name, outcome }) => [name, outcome]))}`);
if (state.log.length !== 3) fail.push(`expected 3 logged removals, got ${state.log.length}`);
const overview = document.querySelector('.month-overview');
log.push(`overview: ${overview && overview.textContent}`);
if (!overview) fail.push('no month overview after removals');
else {
  if (!/1/.test(overview.textContent) || !/2/.test(overview.textContent)) fail.push(`overview counts wrong: ${overview.textContent}`);
  if (!overview.textContent.includes('Bread ×2')) fail.push(`overview does not name the bread twice: ${overview.textContent}`);
}
// Undo takes the log entry back too.
await removeWith('w2', 'remove-wasted');
document.querySelector('#undo-bar [data-action="undo"]').click();
if (state.log.length !== 3 || !state.inventory.some((item) => item.id === 'w2')) fail.push('Undo did not take back the removal and its log entry');
// Entries from another month don't count.
state.log = [{ id: 'old', name: 'Old cheese', date: '2020-01-05', outcome: 'wasted' }];
render();
if (document.querySelector('.month-overview')) fail.push('an old month counts in this month');
state.log = [];
return { fail, log };
