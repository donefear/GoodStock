const fail = []; const log = [];
const id = (text) => ingredientRecord(text)?.id || null;
const cases = [
  ['200 g flour', 'flour'], ['Bloem', 'flour'], ['300 g de harina', 'flour'], ['250 g Mehl', 'flour'], ['Farine', 'flour'],
  ['1 sweet potato', 'sweet-potato'], ['2 Süßkartoffeln', 'sweet-potato'], ['4 Kartoffeln', 'potato'], ['Patatas', 'potato'],
  ['500 ml молоко', 'milk'], ['500 ml 牛奶', 'milk'], ['牛乳 200ml', 'milk'], ['卵 2個', 'egg'], ['3 яйца', 'egg'],
  ['2 cebollas', 'onion'], ["2 c. à s. d'huile d'olive", 'olive-oil'], ['Aceite de oliva', 'olive-oil'], ['Olivenöl', 'olive-oil'],
  ['Сливочное масло', 'butter'], ['Оливковое масло', 'olive-oil'], ['Peperone rosso', 'bell-pepper'], ['Pepe nero', 'black-pepper'],
  ['Kipfilet', 'chicken'], ['Rolled oats', 'oats'], ['Havermout', 'oats'], ['Dish soap', null], ['Pancakes', null],
];
for (const [text, want] of cases) {
  const got = id(text);
  log.push(`${text} → ${got}`);
  if (got !== want) fail.push(`${text}: expected ${want}, got ${got}`);
}
// A Spanish recipe line finds an English inventory item.
state.inventory = [{ id: 'x1', name: 'Flour', quantity: 1, unit: 'kg', location: 'Pantry', kind: 'Food' }, { id: 'x2', name: 'Eieren', quantity: 6, unit: 'pcs', location: 'Fridge', kind: 'Food' }];
if (matchingInventory('300 g de harina')?.id !== 'x1') fail.push('Spanish harina did not match English Flour in stock');
if (matchingInventory('2 huevos')?.id !== 'x2') fail.push('Spanish huevos did not match Dutch Eieren in stock');
if (matchingInventory('2 Eier')?.id !== 'x2') fail.push('German Eier did not match');
if (matchingInventory('100 g Zucker')) fail.push('Zucker matched something it should not');
const days = shelfLifeDaysFor('Milch', 'Kühlschrank');
log.push(`Milch in Kühlschrank → ${days} days`);
if (days !== ingredientCatalog.find((entry) => entry.id === 'milk').shelfLifeDays.fridge) fail.push('German milk in fridge did not get the fridge shelf life');
return { fail, log };
