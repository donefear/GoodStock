// Search on the Inventory and Recipes pages also goes through the ingredient catalog, so a name in another language
// finds the item ("harina" → Flour, "Eier" → Eggs, "molho de soja" → Soy sauce) and plain text still works.
const fail = []; const log = [];
state.inventory = [
  { id: 's1', name: 'Flour', quantity: 1, unit: 'kg', location: state.locations[0], kind: 'Food' },
  { id: 's2', name: 'Eggs', quantity: 6, unit: 'pcs', location: state.locations[0], kind: 'Food' },
  { id: 's3', name: 'Dish soap', quantity: 1, unit: '', location: state.locations[0], kind: 'Household' },
  { id: 's4', name: 'Grandma’s jam', quantity: 1, unit: 'jar', location: state.locations[0], kind: 'Food' },
];
state.recipes = [
  { id: 'r1', name: 'Pancakes', ingredients: ['200 g flour', '2 eggs', '300 ml milk'] },
  { id: 'r2', name: 'Fried rice', ingredients: ['300 g rice', '2 tbsp soy sauce'] },
];
activeView = 'inventory';
const shownItems = (query) => {
  inventoryQuery = query;
  render();
  return [...document.querySelectorAll('.inventory-row strong')].map((element) => element.textContent);
};
const cases = [['harina', ['Flour']], ['Eier', ['Eggs']], ['яйц', ['Eggs']], ['小麦粉', ['Flour']], ['jam', ['Grandma’s jam']], ['soap', ['Dish soap']], ['xyzzy', []], ['', ['Flour', 'Eggs', 'Dish soap', 'Grandma’s jam']]];
for (const [query, expected] of cases) {
  const found = shownItems(query);
  log.push(`inventory "${query}": ${found.join(', ') || '(none)'}`);
  if (JSON.stringify(found) !== JSON.stringify(expected)) fail.push(`inventory search "${query}" showed ${JSON.stringify(found)}, expected ${JSON.stringify(expected)}`);
}
// Two letters are not enough for the catalog (too many matches), but still match plain text.
if (shownItems('ha').length) fail.push('"ha" matched through the catalog');
inventoryQuery = '';

activeView = 'recipes';
const shownRecipes = (query) => {
  recipeQuery = query;
  render();
  return [...document.querySelectorAll('.recipe-card h3')].map((element) => element.textContent.trim());
};
for (const [query, expected] of [['farine', ['Pancakes']], ['salsa de soja', ['Fried rice']], ['Reis', ['Fried rice']], ['pancake', ['Pancakes']]]) {
  const found = shownRecipes(query);
  log.push(`recipes "${query}": ${found.join(', ') || '(none)'}`);
  if (JSON.stringify(found) !== JSON.stringify(expected)) fail.push(`recipe search "${query}" showed ${JSON.stringify(found)}, expected ${JSON.stringify(expected)}`);
}
recipeQuery = '';
activeView = 'inventory';
render();
return { fail, log };
