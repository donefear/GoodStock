// Not enough in stock (v4.7.2): a recipe for 2 kg of potatoes with 1 kg in the pantry shows the potatoes 1 kg short,
// counts them as missing, and follows the servings − and ＋ on the recipe page.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const viewBefore = activeView;
const unitsBefore = (() => { try { return localStorage.getItem(UNITS_KEY); } catch { return null; } })();
localStorage.setItem(UNITS_KEY, 'metric');
state.inventory = [
  { id: 'potatoes', name: 'Potatoes', quantity: 1, unit: 'kg', location: state.locations[0], kind: 'Food' },
  { id: 'salt', name: 'Salt', quantity: 500, unit: 'g', location: state.locations[0], kind: 'Food' },
];
state.recipes.push({ id: 'my-short-stock', name: 'Potato bake', servings: 4, ingredients: ['2 kg potatoes', '1 tsp salt'], instructions: ['Bake the potatoes.'], source: 'My recipes' });
const recipe = recipeById('my-short-stock');
recipeScales.delete(recipe.id);

const potatoRow = () => document.querySelector('.recipe-page-ingredients li');
const summary = () => document.querySelector('.recipe-page-side .section-heading .muted').textContent;
const scale = (step) => document.querySelector(`[data-action="scale-recipe"][data-step="${step}"]`).click();

// The rule itself: 1 kg short, in kg; enough salt (a teaspoon can't be weighed against grams, so it counts as enough).
const { short } = ingredientStock('2 kg potatoes');
if (short !== 1) fail.push(`2 kg potatoes with 1 kg in stock is ${short} short`);
if (missingIngredients(recipe).join() !== '2 kg potatoes') fail.push(`missing: ${missingIngredients(recipe).join(', ')}`);

openRecipePage(recipe.id);
log.push(`4 servings: ${potatoRow().textContent} · ${summary()}`);
if (!potatoRow().classList.contains('short-stocked')) fail.push(`the potato row is ${potatoRow().className}, not short`);
if (!/1 kg short/.test(potatoRow().textContent)) fail.push(`the potato row says "${potatoRow().textContent}"`);
if (!/1 missing/.test(summary())) fail.push(`the heading says "${summary()}"`);

// One more serving: 2.5 kg, so 1.5 kg short, straight away.
scale(1);
log.push(`5 servings: ${potatoRow().textContent}`);
if (!/1\.5 kg short/.test(potatoRow().textContent)) fail.push(`at 5 servings the row says "${potatoRow().textContent}"`);
// Down to 2 servings: 1 kg is enough.
scale(-1); scale(-1); scale(-1);
log.push(`2 servings: ${potatoRow().textContent} · ${summary()}`);
if (!potatoRow().classList.contains('in-stock')) fail.push(`at 2 servings the potato row is ${potatoRow().className}`);
if (summary() !== t('All in stock')) fail.push(`at 2 servings the heading says "${summary()}"`);

// Less than a kilo in grams still compares: 800 g against 2 kg is 1.2 kg short; none at all is not in stock.
recipeScales.delete(recipe.id);
state.inventory[0].quantity = 800; state.inventory[0].unit = 'g';
render();
if (!/1\.2 kg short/.test(potatoRow().textContent)) fail.push(`with 800 g the row says "${potatoRow().textContent}"`);
state.inventory.shift();
render();
if (!potatoRow().classList.contains('not-stocked')) fail.push(`with no potatoes the row is ${potatoRow().className}`);

recipeScales.delete(recipe.id);
{
  if (unitsBefore === null) localStorage.removeItem(UNITS_KEY); else localStorage.setItem(UNITS_KEY, unitsBefore);
}
state = normalizeState(JSON.parse(kitchenBefore));
activeView = viewBefore;
render();
return { fail, log };
