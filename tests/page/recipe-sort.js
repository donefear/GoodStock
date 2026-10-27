// Sorting the recipe box (0.58): A to Z, best rated, cooked most / lately / not in a while, newest, fewest ingredients;
// the choice is kept per browser and names the list.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const sortBefore = recipeSort;
const today = dateKey(new Date());
const daysAgo = (days) => dateKey(new Date(Date.now() - days * DAY_MS));
state.inventory = [];
state.recipes = [
  { id: 'r1', name: 'banana bread', ingredients: ['3 bananas', '200 g flour', '2 eggs'], rating: 3 },
  { id: 'r2', name: 'Apple pie', ingredients: ['4 apples', '250 g flour', '100 g butter', '1 egg'], rating: 5 },
  { id: 'r3', name: 'Carrot soup', ingredients: ['500 g carrots'] },
  { id: 'r4', name: 'Dal', ingredients: ['200 g lentils', '1 onion'], rating: 4 },
];
state.plan = [
  { id: 'p1', recipeId: 'r3', date: daysAgo(30), cooked: true },
  { id: 'p2', recipeId: 'r3', date: daysAgo(20), cooked: true },
  { id: 'p3', recipeId: 'r1', date: daysAgo(2), cooked: true },
  { id: 'p4', recipeId: 'r4', date: today, cooked: false },
];
activeView = 'recipes';
const filtersBefore = { dietFilters, favouritesOnly, recipeQuery };
dietFilters = []; favouritesOnly = false; recipeQuery = '';
const names = () => Array.from(document.querySelectorAll('.recipe-grid .recipe-card-title')).map((title) => title.textContent);
const expect = {
  name: ['Apple pie', 'banana bread', 'Carrot soup', 'Dal'],
  rating: ['Apple pie', 'Dal', 'banana bread', 'Carrot soup'],
  cooked: ['Carrot soup', 'banana bread', 'Dal', 'Apple pie'],
  recent: ['banana bread', 'Carrot soup', 'Dal', 'Apple pie'],
  forgotten: ['Dal', 'Apple pie', 'Carrot soup', 'banana bread'],
  newest: ['banana bread', 'Apple pie', 'Carrot soup', 'Dal'],
  fewest: ['Carrot soup', 'Dal', 'banana bread', 'Apple pie'],
};
setRecipeSort('ready');
const picker = document.querySelector('#recipe-sort');
if (!picker) fail.push('no sort menu on the Recipes page');
if (picker && picker.options.length !== Object.keys(RECIPE_SORTS).length) fail.push(`sort menu has ${picker.options.length} choices`);
for (const [sort, order] of Object.entries(expect)) {
  const select = document.querySelector('#recipe-sort');
  select.value = sort;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const shown = names();
  if (shown.join('|') !== order.join('|')) fail.push(`${sort}: ${shown.join(', ')}`);
  if (document.querySelector('#recipe-sort').closest('.recipe-results-heading').querySelector('h2').textContent !== t(RECIPE_SORTS[sort])) fail.push(`${sort}: heading not named after the sort`);
}
if (localStorage.getItem(RECIPE_SORT_KEY) !== 'fewest') fail.push('the sort is not remembered');
if (document.querySelector('#recipe-sort').value !== 'fewest') fail.push('the menu does not show the chosen sort after rendering');
setRecipeSort('nonsense');
if (recipeSort !== 'ready') fail.push('an unknown sort is not reset to closest to ready');

({ dietFilters, favouritesOnly, recipeQuery } = filtersBefore);
setRecipeSort(sortBefore);
state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
