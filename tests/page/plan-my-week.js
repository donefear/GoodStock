// "Fill the empty days" (0.47): a recipe for every empty day of the shown week, use-soon recipes first and earliest,
// none planned in the last ten days, no recipe twice; Swap, leave a day out, and nothing planned before "Plan these".
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
state.recipes = [
  { id: 'm1', name: 'Soup', ingredients: ['1 onion'] },
  { id: 'm2', name: 'Pancakes', ingredients: ['2 eggs', '200 g flour'] },
  { id: 'm3', name: 'Potato tray', ingredients: ['1 kg potatoes'] },
  { id: 'm4', name: 'Spinach pie', ingredients: ['300 g spinach'] },
  { id: 'm5', name: 'Rice bowl', ingredients: ['200 g rice'] },
];
const today = dateKey(new Date());
// Next week, so all seven days lie ahead whatever today is.
selectedDate = new Date();
weekStart = startOfWeek(selectedDate);
weekStart = dateAtOffset(7);
const day = (offset) => dateKey(dateAtOffset(offset));
state.plan = [
  { id: 'recent', date: shiftDateKey(today, -3), recipeId: 'm1', cooked: true }, // the soup was just had
  { id: 'planned', date: day(2), recipeId: 'm3', cooked: false }, // Wednesday already has the potato tray
];
// Spinach to use up today, and the eggs and flour in stock: the spinach pie goes first, then the pancakes.
state.inventory = [
  { id: 'spinach', name: 'Spinach', quantity: 1, unit: 'bag', location: state.locations[0], kind: 'Food', expiresOn: today },
  { id: 'eggs', name: 'Eggs', quantity: 6, unit: 'pcs', location: state.locations[0], kind: 'Food' },
  { id: 'flour', name: 'Flour', quantity: 1, unit: 'kg', location: state.locations[0], kind: 'Food' },
];
activeView = 'week';
render();

const fill = document.querySelector('[data-action="suggest-week"]');
if (!fill) fail.push('no "Fill the empty days" button');
fill?.click();
await wait();
const suggestions = weekSuggestions.map((entry) => `${entry.date.slice(5)} ${recipeById(entry.recipeId).name}`);
log.push(JSON.stringify(suggestions));
if (weekSuggestions.length !== 3) fail.push(`expected 3 suggestions (6 empty days, 3 recipes not recent or planned), got ${weekSuggestions.length}`);
if (weekSuggestions[0]?.recipeId !== 'm4' || weekSuggestions[0]?.date !== day(0)) fail.push('the recipe that uses the spinach should come first, on the first empty day');
if (weekSuggestions[1]?.recipeId !== 'm2') fail.push('the pancakes (nothing to buy) should come second');
if (weekSuggestions.some((entry) => ['m1', 'm3'].includes(entry.recipeId))) fail.push('a recipe planned in the last ten days was suggested');
if (weekSuggestions.some((entry) => entry.date === day(2))) fail.push('a day that already has a meal was suggested');
if (new Set(weekSuggestions.map((entry) => entry.recipeId)).size !== weekSuggestions.length) fail.push('a recipe was suggested twice');
if (state.plan.length !== 2) fail.push('suggesting planned something already');
if (!document.querySelector('.week-suggestions')) fail.push('the suggestions are not shown');

// Swap the last one: no other recipe is free, so it stays; swap the first: it takes a free one (none) → unchanged.
// Leave the second day out instead.
const secondDate = weekSuggestions[1].date;
document.querySelector(`[data-action="drop-suggestion"][data-date="${secondDate}"]`).click();
await wait();
if (weekSuggestions.some((entry) => entry.date === secondDate)) fail.push('leaving a day out did not remove it');
// With the pancakes free again, swapping the first day takes the next free recipe.
document.querySelector(`[data-action="swap-suggestion"][data-date="${day(0)}"]`).click();
await wait();
if (weekSuggestions[0].recipeId === 'm4') fail.push('Swap did not change the recipe');
if (new Set(weekSuggestions.map((entry) => entry.recipeId)).size !== weekSuggestions.length) fail.push('Swap made a recipe appear twice');
log.push(`after: ${JSON.stringify(weekSuggestions.map((entry) => recipeById(entry.recipeId).name))}`);

document.querySelector('[data-action="plan-suggestions"]').click();
await wait();
const added = state.plan.filter((entry) => !['recent', 'planned'].includes(entry.id));
if (added.length !== 2) fail.push(`"Plan these" should plan 2 meals, planned ${added.length}`);
if (weekSuggestions !== null) fail.push('the suggestions stayed open after planning');
undoLastChange();
if (state.plan.length !== 2) fail.push('Undo did not take the planned meals back');

state = JSON.parse(kitchenBefore);
weekStart = startOfWeek(new Date());
render();
return { fail, log };
