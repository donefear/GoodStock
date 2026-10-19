// The shopping list counts amounts (0.26): the week's meals added up per ingredient, minus what is in stock.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
state.recipes = [
  { id: 's1', name: 'Pancakes', ingredients: ['500 g flour', '4 eggs', '500 ml milk', '1 bunch parsley'] },
  { id: 's2', name: 'Omelette', ingredients: ['4 eggs', '100 g cheese'] },
  { id: 's3', name: 'Bread', ingredients: ['250 g flour', '1 tsp salt'] },
];
selectedDate = new Date();
weekStart = startOfWeek(selectedDate);
const day = (offset) => dateKey(dateAtOffset(offset));
state.plan = [
  { id: 'q1', date: day(0), recipeId: 's1', cooked: false },
  { id: 'q2', date: day(1), recipeId: 's2', cooked: false },
  { id: 'q3', date: day(2), recipeId: 's3', cooked: false },
  { id: 'q4', date: day(3), recipeId: 's2', cooked: true },
];
state.inventory = [
  { id: 'i1', name: 'Flour', quantity: 0.1, unit: 'kg', location: 'Pantry', kind: 'Food' },
  { id: 'i2', name: 'Eggs', quantity: 6, unit: 'pcs', location: 'Fridge', kind: 'Food' },
  { id: 'i3', name: 'Milk', quantity: 1, unit: 'l', location: 'Fridge', kind: 'Food' },
  { id: 'i4', name: 'Parsley', quantity: 20, unit: 'g', location: 'Fridge', kind: 'Food' },
  { id: 'i5', name: 'Salt', quantity: 500, unit: 'g', location: 'Pantry', kind: 'Food' },
];
// Short names in other languages (Dutch "ei", Turkish "un") once matched milk, cheese and salt to Eggs, parsley to Flour.
for (const [line, name] of [['500 ml milk', 'Milk'], ['100 g cheese', undefined], ['1 tsp salt', 'Salt'], ['1 bunch parsley', 'Parsley'], ['4 eggs', 'Eggs']]) {
  const found = (matchingInventory(line) || {}).name;
  if (found !== name) fail.push(`"${line}" matched ${found}, expected ${name}`);
}
state.shopping = [];
generateShopping();
const list = state.shopping.map((entry) => `${entry.name} ${entry.quantity} ${entry.unit} · ${entry.source}`);
log.push(...list);
const find = (name) => state.shopping.find((entry) => entry.name.toLowerCase() === name);
const flour = find('flour');
if (!flour || flour.quantity !== 650 || flour.unit !== 'g') fail.push(`flour: 750 g needed, 100 g in stock, so 650 g, got ${flour && `${flour.quantity} ${flour.unit}`}`);
if (flour && !/Pancakes/.test(flour.source) || flour && !/Bread/.test(flour.source)) fail.push('flour should name both recipes');
const eggs = find('eggs');
if (!eggs || eggs.quantity !== 2) fail.push(`eggs: 8 needed (the cooked omelette doesn't count), 6 in stock, so 2, got ${eggs && eggs.quantity}`);
if (find('milk')) fail.push('milk: 500 ml needed, 1 l in stock, nothing to buy');
if (find('parsley')) fail.push('parsley: "1 bunch" can\'t be compared with grams, so it counts as enough');
if (find('salt')) fail.push('salt: a teaspoon against 500 g can\'t be compared, so it counts as enough');
const cheese = find('cheese');
if (!cheese || cheese.quantity !== 100 || cheese.unit !== 'g') fail.push(`cheese: not in stock, 100 g, got ${cheese && `${cheese.quantity} ${cheese.unit}`}`);
const count = state.shopping.length;
generateShopping();
if (state.shopping.length !== count) fail.push('making the list again doubled items');
state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
