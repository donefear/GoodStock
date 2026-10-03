const fail = []; const log = [];
const cases = [
  ['2 eggs', 2, '4 eggs'], ['1/2 tsp salt', 2, '1 tsp salt'], ['2 cups flour', 1.5, '3 cups flour'], ['250 g pasta', 0.5, '125 g pasta'],
  ['2–3 cloves garlic', 2, '4–6 cloves garlic'], ['1 1/2 cups milk', 2, '3 cups milk'], ['salt to taste', 3, 'salt to taste'],
  ['100 g de harina', 2, '200 g de harina'], ['1 tbsp olive oil', 0.5, '½ tbsp olive oil'], ['3 eggs', 1 / 3, '1 eggs'],
];
for (const [line, factor, want] of cases) {
  const got = scaleIngredientLine(line, factor);
  log.push(`${line} ×${Math.round(factor * 100) / 100} → ${got}`);
  if (got !== want) fail.push(`${line} ×${factor}: expected "${want}", got "${got}"`);
}
// A recipe with servings: 4 → 6 is ×1.5; the label follows.
const soup = { id: 's', name: 'Soup', servings: 4, ingredients: ['1 onion', '800 ml stock'], instructions: ['Simmer 20 minutes.'] };
const factor = nextScale(soup, nextScale(soup, 1, 1), 1);
log.push(`servings 4 → ${scaleLabel(soup, factor)} (×${factor})`);
if (Math.abs(factor - 1.5) > 0.001 || scaleLabel(soup, factor) !== '6 servings') fail.push(`servings stepping wrong: ${factor}`);
// Without servings: ×1 → ×2 → ×3.
const plain = { id: 'p', name: 'Plain', ingredients: ['2 eggs'] };
const twice = nextScale(plain, nextScale(plain, 1, 1), 1);
log.push(`no servings: ×1 → ${scaleLabel(plain, nextScale(plain, 1, 1))} → ${scaleLabel(plain, twice)}`);
if (twice !== 2) fail.push(`multiplier stepping wrong: ${twice}`);
// A planned meal with scale 2: the shopping list and cook mode use the doubled amounts.
state.recipes = [soup]; state.inventory = []; state.shopping = [];
state.plan = [{ id: 'm', date: dateKey(new Date()), recipeId: 's', cooked: false, scale: 2 }];
weekStart = startOfWeek(new Date());
generateShopping();
const stock = state.shopping.find((item) => /stock/.test(item.name));
log.push(`shopping: ${state.shopping.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join('; ')}`);
if (!stock || Number(stock.quantity) !== 1600) fail.push('shopping list did not double the stock');
await startCookSteps(soup, 'm');
const gather = cookSession.bites.find((bite) => bite.type === 'gather');
log.push(`cook mode: ${gather.items.join('; ')}`);
if (!gather.items.includes('1600 ml stock')) fail.push('cook mode did not use the planned scale');
$('#steps-dialog').close();
// The recipe page shows the control and scaled amounts.
recipeScales.set('s', 0.5); recipePageId = 's'; activeView = 'recipe'; render();
const page = [...document.querySelectorAll('.recipe-page-ingredients li span:nth-child(2)')].map((el) => el.textContent);
log.push(`page at 2 servings: ${page.join('; ')} | control: ${document.querySelector('.servings-control span').textContent}`);
if (!page.includes('400 ml stock')) fail.push('recipe page did not scale');
return { fail, log };
