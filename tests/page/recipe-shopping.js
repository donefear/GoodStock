// Shopping → From recipes: the picked recipes' ingredients go on the list, and the same ingredient becomes one line
// with the amounts added up ("2 potatoes" and "1 potato" make 3), also with what is already on the list.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const viewBefore = activeView;
state.recipes = [
  { id: 'r1', name: 'Soup', servings: 2, ingredients: ['2 potatoes', '1 onion', '500 g carrots', '2 aardappelen'] },
  { id: 'r2', name: 'Stew', ingredients: ['1 potato', '0.5 kg carrots', '2 sprigs thyme', '1 aardappel'] },
  { id: 'r3', name: 'Mash', ingredients: ['300 g potatoes'] },
];
state.inventory = [{ id: 'i1', name: 'Onions', quantity: 5, unit: 'pcs', location: 'Pantry', kind: 'Food' }];
state.plan = [];
state.shopping = [{ id: 'x1', name: 'Potatoes', quantity: 1, unit: '', checked: false, source: 'Shared' }];

const line = (pattern) => state.shopping.filter((entry) => pattern.test(entry.name));
const show = () => state.shopping.map((entry) => `${entry.name} ${entry.quantity} ${entry.unit} · ${entry.source}`).join(' | ');

// The picker: tick Soup at 4 servings (twice the recipe) and Stew once, leaving out what is in stock.
openRecipeShopping();
// The layout (v4.5.5): one line per recipe (sizes allow for the 115% text size) with the app's own tick box, and a styled search field.
const firstRow = document.querySelector('#recipe-shopping-list .recipe-shopping-row');
const tick = firstRow && firstRow.querySelector('.custom-check');
if (!tick || tick.getBoundingClientRect().width > 32) fail.push(`the tick box is ${tick ? tick.getBoundingClientRect().width : 'missing'}px wide`);
if (!firstRow || firstRow.getBoundingClientRect().height > 75) fail.push(`a recipe row is ${firstRow && firstRow.getBoundingClientRect().height}px high`);
const amountBox = firstRow && firstRow.querySelector('.recipe-shopping-amount input');
if (!amountBox || amountBox.getBoundingClientRect().width > 95) fail.push('the amount field is stretched');
if (getComputedStyle($('#recipe-shopping-search')).borderTopLeftRadius === '0px') fail.push('the search field has no dialog styling');
const box = (id) => document.querySelector(`#recipe-shopping-list [data-shop-recipe="${id}"]`);
if (document.querySelectorAll('#recipe-shopping-list .recipe-shopping-row').length !== 3) fail.push('the picker does not list the three recipes');
box('r1').click();
box('r2').click();
const servings = document.querySelector('#recipe-shopping-list [data-shop-servings="r1"]');
if (!servings || servings.disabled) fail.push('Soup has no servings field after ticking it');
else { servings.value = '4'; servings.dispatchEvent(new Event('input', { bubbles: true })); }
if (!/2/.test($('#recipe-shopping-add').textContent)) fail.push(`button says "${$('#recipe-shopping-add').textContent}"`);
$('#recipe-shopping-search').value = 'stew';
$('#recipe-shopping-search').dispatchEvent(new Event('input', { bubbles: true }));
if (document.querySelectorAll('#recipe-shopping-list .recipe-shopping-row').length !== 1) fail.push('search does not narrow the list');
if (!box('r2') || !box('r2').checked) fail.push('a ticked recipe is unticked after searching');
$('#recipe-shopping-stock').checked = true;
$('#recipe-shopping-form').dispatchEvent(new Event('submit', { cancelable: true }));
log.push(show());

// Potatoes: 1 already listed + 2×2 (Soup at 4 servings) + 1 (Stew) + Dutch 2×2 + 1 = 11 on one line.
const potatoes = line(/potato|aardappel/i);
if (potatoes.length !== 1) fail.push(`potatoes on ${potatoes.length} lines: ${show()}`);
else {
  if (Number(potatoes[0].quantity) !== 11) fail.push(`potatoes ${potatoes[0].quantity}, expected 11`);
  if (!/Shared/.test(potatoes[0].source) || !/Soup/.test(potatoes[0].source) || !/Stew/.test(potatoes[0].source)) fail.push(`potato sources "${potatoes[0].source}"`);
}
// Carrots: 1000 g (Soup ×2) + 0.5 kg = 1500 g, in the first line's unit.
const carrots = line(/carrot/i);
if (carrots.length !== 1 || Number(carrots[0].quantity) !== 1500 || carrots[0].unit !== 'g') fail.push(`carrots: ${carrots.map((entry) => `${entry.quantity} ${entry.unit}`).join(', ')}`);
if (line(/onion/i).length) fail.push('onions are in stock but went on the list');
if (line(/thyme/i).length !== 1) fail.push('thyme missing');
if (activeView !== 'shopping') fail.push(`view is ${activeView} after adding`);

// Grams can't be added to a count, so they get a line of their own instead of being lost.
addToShoppingList(shoppingNeeds([{ recipe: recipeById('r3'), scale: 1 }], { fromStock: false }), { combine: true });
if (line(/potato|aardappel/i).length !== 2 || !line(/potato/i).some((entry) => entry.unit === 'g' && Number(entry.quantity) === 300)) fail.push(`300 g potatoes: ${show()}`);

// Refresh from plan still leaves an ingredient that is already listed alone, so refreshing twice doesn't double it.
state.plan = [{ id: 'p1', date: dateKey(new Date()), recipeId: 'r2', cooked: false }];
selectedDate = new Date();
weekStart = startOfWeek(selectedDate);
const before = JSON.stringify(state.shopping);
generateShopping();
if (JSON.stringify(state.shopping) !== before) fail.push(`Refresh from plan changed lines already on the list: ${show()}`);

// The week's list on its own also makes one line of "2 potatoes" and "1 potato".
state.shopping = [];
state.recipes.push({ id: 'r4', name: 'Chips', ingredients: ['2 potatoes'] });
state.plan.push({ id: 'p2', date: dateKey(new Date()), recipeId: 'r4', cooked: false });
generateShopping();
const weekPotatoes = line(/potato|aardappel/i);
if (weekPotatoes.length !== 1 || Number(weekPotatoes[0].quantity) !== 4) fail.push(`week list potatoes: ${show()}`);

state = normalizeState(JSON.parse(kitchenBefore));
activeView = viewBefore;
render();
return { fail, log };
