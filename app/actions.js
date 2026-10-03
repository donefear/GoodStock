// Goodstock, part 5 of 5: shopping and putting groceries away, Mealie search, every button and form, Settings,
// backups, the test recipe, phone-app hooks, and starting the app (last line).
// The parts load in order as plain scripts (see index.html) and share one global scope.

function openPutawayDialog(item) {
  const form = $('#putaway-form');
  form.elements.shoppingId.value = item.id;
  form.elements.quantity.value = item.quantity || 1;
  form.elements.unit.value = item.unit || '';
  form.elements.expiresOn.value = '';
  form.elements.expiresOn.dataset.estimated = '';
  $('#putaway-item-name').textContent = item.name;
  fillLocationSelect(form.elements.location, state.locations[0]);
  updateExpirationSuggestion(item.name, form.elements.location.value, form.elements.expiresOn, $('#putaway-expiry-note'));
  $('#putaway-dialog').showModal();
}

async function searchMealie(query) {
  if (!mealieConfigured) return;
  try {
    const terms = query ? [query] : [...new Set(state.inventory
      .filter((item) => item.kind !== 'Household' && Number(item.quantity) > 0)
      .map((item) => item.name))].slice(0, 6);
    const resultSets = await Promise.all(terms.map((term) => mealieSearch(term).catch(() => [])));
    const unique = new Map(resultSets.flat().map((recipe) => [recipe.id || recipe.slug || recipe.name, recipe]));
    const details = await Promise.all([...unique.values()].slice(0, 20).map(async (recipe) => {
      if (recipe.ingredients?.length || !recipe.slug) return recipe;
      try {
        return await mealieRecipe(recipe.slug);
      } catch { return recipe; }
    }));
    mealieResults = details.map(metricRecipe).sort((first, second) => missingIngredients(first).length - missingIngredients(second).length);
  } catch {
    mealieResults = [];
  }
  if (activeView === 'recipes') render();
}

async function importMealieRecipe(id) {
  let recipe = mealieResults.find((entry) => entry.id === id || entry.slug === id);
  try {
    recipe = metricRecipe(await mealieRecipe(id));
  } catch { /* Keep search-result details when Mealie is temporarily unavailable. */ }
  if (!recipe) return;
  const exists = state.recipes.some((entry) => entry.id === recipe.id || entry.slug === recipe.slug);
  if (!exists) state.recipes.push({ ...recipe, ingredients: recipe.ingredients || [], source: 'Mealie' });
  persist();
  activeView = 'recipes';
  render();
}

function generateShopping() {
  const additions = [];
  for (const plan of currentWeekPlans()) {
    const recipe = scaledRecipe(recipeById(plan.recipeId), planScale(plan));
    if (!recipe || plan.cooked) continue;
    for (const ingredient of recipe.ingredients || []) {
      if (matchingInventory(ingredient)) continue;
      const parsed = parseIngredient(ingredient);
      const name = parsed.name.trim();
      const key = cleanIngredient(name);
      const alreadyListed = state.shopping.some((entry) => cleanIngredient(entry.name) === key);
      const inAdditions = additions.find((entry) => cleanIngredient(entry.name) === key);
      if (inAdditions && parsed.amount && canonicalUnit(inAdditions.unit) === parsed.unit) inAdditions.quantity = Math.round((inAdditions.quantity + parsed.amount) * 100) / 100;
      if (name && !alreadyListed && !inAdditions) additions.push({ id: makeId(), name, quantity: parsed.amount ? Math.round(parsed.amount * 100) / 100 : 1, unit: parsed.amount ? parsed.unitText : '', checked: false, source: recipe.name });
    }
  }
  state.shopping.push(...additions);
  persist();
  activeView = 'shopping';
  render();
}

async function openShoppingShare() {
  const dialog = $('#share-dialog');
  const status = $('#share-status');
  const image = $('#shopping-qr');
  const link = $('#share-download-link');
  shoppingShareUrl = '';
  image.hidden = true;
  link.hidden = true;
  status.textContent = t('Preparing your shopping list link…');
  dialog.showModal();
  try {
    const response = await fetch('/api/shopping/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: state.shopping }),
    });
    const result = await response.json();
    if (!response.ok) throw serverError(result, N_('Could not create the download link'));
    shoppingShareUrl = result.url;
    image.src = result.qrCode;
    image.hidden = false;
    link.href = result.url;
    link.hidden = false;
    status.textContent = t('Scan with your phone camera. The download link expires in 30 minutes.');
  } catch (error) {
    status.textContent = t('{reason}. Make sure the app is online and try again.', { reason: errorText(error, 'Could not create the download link').replace(/[.。]$/, '') });
  }
}

document.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    activeView = viewButton.dataset.view;
    render();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'inventory-mode') {
    inventoryMode = button.dataset.mode === 'map' ? 'map' : 'list';
    localStorage.setItem(INVENTORY_MODE_KEY, inventoryMode);
    render();
    return;
  }
  if (action === 'show-shopping-qr') openShoppingShare();
  if (action === 'share-shopping-text') shareShoppingText();
  if (action === 'backup-data') await backupKitchen();
  if (action === 'mealie-save') await saveMealieSettings();
  if (action === 'deepl-save') await saveDeeplSettings();
  if (action === 'deepl-help') $('#deepl-help-dialog').showModal();
  if (action === 'deepl-disconnect') await disconnectDeepl();
  if (action === 'translate-recipe') await startRecipeTranslation(id);
  if (action === 'translation-save') saveRecipeTranslation();
  if (action === 'translation-discard') { recipeTranslation = null; render(); }
  if (action === 'mealie-disconnect') await disconnectMealie();
  if (action === 'home-server-connect') await connectHomeServer();
  if (action === 'home-server-disconnect') disconnectHomeServer();
  if (action === 'scan-barcode') await scanBarcode();
  if (action === 'steps-read-aloud') toggleReadAloud();
  if (action === 'auto-backup-folder') await chooseAutoBackupFolder();
  if (action === 'auto-backup-off') turnOffAutoBackup();
  if (action === 'pin-save') await savePin();
  if (action === 'pin-remove') await removePin();
  if (action === 'steps-listen') toggleListening();
  if (action === 'open-settings') $('#settings-button').click();
  if (action === 'restore-data') $('#restore-file').click();
  if (action === 'view-recipe') {
    if (button.dataset.remote === 'true') openRecipeDialog(id, true);
    else openRecipePage(id);
  }
  if (action === 'back-to-recipes') { activeView = 'recipes'; render(); }
  if (action === 'tools-tab') {
    toolsTab = button.dataset.tab;
    try { localStorage.setItem(TOOLS_TAB_KEY, toolsTab); } catch { /* A per-browser convenience only. */ }
    render();
  }
  if (action === 'review-plan') {
    const plan = state.plan.find((entry) => entry.id === id);
    if (plan) openRecipeDialog(plan.recipeId, false, plan.id);
  }
  if (action === 'start-steps') {
    if (button.dataset.source === 'recipe-dialog') {
      $('#recipe-dialog').close();
      startCookSteps(recipeDialogRecipe, recipeDialogPlanId);
    } else {
      startCookSteps(recipeById(id), button.dataset.plan || '');
    }
  }
  if (action === 'steps-next') moveCookStep(1);
  if (action === 'steps-back') moveCookStep(-1);
  if (action === 'steps-restart') moveCookStep(-cookSession.index);
  if (action === 'steps-timer-start') startCookTimer(Number(button.dataset.minutes), button.dataset.label);
  if (action === 'timer-stop') stopCookTimer(button.dataset.timer);
  if (action === 'timer-open') openTimerStep(button.dataset.timer);
  if (action === 'timer-extend') extendTimer(button.dataset.timer);
  if (action === 'timer-preset') startCustomTimer(button.dataset.name, Number(button.dataset.seconds));
  if (action === 'timer-preset-remove') {
    state.timerPresets = (state.timerPresets || []).filter((preset) => preset.id !== button.dataset.id);
    persist();
  }
  if (action === 'timer-panel-toggle') { timerPanelOpen = !timerPanelOpen; refreshTimers(); }
  if (action === 'add-test-recipe') addTestRecipe();
  if (action === 'steps-review') {
    $('#steps-dialog').close();
    openCookDialog(state.plan.find((entry) => entry.id === id));
  }
  if (['plan-recipe', 'import-recipe'].includes(action) && button.closest('#recipe-dialog')) $('#recipe-dialog').close();
  if (action === 'show-expiring-recipe') {
    const recipe = recipeById(id);
    if (recipe) {
      activeView = 'recipes';
      recipeQuery = recipe.name;
      render();
    }
  }
  if (action === 'copy-shopping-link' && shoppingShareUrl) {
    try {
      await navigator.clipboard.writeText(shoppingShareUrl);
      $('#share-status').textContent = t('Download link copied. It expires in 30 minutes.');
    } catch {
      $('#share-status').textContent = t('Could not copy the link. Scan the QR code instead.');
    }
  }
  if (action === 'add-item') openItemDialog();
  if (action === 'edit-item') openItemDialog(state.inventory.find((item) => item.id === id));
  if (action === 'adjust') {
    const item = state.inventory.find((entry) => entry.id === id);
    if (item) { item.quantity = Math.max(0, Number(item.quantity) + Number(button.dataset.delta)); persist(); }
  }
  if (action === 'select-date') {
    const [year, month, day] = button.dataset.date.split('-').map(Number);
    selectedDate = new Date(year, month - 1, day);
    render();
  }
  if (action === 'previous-week' || action === 'next-week') {
    const direction = action === 'previous-week' ? -1 : 1;
    weekStart = dateAtOffset(direction * 7);
    selectedDate = new Date(weekStart);
    render();
  }
  if (action === 'go-today') {
    selectedDate = new Date();
    weekStart = startOfWeek(selectedDate);
    render();
  }
  if (action === 'scale-recipe') {
    const recipe = recipeById(id);
    if (recipe) {
      const next = nextScale(recipe, recipeScales.get(id) || 1, Number(button.dataset.step));
      if (Math.abs(next - 1) < 0.001) recipeScales.delete(id); else recipeScales.set(id, next);
      render();
    }
  }
  if (action === 'plan-recipe') {
    if (!currentWeekPlans().some((entry) => entry.date === dateKey(selectedDate) && entry.recipeId === id)) {
      const scale = recipeScales.get(id) || 1;
      state.plan.push({ id: makeId(), date: dateKey(selectedDate), recipeId: id, cooked: false, ...(scale !== 1 ? { scale } : {}) });
      persist();
    }
    activeView = 'week';
    render();
  }
  if (action === 'remove-plan') withUndo(t('Meal removed from the plan'), ['plan'], () => { state.plan = state.plan.filter((entry) => entry.id !== id); });
  if (action === 'undo') undoLastChange();
  if (action === 'cook') openCookDialog(state.plan.find((entry) => entry.id === id));
  if (action === 'generate-shopping') generateShopping();
  if (action === 'search-stocked') {
    recipeQuery = '';
    mealieResults = [];
    searchMealie('');
    render();
  }
  if (action === 'clear-checked') {
    const count = state.shopping.filter((entry) => entry.checked).length;
    withUndo(tp(count, '{count} checked item cleared', '{count} checked items cleared'), ['shopping'], () => { state.shopping = state.shopping.filter((entry) => !entry.checked); });
  }
  if (action === 'check-all') { for (const entry of state.shopping) entry.checked = true; persist(); }
  if (action === 'put-all-away') {
    const checked = state.shopping.filter((entry) => entry.checked);
    // Each goes to its usual spot with an estimated expiry date; they can be edited in Inventory afterwards.
    if (checked.length) {
      withUndo(tp(checked.length, '{count} item put away', '{count} items put away'), ['shopping', 'inventory'], () => {
        for (const entry of checked) {
          const location = defaultStorageLocation(entry.name);
          storeShoppingItem(entry, { quantity: Number(entry.quantity) || 1, unit: String(entry.unit || '').trim(), location, expiration: resolvedExpiration(entry.name, location, { value: '', dataset: {} }), packageDate: false });
        }
      });
    }
  }
  if (action === 'put-away') {
    const item = state.shopping.find((entry) => entry.id === id);
    if (item) openPutawayDialog(item);
  }
  if (action === 'import-recipe') await importMealieRecipe(id);
  if (action === 'new-recipe') openRecipeEditor();
  if (action === 'open-recipe-import') openRecipeEditor(null, { importFirst: true });
  if (action === 'edit-recipe') openRecipeEditor(recipeById(id));
  if (action === 'delete-recipe') deleteRecipe(id);
  if (action === 'recipe-import-url') await importRecipeFromUrl();
  if (action === 'recipe-import-text') {
    const parsed = parseRecipeText($('#recipe-edit-form').elements.importText.value);
    parsed.instructions = tidyImportedSteps(parsed.instructions);
    fillRecipeEditor(parsed, parsed.ingredients.length || parsed.instructions.length
      ? t('Found {ingredients} ingredients and {steps} steps. Check them, then save.', { ingredients: parsed.ingredients.length, steps: parsed.instructions.length })
      : t('Nothing recognisable in that text yet.'));
  }
  if (action === 'wipe-data') openWipeDialog();
  if (action === 'clear-list' && state.shopping.length) withUndo(t('Shopping list cleared'), ['shopping'], () => { state.shopping = []; });
});

document.addEventListener('input', (event) => {
  // Tools tab: update results in place so the field keeps focus while typing.
  if (event.target.id === 'conv-amount') { converterInput.amount = event.target.value; updateConverter(); return; }
  if (event.target.id === 'conv-unit') { converterInput.unit = event.target.value; updateConverter(); return; }
  if (event.target.id === 'conv-ingredient') { converterInput.ingredient = event.target.value; updateConverter(); return; }
  if (event.target.id === 'temp-value') { temperatureInput.value = event.target.value; updateTemperature(); return; }
  if (event.target.id === 'temp-unit') { temperatureInput.unit = event.target.value; updateTemperature(); return; }
  if (event.target.id === 'terms-search') { termsQuery = event.target.value; updateCookingTerms(); return; }
  if (event.target.id === 'inventory-search') {
    const cursor = event.target.selectionStart;
    inventoryQuery = event.target.value;
    render();
    const input = $('#inventory-search');
    input.focus();
    input.setSelectionRange(cursor, cursor);
  }
  if (event.target.id === 'recipe-search') recipeQuery = event.target.value;
  if (event.target.form?.getAttribute('id') === 'item-form' && event.target.name === 'name') {
    const form = event.target.form;
    updateExpirationSuggestion(form.elements.name.value, form.elements.location.value, form.elements.expiresOn, $('#expiry-estimate-note'));
  }
  if (event.target.name === 'expiresOn' && ['item-form', 'putaway-form'].includes(event.target.form?.getAttribute('id'))) {
    event.target.dataset.estimated = 'false';
    const noteId = event.target.form.getAttribute('id') === 'item-form' ? '#expiry-estimate-note' : '#putaway-expiry-note';
    $(noteId).textContent = event.target.value ? t('Using your chosen package date.') : t('Leaving blank will use an estimate for supported products.');
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.id === 'restore-file') {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await restoreKitchen(file);
    return;
  }
  if (event.target.id === 'location-filter') { inventoryLocation = event.target.value; render(); }
  if (event.target.form?.getAttribute('id') === 'item-form' && event.target.name === 'name' && BARCODE.test(event.target.value.trim())) {
    await fillFromBarcode(event.target.value.trim());
    return;
  }
  if (event.target.form?.getAttribute('id') === 'item-form' && event.target.name === 'location') {
    const form = event.target.form;
    updateExpirationSuggestion(form.elements.name.value, form.elements.location.value, form.elements.expiresOn, $('#expiry-estimate-note'));
  }
  if (event.target.form?.getAttribute('id') === 'putaway-form' && event.target.name === 'location') {
    const form = event.target.form;
    updateExpirationSuggestion($('#putaway-item-name').textContent, form.elements.location.value, form.elements.expiresOn, $('#putaway-expiry-note'));
  }
  if (event.target.id === 'week-date' && event.target.value) {
    const [year, month, day] = event.target.value.split('-').map(Number);
    selectedDate = new Date(year, month - 1, day);
    weekStart = startOfWeek(selectedDate);
    render();
  }
  if (event.target.id === 'language-select') { await changeLanguage(event.target.value); return; }
  if (event.target.id === 'text-size-select') {
    try { localStorage.setItem(TEXT_SIZE_KEY, event.target.value); } catch { /* For this visit only. */ }
    applyTextSize(event.target.value);
    return;
  }
  if (event.target.id === 'dark-mode-toggle') {
    const theme = event.target.checked ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  }
  if (event.target.id === 'expiry-notifications-toggle') {
    const toggle = event.target;
    const note = $('#expiry-notifications-note');
    if (!toggle.checked) {
      localStorage.removeItem(EXPIRY_REMINDERS_KEY);
      note.textContent = t('The in-app Use soon panel remains available.');
      scheduleExpiryReminders();
      return;
    }
    if (STANDALONE) {
      const allowed = await nativeCall('requestNotifications').then((result) => result === 'granted').catch(() => false);
      toggle.checked = allowed;
      if (allowed) localStorage.setItem(EXPIRY_REMINDERS_KEY, 'true'); else localStorage.removeItem(EXPIRY_REMINDERS_KEY);
      note.textContent = allowed ? t('Enabled. You get a notification at 9:00 on mornings when something is due soon.') : t("Notifications are off for Goodstock. Allow them in the phone's settings; the in-app panel remains available.");
      if (allowed) checkExpiryReminders(); else scheduleExpiryReminders();
      return;
    }
    if (!window.isSecureContext || !('Notification' in window)) {
      toggle.checked = false;
      note.textContent = t('System alerts need HTTPS and browser notification support. The in-app Use soon panel remains available.');
      return;
    }
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission === 'granted') {
        localStorage.setItem(EXPIRY_REMINDERS_KEY, 'true');
        note.textContent = t('Enabled. Goodstock checks for items due soon while the app is open.');
        checkExpiryReminders();
      } else {
        toggle.checked = false;
        localStorage.removeItem(EXPIRY_REMINDERS_KEY);
        note.textContent = t('Browser notifications are blocked. Allow them in browser settings; the in-app panel remains available.');
      }
    } catch {
      toggle.checked = false;
      localStorage.removeItem(EXPIRY_REMINDERS_KEY);
      note.textContent = t('Could not enable browser notifications. The in-app panel remains available.');
    }
  }
  if (event.target.matches('input[data-action="check-shopping"]')) {
    const item = state.shopping.find((entry) => entry.id === event.target.dataset.id);
    if (item) { item.checked = event.target.checked; persist(); }
  }
});

$('#item-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  const location = form.elements.location.value;
  const resolved = resolvedExpiration(name, location, form.elements.expiresOn);
  const expiration = form.elements.kind.value === 'Household' && resolved.expirationSource === 'estimated' ? { expiresOn: '', expirationSource: '' } : resolved;
  const item = metricInventoryItem({
    id: form.elements.id.value || makeId(),
    name,
    quantity: Number(form.elements.quantity.value),
    unit: form.elements.unit.value.trim(),
    ...expiration,
    location,
    kind: form.elements.kind.value,
  });
  const existingIndex = state.inventory.findIndex((entry) => entry.id === item.id);
  if (existingIndex < 0) state.inventory.unshift(item); else state.inventory[existingIndex] = item;
  persist();
  $('#item-dialog').close();
});

$('#cook-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const plan = state.plan.find((entry) => entry.id === form.elements.planId.value);
  const recipe = plan && recipeById(plan.recipeId);
  if (plan && recipe) {
    const usedIndices = new Set($$('#cook-ingredients input[name="ingredient"]:checked').map((input) => Number(input.value)));
    for (const index of usedIndices) {
      const item = matchingInventory(recipe.ingredients[index]);
      const used = Number(form.elements[`amount-${index}`]?.value);
      if (item && used > 0) item.quantity = Math.max(0, Math.round((Number(item.quantity) - used) * 100) / 100);
    }
    plan.cooked = true;
    persist();
  }
  $('#cook-dialog').close();
});

$('#putaway-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const shoppingItem = state.shopping.find((entry) => entry.id === form.elements.shoppingId.value);
  if (shoppingItem) {
    const location = form.elements.location.value;
    storeShoppingItem(shoppingItem, {
      quantity: Number(form.elements.quantity.value), unit: form.elements.unit.value.trim(), location,
      expiration: resolvedExpiration(shoppingItem.name, location, form.elements.expiresOn),
      packageDate: Boolean(form.elements.expiresOn.value) && form.elements.expiresOn.dataset.estimated !== 'true',
    });
    persist();
  }
  $('#putaway-dialog').close();
});

// Where a bought item usually lives: where it already is, else the fridge when it keeps longer there, else the pantry.
function defaultStorageLocation(name) {
  const existing = state.inventory.find((entry) => cleanIngredient(entry.name) === cleanIngredient(name));
  if (existing && state.locations.includes(existing.location)) return existing.location;
  const record = ingredientRecord(name);
  const shelfLife = record?.shelfLifeDays || CATEGORY_SHELF_LIFE_DAYS[record?.category] || {};
  const pattern = (shelfLife.fridge ?? 0) > (shelfLife.pantry ?? 0) ? FRIDGE_WORDS : PANTRY_WORDS;
  return state.locations.find((location) => pattern.test(location)) || state.locations[0];
}

function storeShoppingItem(shoppingItem, { quantity, unit, location, expiration, packageDate }) {
  const bought = metricInventoryItem({ quantity, unit });
  const existing = state.inventory.find((entry) => cleanIngredient(entry.name) === cleanIngredient(shoppingItem.name));
  if (existing) {
    const added = deductionAmount(`${bought.quantity} ${bought.unit}`.trim(), existing) || bought.quantity;
    existing.quantity = Math.round((Number(existing.quantity) + added) * 100) / 100;
    if (packageDate) Object.assign(existing, expiration);
    else if (!existing.expiresOn && expiration.expiresOn) Object.assign(existing, expiration);
  } else {
    state.inventory.unshift({ id: makeId(), name: shoppingItem.name, quantity: bought.quantity, unit: bought.unit, ...expiration, location, kind: 'Food' });
  }
  state.shopping = state.shopping.filter((entry) => entry.id !== shoppingItem.id);
}

// A throwaway recipe that exercises cook mode: headings, short timers, °F and imperial amounts, tools and amounts in steps.
// Each click shuffles in a different mix of extra steps, then plans it for today.
const TEST_RECIPE_ID = 'goodstock-test';
const TEST_RECIPE_EXTRAS = [
  { ingredient: '8 oz cheddar', step: 'Grate the cheddar on a box grater.' },
  { ingredient: '1 lb potatoes', step: 'Peel the potatoes, then cut them into chunks with a sharp knife.' },
  { ingredient: '2 cups milk', step: 'Warm the milk in a saucepan for 20 seconds.' },
  { ingredient: '1 pint cream', step: 'Blend the cream with a stick blender until smooth.' },
  { ingredient: '3 tablespoon olive oil', step: 'Heat the olive oil in a large skillet.' },
  { ingredient: '200 g pasta', step: 'Boil the pasta in a large pot for 1 minute, then drain in a colander.' },
  { ingredient: '1 banana', step: 'Mash the banana with a fork in a mixing bowl.' },
  { ingredient: '2 fl oz lemon juice', step: 'Add the lemon juice, cover with a lid and wait 10 seconds.' },
  { ingredient: '1 onion', step: 'Chop the onion on a cutting board.' },
  { ingredient: '100 g rolled oats', step: 'Sift the rolled oats through a sieve.' },
  { ingredient: '1/2 tsp salt', step: 'Weigh everything on the kitchen scale, then add the salt.' },
  { ingredient: '250 ml vegetable stock', step: 'Heat the vegetable stock in the microwave for 30 seconds, then ladle it over.' },
];

function addTestRecipe() {
  const extras = [...TEST_RECIPE_EXTRAS].sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 3));
  const recipe = {
    id: TEST_RECIPE_ID,
    name: `Test kitchen #${Math.floor(Math.random() * 900) + 100}`,
    description: 'A random test recipe for trying out step-by-step cook mode.',
    source: 'Goodstock test',
    ingredients: ['2 eggs', ...extras.map((extra) => extra.ingredient)],
    instructions: [
      'Warm up',
      'Crack the eggs into a bowl and whisk them for 15 seconds.',
      ...extras.map((extra) => extra.step),
      'Into the oven',
      'Spread everything on a baking tray lined with baking paper.',
      'Bake in the oven at 350°F for 1 minute.',
      'Flip everything with a spatula and let it rest for 15 seconds.',
    ],
  };
  state.recipes = [metricRecipe(recipe), ...state.recipes.filter((entry) => entry.id !== TEST_RECIPE_ID)];
  state.plan = state.plan.filter((entry) => entry.recipeId !== TEST_RECIPE_ID || entry.cooked);
  state.plan.push({ id: makeId(), date: dateKey(new Date()), recipeId: TEST_RECIPE_ID, cooked: false });
  const progress = readCookProgress();
  delete progress[TEST_RECIPE_ID];
  try { localStorage.setItem(COOK_PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Progress is a convenience only. */ }
  persist();
  $('#settings-dialog').close();
  selectedDate = new Date();
  weekStart = startOfWeek(selectedDate);
  activeView = 'week';
  render();
}

// Backup: the whole kitchen (inventory, recipes, plans, shopping list, presets) as one JSON file. In the Android
// app the data exists only on the phone, so this is how it survives a new phone or an uninstall.
const backupContent = () => JSON.stringify({ app: 'goodstock', backupVersion: 1, exportedAt: new Date().toISOString(), state }, null, 2);

// Automatic weekly backups (phone apps): a folder chosen once, then a backup there whenever the app is opened and
// the last one is a week old. The phone keeps writing access to that folder; the newest four are kept.
const AUTO_BACKUP_KEY = 'goodstock-auto-backup-v1';
const AUTO_BACKUP_DAYS = 7;
const canAutoBackup = () => STANDALONE && Boolean(nativeApp.canAutoBackup && nativeApp.canAutoBackup());

function autoBackupSettings() {
  try { return JSON.parse(localStorage.getItem(AUTO_BACKUP_KEY) || 'null'); } catch { return null; }
}

function fillAutoBackup() {
  const zone = $('#auto-backup-zone');
  zone.hidden = !canAutoBackup();
  if (zone.hidden) return;
  const settings = autoBackupSettings();
  $('#auto-backup-off').hidden = !settings;
  $('#auto-backup-folder').textContent = settings ? t('Change folder') : t('Choose folder');
  $('#auto-backup-text').textContent = settings
    ? (settings.last
      ? t('Weekly to “{folder}”. Last backup: {date}.', { folder: settings.folder, date: formatDate(new Date(settings.last), { day: 'numeric', month: 'short', year: 'numeric' }) })
      : t('Weekly to “{folder}”. The first backup is made now.', { folder: settings.folder }))
    : t('Once a week, a backup goes to a folder you choose (for example in Google Drive or iCloud Drive). The newest four are kept.');
}

async function chooseAutoBackupFolder() {
  try {
    const folder = await nativeCall('chooseBackupFolder');
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({ folder, last: null }));
    await runAutoBackup(true);
  } catch (error) {
    if (error?.message !== 'cancelled') $('#backup-status').textContent = t('That folder cannot be used. Choose another one.');
  }
  fillAutoBackup();
}

function turnOffAutoBackup() {
  try { nativeApp.forgetBackupFolder(); } catch { /* Nothing kept. */ }
  localStorage.removeItem(AUTO_BACKUP_KEY);
  fillAutoBackup();
}

let autoBackupRunning = false;
async function runAutoBackup(force = false) {
  const settings = canAutoBackup() && autoBackupSettings();
  if (!settings || autoBackupRunning) return;
  if (!force && settings.last && Date.now() - new Date(settings.last).getTime() < AUTO_BACKUP_DAYS * DAY_MS) return;
  autoBackupRunning = true;
  try {
    await nativeCall('writeBackup', `goodstock-auto-backup-${dateKey(new Date())}.json`, backupContent());
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({ ...settings, last: new Date().toISOString(), error: '' }));
  } catch (error) {
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({ ...settings, error: String(error?.message || 'failed') }));
  } finally {
    autoBackupRunning = false;
  }
  if ($('#settings-dialog').open) fillAutoBackup();
}

async function backupKitchen() {
  const fileName = `goodstock-backup-${dateKey(new Date())}.json`;
  const content = backupContent();
  const status = $('#backup-status');
  try {
    if (STANDALONE) {
      await nativeCall('saveFile', fileName, content);
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    }
    status.textContent = t('Saved {file}.', { file: fileName });
  } catch (error) {
    status.textContent = error?.message === 'cancelled' ? '' : t('The backup could not be saved.');
  }
}

async function restoreKitchen(file) {
  const status = $('#backup-status');
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { status.textContent = t('That file is not a Goodstock backup.'); return; }
  const restored = parsed?.state || parsed;
  if (!restored || !Array.isArray(restored.inventory) || !Array.isArray(restored.recipes)) { status.textContent = t('That file is not a Goodstock backup.'); return; }
  const summary = t('{items} inventory items and {recipes} recipes', { items: restored.inventory.length, recipes: restored.recipes.length });
  if (!window.confirm(t('Replace everything in this kitchen with the backup ({summary})? This cannot be undone.', { summary }))) return;
  state = normalizeState(restored);
  persist();
  status.textContent = t('Restored {summary}.', { summary });
}

function openWipeDialog() {
  const count = (list, text) => `<li><strong>${list.length}</strong> ${text}</li>`;
  $('#wipe-summary').innerHTML = count(state.inventory, tp(state.inventory.length, 'inventory item', 'inventory items'))
    + count(state.recipes, tp(state.recipes.length, 'saved recipe', 'saved recipes'))
    + count(state.plan, tp(state.plan.length, 'planned meal', 'planned meals'))
    + count(state.shopping, tp(state.shopping.length, 'shopping-list item', 'shopping-list items'));
  const form = $('#wipe-form');
  form.reset();
  form.querySelector('[type="submit"]').disabled = true;
  $('#wipe-dialog').showModal();
  form.elements.confirmation.focus();
}

$('#wipe-form').addEventListener('input', (event) => {
  const form = event.currentTarget;
  form.querySelector('[type="submit"]').disabled = form.elements.confirmation.value.trim().toUpperCase() !== 'WIPE';
});

$('#wipe-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.currentTarget.elements.confirmation.value.trim().toUpperCase() !== 'WIPE') return;
  $('#wipe-dialog').close();
  $('#settings-dialog').close();
  state = { inventory: [], recipes: [], plan: [], shopping: [], locations: localDefaultLocations(), timerPresets: [] };
  activeView = 'inventory';
  inventoryQuery = '';
  inventoryLocation = 'All locations';
  recipeQuery = '';
  mealieResults = [];
  persist();
});

$('#settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const locations = event.currentTarget.elements.locations.value.split(',').map((value) => value.trim()).filter(Boolean);
  if (locations.length) {
    state.locations = [...new Set(locations)];
    for (const item of state.inventory) if (!state.locations.includes(item.location)) item.location = state.locations[0];
    persist();
  }
  $('#settings-dialog').close();
});

$('#pin-form').addEventListener('submit', (event) => {
  event.preventDefault();
  unlockWithPin(event.currentTarget.elements.pin.value);
});
$('#pin-dialog').addEventListener('close', () => { pinPrompted = false; });

document.addEventListener('submit', (event) => {
  // Read the id attribute: a field named "id" or "name" inside a form shadows form.id in real browsers.
  const formId = event.target.getAttribute('id');
  if (formId === 'recipe-edit-form') {
    event.preventDefault();
    saveRecipeFromEditor(event.target);
    return;
  }
  if (formId === 'custom-timer-form') {
    event.preventDefault();
    const form = event.target;
    const name = form.elements.name.value.trim();
    const seconds = Math.max(0, Number(form.elements.minutes.value) || 0) * 60 + Math.max(0, Number(form.elements.seconds.value) || 0);
    if (!seconds) { form.elements.minutes.focus(); return; }
    if (form.elements.save.checked) {
      state.timerPresets = [...(state.timerPresets || []), { id: makeId(), name: name || formatDuration(seconds), seconds, icon: '⏱' }];
      persist();
    }
    startCustomTimer(name || formatDuration(seconds), seconds);
    return;
  }
  if (formId !== 'recipe-search-form') return;
  event.preventDefault();
  recipeQuery = $('#recipe-search').value.trim();
  searchMealie(recipeQuery);
  render();
});

$('#settings-button').addEventListener('click', async () => {
  $('#settings-form').elements.locations.value = state.locations.join(', ');
  $('#dark-mode-toggle').checked = document.documentElement.dataset.theme === 'dark';
  fillLanguageSelect();
  $('#settings-dialog').showModal();
  await fillSettings();
});

// The parts of Settings that depend on this device and on the connections, in the chosen language.
async function fillSettings() {
  const expiryToggle = $('#expiry-notifications-toggle');
  const expiryNote = $('#expiry-notifications-note');
  const canNotify = STANDALONE || (window.isSecureContext && 'Notification' in window);
  expiryToggle.disabled = !canNotify;
  expiryToggle.checked = canNotify && localStorage.getItem(EXPIRY_REMINDERS_KEY) === 'true' && (STANDALONE ? nativeApp.notificationsAllowed() : Notification.permission === 'granted');
  if (STANDALONE) expiryNote.textContent = t('A phone notification every morning at 9:00 for items due within 3 days, also when the app is closed. The in-app Use soon panel is always available.');
  else if (!window.isSecureContext) expiryNote.textContent = t('System alerts need HTTPS. The in-app Use soon panel remains available.');
  else if (!('Notification' in window)) expiryNote.textContent = t('This browser does not support system alerts. The in-app Use soon panel remains available.');
  else if (Notification.permission === 'denied') expiryNote.textContent = t('Browser notifications are blocked. Allow them in browser settings; the in-app panel remains available.');
  else expiryNote.textContent = t('System alerts are checked daily while the app is open. The in-app Use soon panel is always available.');
  fillSettingsMode();
  fillHomeServerSettings();
  fillAutoBackup();
  await Promise.all([loadMealieSettings(), loadDeeplSettings(), fillPinSettings()]);
}

function fillSettingsMode() {
  const phoneShared = STANDALONE && homeServer();
  $('#settings-mode-title').textContent = STANDALONE && !phoneShared ? t('Kept on this device') : t('Shared kitchen');
  $('#settings-mode-text').textContent = phoneShared
    ? t('This phone shares the kitchen on your home server and keeps a copy, so it also works when you are out.')
    : STANDALONE
      ? t('The phone app keeps everything on this device and works without a server. Use Back up below to save a copy.')
      : liveSync.connected
        ? tp(liveSync.devices, 'Everyone who opens Goodstock on this server sees the same kitchen, updated live ({count} device connected now).', 'Everyone who opens Goodstock on this server sees the same kitchen, updated live ({count} devices connected now).')
        : t('Everyone who opens Goodstock on this server sees the same kitchen, updated live.');
}

function setMealieNote(text, kind = '') {
  const note = $('#mealie-note');
  note.textContent = text;
  note.className = `settings-note${kind ? ` is-${kind}` : ''}`;
}

async function loadMealieSettings() {
  const form = $('#settings-form');
  form.elements.mealieKey.value = '';
  if (STANDALONE) {
    const config = phoneMealie();
    mealieConfigured = Boolean(config);
    form.elements.mealieUrl.value = config?.url || '';
    form.elements.mealiePublicUrl.value = config?.publicUrl || '';
    form.elements.mealieKey.placeholder = config ? t('Saved. Leave empty to keep it.') : t('Paste a Mealie API token');
    $('#mealie-disconnect').hidden = !config;
    setMealieNote(config ? t('Connected to {url}.', { url: config.url }) : t('Not connected. Recipes added with New recipe or Import work without it.'), config ? 'connected' : '');
    return;
  }
  try {
    const status = await (await fetch('/api/mealie/status')).json();
    mealieConfigured = Boolean(status.configured);
    form.elements.mealieUrl.value = status.url || '';
    form.elements.mealiePublicUrl.value = status.publicUrl || '';
    form.elements.mealieKey.placeholder = status.configured ? t('Saved. Leave empty to keep it.') : t('Paste a Mealie API token');
    $('#mealie-disconnect').hidden = status.source !== 'settings';
    setMealieNote(status.configured
      ? (status.source === 'environment' ? t('Connected to {url} (set in Portainer).', { url: status.url }) : t('Connected to {url}.', { url: status.url }))
      : t('Not connected yet.'), status.configured ? 'connected' : '');
  } catch {
    setMealieNote(t('Mealie status is unavailable while offline.'));
  }
}

// Tests the connection first and only saves it when Mealie accepts the key. An address typed without http:// or
// https:// tries https first, then http, which is what most home servers use.
async function saveMealieSettings() {
  const form = $('#settings-form');
  const typed = form.elements.mealieUrl.value.trim();
  if (typed && !/^https?:\/\//i.test(typed)) {
    const unreachable = await connectMealie(`https://${typed}`);
    if (unreachable) await connectMealie(`http://${typed}`);
    return;
  }
  await connectMealie(typed);
}

async function connectMealie(address) {
  const form = $('#settings-form');
  const { normalizeMealieUrl } = window.GoodstockMealie;
  const url = normalizeMealieUrl(address);
  const apiKey = form.elements.mealieKey.value.trim();
  const publicUrl = normalizeMealieUrl(form.elements.mealiePublicUrl.value);
  setMealieNote(t('Testing the connection…'));
  try {
    let user = '';
    if (STANDALONE) {
      if (!url) throw new Error(t('Enter the address of your Mealie server.'));
      const current = phoneMealie();
      // A new address needs the key typed again, so a saved key is never sent to a different server.
      const key = apiKey || (current?.url === url ? current.apiKey : '');
      if (!key) throw new Error(t('Enter a Mealie API key. You can create one in Mealie under your profile → API Tokens.'));
      const config = { url, apiKey: key, publicUrl };
      const self = await phoneMealieGet('/users/self', config);
      user = self?.fullName || self?.username || '';
      config.groupSlug = await phoneMealieGet('/groups/self', config).then((group) => group?.slug || '').catch(() => '');
      localStorage.setItem(MEALIE_PHONE_KEY, JSON.stringify(config));
    } else {
      const response = await fetch('/api/mealie/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, apiKey, publicUrl }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(serverError(result, N_('Could not connect to Mealie.')), { unreachable: /Could not reach/.test(result.error || '') });
      user = result.user || '';
    }
    await loadMealieSettings();
    setMealieNote(user ? t('Connected to {url} as {user}.', { url, user }) : t('Connected to {url}.', { url }), 'connected');
    mealieResults = [];
    render();
    return false;
  } catch (error) {
    setMealieNote(errorText(error, 'Could not connect to Mealie.'), 'error');
    // Tells saveMealieSettings to try plain http when https could not reach the server at all.
    return Boolean(error?.unreachable);
  }
}

async function disconnectMealie() {
  if (!window.confirm(t('Disconnect Mealie? Recipes you already added to your library stay.'))) return;
  if (STANDALONE) localStorage.removeItem(MEALIE_PHONE_KEY);
  else await fetch('/api/mealie/config', { method: 'DELETE' }).catch(() => {});
  mealieResults = [];
  await loadMealieSettings();
  render();
}

document.addEventListener('click', (event) => {
  if (event.target.matches('[data-close]')) event.target.closest('dialog').close();
});

$('#steps-body').addEventListener('change', (event) => {
  const key = event.target.dataset.stepsItem;
  if (!key || !cookSession) return;
  if (event.target.checked) cookSession.checked.add(key); else cookSession.checked.delete(key);
});

// Enter in a Mealie field tests and saves the connection instead of closing Settings.
$('#settings-form').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && /^mealie/.test(event.target.name || '')) {
    event.preventDefault();
    saveMealieSettings();
  }
  if (event.key === 'Enter' && event.target.name === 'homeServer') {
    event.preventDefault();
    connectHomeServer();
  }
  if (event.key === 'Enter' && event.target.name === 'deeplKey') {
    event.preventDefault();
    saveDeeplSettings();
  }
});

$('#recipe-edit-form').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.name === 'importUrl') {
    event.preventDefault();
    importRecipeFromUrl();
  }
});

$('#steps-dialog').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') { event.preventDefault(); moveCookStep(1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); moveCookStep(-1); }
});

$('#steps-dialog').addEventListener('close', () => {
  stopSpeaking();
  toggleListening(false);
  saveCookProgress();
  keepScreenOn(false);
  refreshTimers();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkExpiryReminders();
});
window.addEventListener('focus', checkExpiryReminders);
window.addEventListener('online', () => { pushPendingState(); pullRemoteKitchen(); render(); });
// Keep timers in step across tabs of this browser.
window.addEventListener('storage', (event) => { if (event.key === TIMERS_KEY) loadTimers(); });

// Android app hooks. Back closes the top dialog, then returns to Inventory, then leaves the app.
window.goodstockBack = () => {
  const open = $$('dialog[open]');
  if (open.length) { open[open.length - 1].close(); return true; }
  if (activeView === 'recipe') { activeView = 'recipes'; render(); return true; }
  if (activeView !== 'inventory') { activeView = 'inventory'; render(); return true; }
  return false;
};
// Coming back to the app: catch up on timers that ended while it was paused, and on expiry reminders.
window.goodstockResume = () => {
  checkRemoteRevision();
  runAutoBackup();
  refreshTimers();
  checkExpiryReminders();
};
// Browsers only allow sound after a tap, so the first touch after a reload unlocks the alarm.
document.addEventListener('pointerdown', unlockAlarmAudio, { once: true, capture: true });
window.addEventListener('offline', () => { updateSyncStatus('offline'); render(); });

initialize();
