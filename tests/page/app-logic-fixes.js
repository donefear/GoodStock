// Logic fixes (v4.7.x): odd data in backups and syncs, wiping, renaming storage places, ingredient matching
// (butter is not peanut butter), putting away, Cooked ✓, shopping needs, rounding, imperial ranges, prices, undo,
// pasted recipes, the compact layout under text zoom and numbers in the app's language. The kitchen is put back after.
const fail = []; const log = [];
const before = JSON.stringify(state);
const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (label, got, want) => {
  log.push(`${label}: ${JSON.stringify(got)}`);
  if (JSON.stringify(got) !== JSON.stringify(want)) fail.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const stock = (id, name, quantity, unit, extra = {}) => ({ id, name, quantity, unit, location: 'Fridge', kind: 'Food', ...extra });
const today = dateKey(new Date());
try {
  // 3. Odd entries are dropped, missing ids filled in (the same on every device), recipe lines become lists.
  const odd = normalizeState({ inventory: [null, 5, 'x', [], { name: 'Milk', quantity: 1, unit: 'l' }], recipes: [{ id: 'r', name: 'R', ingredients: '1 egg\n2 g salt', instructions: null }, 7], log: [null, { id: 'l' }], locations: ['Fridge', 3] });
  check('odd inventory', odd.inventory.length, 1);
  if (!odd.inventory[0].id) fail.push('an item without an id did not get one');
  check('same id twice', normalizeState({ inventory: [{ name: 'Milk' }] }).inventory[0].id, normalizeState({ inventory: [{ name: 'Milk' }] }).inventory[0].id);
  check('recipe lines', [odd.recipes.length, odd.recipes[0].ingredients, odd.recipes[0].instructions], [1, ['1 egg', '2 g salt'], []]);
  check('odd log and places', [odd.log.length, odd.locations], [1, ['Fridge']]);
  restoreKitchenData({ inventory: [stock('a', 'Rice', 1, 'kg'), null], recipes: [{ id: 'r1', name: 'X', ingredients: ['1 egg'] }] });
  check('restore summary', $('#backup-status').textContent, 'Restored 1 inventory item and 1 recipe.');

  // 2. Wipe: every list there and empty, and the pages still draw.
  const wipe = $('#wipe-form');
  wipe.elements.confirmation.value = 'WIPE';
  wipe.requestSubmit();
  await wait();
  check('wiped lists', ['log', 'logTotals', 'prices', 'checks', 'shelfLife', 'recipeNotes', 'inventory', 'recipes'].map((key) => Array.isArray(state[key]) && state[key].length), [0, 0, 0, 0, 0, 0, 0, 0]);
  if (!JSON.parse(localStorage.getItem(STORAGE_KEY)).logTotals) fail.push('the wiped kitchen was not saved whole');

  // 4. Storage places: a rename in the same position carries items and the stocktake date; a removed place sends
  // its items to the first one; an unlisted place ("Cupboard") is left alone.
  state.locations = ['Pantry', 'Fridge', 'Freezer'];
  state.inventory = [stock('f1', 'Peas', 1, 'kg', { location: 'Freezer' }), stock('c1', 'Tea', 1, 'pcs', { location: 'Cupboard' }), stock('m1', 'Milk', 1, 'l')];
  state.checks = [{ id: 'Freezer', date: today }];
  saveLocations(['Pantry', 'Fridge', 'Chest freezer']);
  check('renamed place', [state.inventory.map((item) => item.location), state.checks[0].id], [['Chest freezer', 'Cupboard', 'Fridge'], 'Chest freezer']);
  check('unchanged save', saveLocations(['Pantry', 'Fridge', 'Chest freezer']), false);
  saveLocations(['Pantry', 'Chest freezer']);
  check('removed place', state.inventory.map((item) => item.location), ['Chest freezer', 'Cupboard', 'Pantry']);
  // 5. A filter on a place that is gone shows everything.
  inventoryLocation = 'Fridge';
  activeView = 'inventory';
  render();
  check('stale filter', inventoryLocation, ALL_LOCATIONS);

  // 6. Matching: the same catalog ingredient, and the same kind of it.
  state.inventory = [stock('b', 'Butter', 250, 'g'), stock('m', 'Milk', 1, 'l'), stock('c', 'Chicken breast', 500, 'g'), stock('n', 'Egg noodles', 250, 'g'), stock('e', 'Eggs', 6, 'pcs')];
  const matched = (line) => (matchingInventory(line) || {}).id || null;
  check('matching', ['peanut butter', '1 butternut squash', '250 ml buttermilk', '400 ml coconut milk', '500 ml chicken stock', '200 g butter', '500 ml milk', '2 chicken breasts', '1 egg', '2 eieren', '200 g Eiernudeln'].map(matched),
    [null, null, null, null, null, 'b', 'm', 'c', 'e', 'e', null]);
  state.inventory.find((item) => item.id === 'e').quantity = 0;
  check('no eggs left', matched('1 egg'), null);

  // 7. Put away 500 g of potatoes counted in pieces: an item of its own, not 503 pieces.
  state.inventory = [stock('p', 'Potatoes', 3, 'pcs', { location: 'Pantry' })];
  state.shopping = [{ id: 's-p', name: 'Potatoes', quantity: 500, unit: 'g', checked: true }];
  storeShoppingItem(state.shopping[0], { quantity: 500, unit: 'g', location: 'Pantry', expiration: { expiresOn: '', expirationSource: '' }, packageDate: false });
  check('put away', state.inventory.map((item) => `${item.quantity} ${item.unit}`).sort(), ['3 pcs', '500 g']);

  // 8. Cooked ✓ takes each line off the item the dialog showed, exactly while the amount is untouched (imperial).
  localStorage.setItem('goodstock-units-v1', 'imperial');
  state.inventory = [stock('fl', 'Flour', 1, 'kg', { location: 'Pantry' }), stock('e1', 'Eggs', 2, 'pcs'), stock('e2', 'Eggs', 6, 'pcs')];
  state.recipes = [{ id: 'cook-r', name: 'Cake', ingredients: ['100 g flour', '2 eggs', '1 egg'], instructions: [] }];
  state.plan = [{ id: 'cook-p', date: today, recipeId: 'cook-r', cooked: false }];
  openCookDialog(state.plan[0]);
  log.push(`flour shown as ${$('#cook-form').elements['amount-0'].value} ${$('#cook-form').elements['amount-0'].dataset.unit}`);
  $('#cook-form').requestSubmit();
  await wait();
  check('cooked', state.inventory.map((item) => item.quantity), [0.9, 0, 6]);
  localStorage.setItem('goodstock-units-v1', 'metric');

  // 9. Shopping needs: all the milk in stock counts; "flour for dusting" doesn't block the flour line; refreshing
  // raises a line that isn't ticked yet and adds the recipe's name, and never lowers it.
  state.inventory = [stock('m1', 'Milk', 0.2, 'l'), stock('m2', 'Milk', 1, 'l', { location: 'Pantry' }), stock('fl', 'Flour', 100, 'g', { location: 'Pantry' })];
  const needs = shoppingNeeds([{ recipe: { id: 'n', name: 'Bread', ingredients: ['500 ml milk', '200 g flour', 'flour for dusting'] }, scale: 1 }]);
  check('needs', needs.map((need) => `${need.name} ${need.quantity} ${need.unit}`), ['Flour 100 g']);
  state.shopping = [{ id: 'sf', name: 'Flour', quantity: 50, unit: 'g', checked: false, source: 'Bread' }];
  addToShoppingList([{ name: 'Flour', quantity: 100, unit: 'g', source: 'Cake' }]);
  addToShoppingList([{ name: 'Flour', quantity: 30, unit: 'g', source: 'Cake' }]);
  check('refresh', [state.shopping.length, state.shopping[0].quantity, state.shopping[0].source], [1, 100, 'Bread, Cake']);

  // 10. Rounding: 3 g counts in 1.5 kg; 2.5 lb and 40 fl oz come back as they were typed; an untouched save in
  // imperial keeps 1 kg.
  check('3 g in kg', amountIn(3, 'g', 'kg'), 0.003);
  state.shopping = [{ id: 'sk', name: 'Sugar', quantity: 1.5, unit: 'kg', checked: false }];
  addToShoppingList([{ name: 'Sugar', quantity: 3, unit: 'g' }], { combine: true });
  check('1.5 kg + 3 g', state.shopping[0].quantity, 1.503);
  localStorage.setItem('goodstock-units-v1', 'imperial');
  const pounds = storedAmount(2.5, 'lb');
  const ounces = storedAmount(40, 'fl oz');
  check('imperial round trip', [shownAmount(pounds.quantity, pounds.unit), shownAmount(ounces.quantity, ounces.unit)], [{ quantity: 2.5, unit: 'lb' }, { quantity: 40, unit: 'fl oz' }]);
  state.inventory = [stock('oats', 'Rolled oats', 1, 'kg', { location: 'Pantry', minimum: 0.5 })];
  for (let round = 0; round < 3; round++) {
    openItemDialog(state.inventory[0]);
    $('#item-form').requestSubmit();
    await wait();
  }
  check('untouched imperial save', [state.inventory[0].quantity, state.inventory[0].unit, state.inventory[0].minimum], [1, 'kg', 0.5]);
  localStorage.setItem('goodstock-units-v1', 'metric');

  // 12. A smaller amount keeps the price per kilo when the price field wasn't touched.
  state.inventory = [stock('rice', 'Rice', 1, 'kg', { location: 'Pantry', unitPrice: 2 })];
  openItemDialog(state.inventory[0]);
  $('#item-form').elements.quantity.value = '0.5';
  $('#item-form').requestSubmit();
  await wait();
  check('unit price kept', [state.inventory[0].quantity, state.inventory[0].unitPrice], [0.5, 2]);

  // 14. A name of spaces only is refused.
  openItemDialog();
  $('#item-form').elements.name.value = '   ';
  $('#item-form').requestSubmit();
  await wait();
  check('blank name', [state.inventory.length, $('#item-dialog').open], [1, true]);
  $('#item-dialog').close();

  // 13. Undo puts the removed item back without undoing a later edit of another one.
  state.inventory = [stock('u1', 'Apples', 4, 'pcs'), stock('u2', 'Pears', 3, 'pcs')];
  persist();
  removeInventoryItem('u1', 'used');
  state.inventory.find((item) => item.id === 'u2').quantity = 1;
  persist();
  undoLastChange();
  check('undo', state.inventory.map((item) => `${item.name} ${item.quantity}`).sort(), ['Apples 4', 'Pears 1']);

  // 15. Use soon shows amounts like everywhere else (850 ml, not 0.85 l).
  state.inventory = [stock('soon', 'Cream', 0.85, 'l', { expiresOn: today, expirationSource: 'manual' })];
  if (!/850 ml/.test(renderExpirationPanel())) fail.push('Use soon does not show 850 ml');
  // 16. While searching, the map leaves out places with nothing that matches.
  inventoryMode = 'map';
  inventoryQuery = 'Cream';
  render();
  if (/Nothing stored here yet/.test($('#view-container').textContent)) fail.push('the map says "Nothing stored here yet" while searching');
  inventoryMode = 'list';
  inventoryQuery = '';
  // 17. Meals of a day are numbered.
  state.recipes = [{ id: 'w1', name: 'One', ingredients: [] }, { id: 'w2', name: 'Two', ingredients: [] }];
  state.plan = [{ id: 'wp1', date: today, recipeId: 'w1' }, { id: 'wp2', date: today, recipeId: 'w2' }];
  selectedDate = new Date();
  weekStart = startOfWeek(new Date());
  activeView = 'week';
  render();
  check('meal numbers', $$('.meal-index').map((node) => node.textContent), ['01', '02']);

  // 11. Imperial ranges in one unit, and pounds plus ounces as one amount.
  check('metric ranges', ['2-3 lbs potatoes', '1 - 2 quarts milk', '1 lb 8 oz beef', '8 oz cheddar'].map(metricText), ['0.9–1.4 kg potatoes', '0.9–1.9 l milk', '680 g beef', '225 g cheddar']);

  // 20. Pasted recipes: headings with more words, Markdown, "Step 3:" and "1.Boil".
  const pasted = parseRecipeText('## Pancakes\nIngrediënten voor 4 personen\n200 g bloem\n2 eieren\n**Method**\nStep 1: Mix.\n2.Bake well.');
  check('pasted recipe', pasted, { name: 'Pancakes', description: '', ingredients: ['200 g bloem', '2 eieren'], instructions: ['Mix.', 'Bake well.'] });
  check('heading suffixes', ['Ingredients for 2', 'Ingredients (serves 2)', 'Ingredients:'].map((line) => parseRecipeText(`Soup\n${line}\n1 onion\nMethod\nCook.`).ingredients), [['1 onion'], ['1 onion'], ['1 onion']]);
  check('amount stays', parseRecipeText('Soup\nIngredients\n1.5 kg potatoes').ingredients, ['1.5 kg potatoes']);

  // 19. A second import replaces the first one's photo, servings and description.
  openRecipeEditor(null, { importFirst: true });
  fillRecipeEditor({ name: 'A', description: 'First', servings: 4, ingredients: ['1 egg'], photo: 'https://example.com/a.jpg' }, '');
  fillRecipeEditor({ name: 'B', ingredients: ['2 eggs'] }, '');
  const editor = $('#recipe-edit-form').elements;
  check('second import', [editor.name.value, editor.description.value, editor.servings.value, editor.photo.value], ['B', '', '', '']);
  $('#recipe-edit-dialog').close();

  // 22. The converter shows less than ⅛ cup as such, and the glossary finds Dutch names in English.
  check('tiny cup', formatConverted(1 / 240, 'cup'), '<⅛');
  activeView = 'tools';
  toolsTab = 'terms';
  termsQuery = 'bedruipen';
  render();
  if (!/Baste/.test($('#terms-list').textContent)) fail.push('the glossary does not find "bedruipen" in English');
  termsQuery = '';

  // 23. The compact layout follows the zoomed width.
  for (const size of ['small', 'normal', 'large']) {
    applyTextSize(size);
    const want = window.innerWidth / TEXT_SIZES[size] <= 720;
    if (document.documentElement.classList.contains('compact-layout') !== want) fail.push(`compact layout at ${size} (${window.innerWidth} px): expected ${want}`);
  }
  applyTextSize(savedTextSize());

  // 24. Numbers on screen in the app's language; stored amounts stay plain numbers.
  check('english amounts', [amountText(1.5, 'kg'), amountText(3, 'pcs')], ['1.5 kg', '3 pcs']);
  await setLanguage('de');
  check('german amounts', [amountText(1.5, 'kg'), amountText(0.25, 'l'), amountText(3, 'pcs'), formatConverted(1.25, 'kg')], ['1,5 kg', '250 ml', `3 ${t('pcs')}`, '1,25']);
  check('german parse', parseAmount('1,5'), 1.5);
  await setLanguage('en');

  // 18. Use soon with 30 recipes and 80 items stays quick.
  const names = ingredientCatalog.slice(0, 60).map((entry) => [].concat(entry.en)[0]);
  state.inventory = Array.from({ length: 80 }, (_, index) => stock(`t${index}`, `${names[index % names.length]}${index >= names.length ? ` ${index}` : ''}`, 2, 'pcs', { expiresOn: dateKey(new Date(Date.now() + (index < 20 ? 1 : 30) * DAY_MS)), expirationSource: 'manual' }));
  state.recipes = Array.from({ length: 30 }, (_, recipe) => ({ id: `tr${recipe}`, name: `Recipe ${recipe}`, ingredients: Array.from({ length: 10 }, (_, line) => `200 g ${names[(recipe * 7 + line * 3) % names.length]}`), instructions: [] }));
  activeView = 'inventory';
  const started = performance.now();
  render();
  const drawn = Math.round(performance.now() - started);
  const input = $('#inventory-search');
  const typing = performance.now();
  for (const letter of 'ric') { input.value += letter; input.dispatchEvent(new Event('input', { bubbles: true })); }
  const perKey = Math.round((performance.now() - typing) / 3);
  log.push(`inventory with Use soon: ${drawn} ms, ${perKey} ms per keystroke`);
  if (drawn > 600 || perKey > 600) fail.push(`too slow: ${drawn} ms to draw, ${perKey} ms per keystroke`);
  inventoryQuery = '';
} catch (error) {
  fail.push(`threw: ${error.message}`);
} finally {
  localStorage.setItem('goodstock-units-v1', 'metric');
  for (const dialog of $$('dialog[open]')) dialog.close();
  state = normalizeState(JSON.parse(before));
  inventoryLocation = ALL_LOCATIONS;
  activeView = 'inventory';
  persist();
}
return { fail, log };
