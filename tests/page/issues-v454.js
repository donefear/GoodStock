// v4.5.4 (issues/REVIEW.txt): text size names, units you pick (metric or imperial), "running low" as a filter, adding
// to the shopping list by hand, searching the web and previewing a web recipe, the Import dialog's title, the sync
// card opening Settings, and This week without the repeated day heading.
const fail = []; const log = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
const kitchenBefore = JSON.stringify(state);
const viewBefore = activeView;
const mealDbBefore = mealDb;
const saved = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const unitsBefore = saved(UNITS_KEY);
const sizeBefore = saved(TEXT_SIZE_KEY);
const oldSizeBefore = saved(OLD_TEXT_SIZE_KEY);
const restoreKey = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };

// 1. Text size: Small / Normal / Large, Normal (115%) by default; an old saved size keeps its size.
localStorage.removeItem(TEXT_SIZE_KEY);
localStorage.removeItem(OLD_TEXT_SIZE_KEY);
if (savedTextSize() !== 'normal') fail.push(`default text size is ${savedTextSize()}`);
for (const [old, now] of [['normal', 'small'], ['large', 'normal'], ['xlarge', 'large']]) {
  localStorage.setItem(OLD_TEXT_SIZE_KEY, old);
  if (savedTextSize() !== now) fail.push(`old "${old}" became ${savedTextSize()}, not ${now}`);
}
const sizes = Array.from($('#text-size-select').options).map((option) => option.value).join(',');
if (sizes !== 'small,normal,large') fail.push(`text size options: ${sizes}`);
restoreKey(TEXT_SIZE_KEY, sizeBefore);
restoreKey(OLD_TEXT_SIZE_KEY, oldSizeBefore);

// 2. The Unit field is a list; an old "bag" asks for a real unit.
localStorage.setItem(UNITS_KEY, 'metric');
state.inventory = [
  { id: 'rice', name: 'Rice', quantity: 50, unit: 'g', location: state.locations[0], kind: 'Food' },
  { id: 'flour', name: 'Flour', quantity: 1, unit: 'kg', location: state.locations[0], kind: 'Food' },
  { id: 'eggs', name: 'Eggs', quantity: 1, unit: 'pcs', location: state.locations[1], kind: 'Food' },
  { id: 'milk', name: 'Milk', quantity: 3, unit: 'l', minimum: 4, location: state.locations[1], kind: 'Food' },
  { id: 'oats', name: 'Oats', quantity: 2, unit: 'bag', location: state.locations[0], kind: 'Food' },
];
state.shopping = [];
activeView = 'inventory';
render();
const form = $('#item-form');
if (form.elements.unit.tagName !== 'SELECT') fail.push('the Unit field is not a list');
openItemDialog(state.inventory.find((item) => item.id === 'oats'));
if (form.elements.unit.value !== '' || !/bag/.test(form.querySelector('.unit-hint').textContent)) fail.push(`a bag is not questioned: "${form.elements.unit.value}" · ${form.querySelector('.unit-hint').textContent}`);
if (Array.from(form.elements.unit.options).some((option) => /bag|can|jar/.test(option.value))) fail.push('bags, cans or jars are offered');
$('#item-dialog').close();
openItemDialog(state.inventory.find((item) => item.id === 'rice'));
if (form.elements.unit.value !== 'g') fail.push(`rice shows unit "${form.elements.unit.value}"`);
$('#item-dialog').close();
// − and ＋ on a weighed item step 50 g.
document.querySelector('[data-action="adjust"][data-id="rice"][data-delta="1"]').click();
if (state.inventory.find((item) => item.id === 'rice').quantity !== 100) fail.push(`＋ on 50 g rice gave ${state.inventory.find((item) => item.id === 'rice').quantity}`);
document.querySelector('[data-action="adjust"][data-id="rice"][data-delta="-1"]').click();

// 3. Imperial on this device: shown and typed in lb/oz, saved metric.
localStorage.setItem(UNITS_KEY, 'imperial');
const pound = shownAmount(454, 'g');
if (pound.quantity !== 1 || pound.unit !== 'lb') fail.push(`454 g shows as ${JSON.stringify(pound)}`);
if (amountText(250, 'ml') !== '8.5 fl oz') fail.push(`250 ml shows as ${amountText(250, 'ml')}`);
openItemDialog();
form.elements.name.value = 'Butter';
form.elements.quantity.value = '1';
form.elements.unit.value = 'lb';
if (form.elements.unit.value !== 'lb') fail.push('no lb on an imperial device');
form.requestSubmit();
await wait();
const butter = state.inventory.find((item) => item.name === 'Butter');
log.push(`imperial butter: ${JSON.stringify(butter && { quantity: butter.quantity, unit: butter.unit })}`);
if (!butter || butter.quantity !== 454 || butter.unit !== 'g') fail.push('1 lb was not saved as 454 g');
if (!/1 lb/.test(document.querySelector('.inventory-list').textContent)) fail.push('the inventory does not show 1 lb');
openItemDialog(butter);
if (form.elements.quantity.value !== '1' || form.elements.unit.value !== 'lb') fail.push(`editing shows ${form.elements.quantity.value} ${form.elements.unit.value}`);
$('#item-dialog').close();
state.inventory = state.inventory.filter((item) => item.name !== 'Butter');
localStorage.setItem(UNITS_KEY, 'metric');
render();

// 4. Running low is a button that shows only those items: 50 g rice, 1 egg, milk below its minimum.
const lowButton = document.querySelector('[data-action="filter-low"]');
if (!lowButton || lowButton.querySelector('strong').textContent !== '3') fail.push(`running low count: ${lowButton && lowButton.textContent}`);
lowButton.click();
const lowRows = Array.from(document.querySelectorAll('.inventory-row strong')).map((node) => node.textContent).join(', ');
log.push(`running low: ${lowRows}`);
if (lowRows !== 'Rice, Eggs, Milk') fail.push(`running low shows ${lowRows}`);
document.querySelector('[data-action="filter-low"]').click();
if (document.querySelectorAll('.inventory-row').length !== 5) fail.push('the filter did not switch off');

// 5. Shopping → Add item, like the inventory's; the same product adds up.
activeView = 'shopping';
render();
document.querySelector('[data-action="add-shopping-item"]').click();
const shop = $('#shopping-item-form');
if (!$('#shopping-item-dialog').open) fail.push('Add item did not open on Shopping');
shop.elements.name.value = 'Oats';
shop.elements.quantity.value = '500';
shop.elements.unit.value = 'g';
shop.requestSubmit();
await wait();
openShoppingItemDialog();
shop.elements.name.value = 'Oats';
shop.elements.quantity.value = '1';
shop.elements.unit.value = 'kg';
shop.requestSubmit();
await wait();
const oats = state.shopping.filter((entry) => entry.name === 'Oats');
log.push(`shopping: ${JSON.stringify(oats.map(({ quantity, unit }) => ({ quantity, unit })))}`);
if (oats.length !== 1 || oats[0].quantity !== 1500 || oats[0].unit !== 'g') fail.push('typed lines did not add up to 1500 g');

// 6. Search online and a preview before saving.
const meal = { idMeal: '77', strMeal: 'Spanish Tortilla', strArea: 'Spanish', strCategory: 'Vegetarian', strInstructions: 'Fry the potatoes. Add the eggs.', strMealThumb: '', strIngredient1: 'Potatoes', strMeasure1: '500g', strIngredient2: 'Eggs', strMeasure2: '6' };
mealDb = async (path, params = {}) => (path === 'search.php' && /tortilla/i.test(params.s) ? { meals: [meal] } : { meals: null });
activeView = 'recipes';
recipeQuery = '';
render();
if (!document.querySelector('.search-online-button').hidden) fail.push('Search online shows with an empty search');
const search = $('#recipe-search');
search.value = 'tortilla';
search.dispatchEvent(new Event('input', { bubbles: true }));
if (document.querySelector('.search-online-button').hidden) fail.push('Search online stays hidden while typing');
document.querySelector('.search-online-button').click();
await wait();
if (ideas.query !== 'tortilla' || ideas.results.length !== 1) fail.push(`online search: ${JSON.stringify({ query: ideas.query, results: ideas.results.length, error: ideas.error })}`);
const recipesBefore = state.recipes.length;
document.querySelector('.idea-card .idea-title').click();
await wait();
if (!$('#recipe-dialog').open || $('#recipe-dialog-title').textContent !== 'Spanish Tortilla') fail.push('the title does not open a preview');
if ($('#recipe-dialog-steps').hidden || !$$('#recipe-dialog-steps li').length) fail.push('the preview has no steps');
if (state.recipes.length !== recipesBefore) fail.push('previewing saved the recipe');
$('#recipe-dialog').close();
document.querySelector('.idea-card').click();
await wait();
if (!$('#recipe-dialog').open) fail.push('the card does not open a preview');
document.querySelector('#recipe-dialog-actions [data-action="add-idea"]').click();
await wait();
if (state.recipes.length !== recipesBefore + 1 || $('#recipe-dialog').open || activeView !== 'recipe') fail.push('Add to my recipes in the preview did not save and open it');
ideas = { loading: false, searched: false, error: '', results: [] };

// 7. Import opens a dialog called Import a recipe; New recipe stays New recipe.
openRecipeEditor(null, { importFirst: true });
if ($('#recipe-edit-title').textContent !== t('Import a recipe')) fail.push(`import title: ${$('#recipe-edit-title').textContent}`);
$('#recipe-edit-dialog').close();
openRecipeEditor();
if ($('#recipe-edit-title').textContent !== t('New recipe')) fail.push('New recipe lost its title');
$('#recipe-edit-dialog').close();

// 8. The sync card opens Settings.
document.querySelector('.sync-card').click();
await wait();
if (!$('#settings-dialog').open) fail.push('the sync card does not open Settings');
const panel = document.querySelector('#settings-dialog .settings-panel:not([hidden])');
log.push(`sync card opens: ${panel && panel.dataset.panel}`);
if (!panel || panel.dataset.panel !== (!isShared() && !folderSync() ? 'data' : 'connections')) fail.push(`the sync card opened ${panel && panel.dataset.panel}`);
$('#settings-dialog').close();

// 9. This week: no repeated day heading; Copy this day to… stays when the day has a meal.
state.recipes = [{ id: 'w1', name: 'Soup', ingredients: ['1 onion'] }];
state.plan = [{ id: 'wp', date: dateKey(selectedDate), recipeId: 'w1', cooked: false }];
activeView = 'week';
render();
if (document.querySelector('.day-detail .section-heading') || /YOUR PLAN/.test(document.querySelector('.day-detail').textContent)) fail.push('the day heading is still there');
if (!document.querySelector('.day-detail [data-action="copy-day"]')) fail.push('Copy this day to… is gone');

mealDb = mealDbBefore;
restoreKey(UNITS_KEY, unitsBefore);
state = normalizeState(JSON.parse(kitchenBefore));
activeView = viewBefore;
render();
return { fail, log };
