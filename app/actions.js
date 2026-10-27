// Goodstock, part 6 of 6: shopping and putting groceries away, Mealie search, every button and form, Settings,
// backups, the test recipe, phone-app hooks, and starting the app (last line).
// The parts load in order as plain scripts (see index.html) and share one global scope.

function openPutawayDialog(item) {
  const form = $('#putaway-form');
  form.elements.shoppingId.value = item.id;
  fillAmountFields(form, item.quantity || 1, item.unit || 'pcs');
  form.elements.expiresOn.value = '';
  form.elements.expiresOn.dataset.estimated = '';
  form.elements.barcode.value = '';
  form.elements.estimateName.value = '';
  $('#putaway-scan-button').hidden = !canScanBarcodes();
  $('#putaway-barcode-status').textContent = '';
  $('#putaway-item-name').textContent = item.name;
  fillLocationSelect(form.elements.location, state.locations[0]);
  updateExpirationSuggestion(item.name, form.elements.location.value, form.elements.expiresOn, $('#putaway-expiry-note'));
  const amount = readAmountFields(form);
  form.elements.price.value = priceOf(item.name, amount.quantity, amount.unit) ?? '';
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

// The week's meals that aren't cooked yet.
const weekMeals = () => currentWeekPlans().filter((plan) => !plan.cooked).map((plan) => ({ recipe: recipeById(plan.recipeId), scale: planScale(plan) }));

// Meals ({ recipe, scale }) added up per ingredient and compared with what is in stock: only what is short goes on
// the list ("Flour 400 g · Pancakes, Bread"). Lines for the same ingredient become one ("2 potatoes" and "1 potato"
// make 3), in the first line's unit when the units measure the same thing; an amount that can't be added to it
// ("500 g" against "2") gets a line of its own. An ingredient in stock whose amounts can't be compared with the stored
// unit ("1 bunch" against "200 g") counts as enough, as before. With fromStock false, stock is left out of it. Small
// kilos and litres become grams and millilitres.
function shoppingNeeds(meals = weekMeals(), { fromStock = true } = {}) {
  const needs = new Map();
  for (const meal of meals) {
    const recipe = scaledRecipe(meal.recipe, meal.scale);
    if (!recipe) continue;
    for (const ingredient of recipe.ingredients || []) {
      const parsed = parseIngredient(ingredient);
      const name = parsed.name.trim();
      if (!name) continue;
      const item = fromStock ? matchingInventory(ingredient) : undefined;
      const key = item ? `item:${item.id}` : shoppingKey(name);
      const need = needs.get(key) || { name: item ? item.name : name, item, amount: 0, unit: item ? item.unit || '' : '', comparable: true, sources: [], more: [] };
      if (!need.sources.includes(recipe.name)) need.sources.push(recipe.name);
      if (item) {
        const used = deductionAmount(ingredient, item);
        if (used > 0) need.amount += used; else need.comparable = false;
      } else if (!needs.has(key)) {
        need.amount = parsed.amount || 1;
        need.unit = parsed.amount ? parsed.unitText : '';
      } else if (parsed.amount) {
        const part = [need, ...need.more].find((entry) => amountIn(parsed.amount, parsed.unitText, entry.unit) !== null);
        if (part) part.amount += amountIn(parsed.amount, parsed.unitText, part.unit);
        else need.more.push({ amount: parsed.amount, unit: parsed.unitText });
      }
      needs.set(key, need);
    }
  }
  const short = [];
  for (const need of needs.values()) {
    for (const part of need.item ? [need] : [need, ...need.more]) {
      let amount = need.item ? need.amount - Number(need.item.quantity) : part.amount;
      if (need.item && (!need.comparable || amount <= 0)) continue;
      let unit = part.unit;
      const canonical = canonicalUnit(unit);
      if ((canonical === 'kg' || canonical === 'l') && amount < 1) { amount *= 1000; unit = canonical === 'kg' ? 'g' : 'ml'; }
      short.push({ name: need.name, quantity: Math.round(amount * 100) / 100, unit, source: need.sources.join(', ') });
    }
  }
  return short;
}

// Puts lines on the shopping list. With combine, a line for the same ingredient that isn't ticked yet takes the
// amount and the recipe names ("Potatoes 3 · Soup, Stew"); without it (Refresh from plan) an ingredient already on
// the list is left as it is, so refreshing twice doesn't double it. Returns how many lines were added or grew.
function addToShoppingList(lines, { combine = false } = {}) {
  let changed = 0;
  for (const line of lines) {
    const key = shoppingKey(line.name);
    const same = state.shopping.filter((entry) => shoppingKey(entry.name) === key);
    if (!combine && same.length) continue;
    const target = combine && same.find((entry) => !entry.checked && amountIn(Number(line.quantity) || 0, line.unit, entry.unit) !== null);
    if (target) {
      target.quantity = Math.round(((Number(target.quantity) || 0) + amountIn(Number(line.quantity) || 0, line.unit, target.unit)) * 100) / 100 || '';
      const sources = String(target.source || '').split(', ').filter(Boolean);
      for (const source of String(line.source || '').split(', ')) if (source && !sources.includes(source)) sources.push(source);
      target.source = sources.join(', ');
    } else {
      state.shopping.push({ id: makeId(), ...line, checked: false });
    }
    changed += 1;
  }
  return changed;
}

// The stocktake's buttons (renderStocktake in app/views.js).
function stocktakeAction(step, id, button) {
  if (step === 'pick') stocktake = { picking: true };
  if (step === 'close') stocktake = null;
  if (step === 'start') stocktake = { location: button.dataset.location, seen: [], asking: '' };
  if (!stocktake || !stocktake.location) return render();
  if (step === 'ok' && !stocktake.seen.includes(id)) stocktake.seen.push(id);
  if (step === 'gone') stocktake.asking = id;
  if (step === 'gone-cancel') stocktake.asking = '';
  if (step === 'used' || step === 'wasted') {
    stocktake.asking = '';
    removeInventoryItem(id, step);
  }
  if (step === 'done') {
    const location = stocktake.location;
    state.checks = [...(state.checks || []).filter((entry) => entry.id !== location), { id: location, date: dateKey(new Date()) }];
    stocktake = null;
    persist();
  }
  render();
}

// "Moved to the fridge" (Take out of the freezer): the item goes to the fridge and, thawed, keeps about two days there.
const THAWED_DAYS = 2;
function thawItem(id) {
  const item = state.inventory.find((entry) => entry.id === id);
  if (!item) return;
  withUndo(t('{name} moved to the fridge', { name: item.name }), ['inventory', 'locations'], () => {
    let fridge = state.locations.find((place) => FRIDGE_WORDS.test(place));
    if (!fridge) { fridge = 'Fridge'; state.locations.push(fridge); }
    const thawed = new Date();
    thawed.setDate(thawed.getDate() + THAWED_DAYS);
    item.location = fridge;
    delete item.frozenOn;
    item.expiresOn = dateKey(thawed);
    item.expirationSource = 'estimated';
  });
  render();
}

function generateShopping() {
  addToShoppingList(shoppingNeeds());
  persist();
  activeView = 'shopping';
  render();
}

// Shopping → From recipes: tick recipes (with servings) and their ingredients go on the list, added to what is
// already there. Picks are { recipe id: factor } and stay while the search changes.
let recipeShoppingPicks = new Map();

function openRecipeShopping() {
  recipeShoppingPicks = new Map();
  $('#recipe-shopping-search').value = '';
  renderRecipeShopping();
  $('#recipe-shopping-dialog').showModal();
}

function renderRecipeShopping() {
  const query = cleanIngredient($('#recipe-shopping-search').value);
  const recipes = [...state.recipes]
    .sort((a, b) => Number(Boolean(b.favourite)) - Number(Boolean(a.favourite)) || String(a.name).localeCompare(String(b.name)))
    .filter((recipe) => !query || cleanIngredient(recipe.name).includes(query));
  const row = (recipe) => {
    const factor = recipeShoppingPicks.get(recipe.id);
    const picked = factor !== undefined;
    const amount = recipe.servings
      ? `<label class="recipe-shopping-amount"><input type="number" inputmode="numeric" min="1" step="1" data-shop-servings="${escapeHtml(recipe.id)}" value="${escapeHtml(String(Math.max(1, Math.round(recipe.servings * (factor || 1)))))}" aria-label="${escapeHtml(t('Servings'))}" ${picked ? '' : 'disabled'} /> <span>${escapeHtml(t('Servings'))}</span></label>`
      : `<label class="recipe-shopping-amount"><span>×</span> <input type="number" inputmode="decimal" min="0.5" step="0.5" data-shop-factor="${escapeHtml(recipe.id)}" value="${escapeHtml(String(factor || 1))}" aria-label="${escapeHtml(t('Times the recipe'))}" ${picked ? '' : 'disabled'} /></label>`;
    return `<div class="recipe-shopping-row${picked ? ' is-picked' : ''}"><label class="recipe-shopping-pick"><input type="checkbox" data-shop-recipe="${escapeHtml(recipe.id)}" ${picked ? 'checked' : ''} /><span class="custom-check" aria-hidden="true"></span><span>${escapeHtml(recipe.name)}</span></label>${amount}</div>`;
  };
  $('#recipe-shopping-list').innerHTML = recipes.length
    ? recipes.map(row).join('')
    : `<p class="muted">${escapeHtml(state.recipes.length ? t('No recipes match that search.') : t('No recipes yet. Add one on the Recipes page.'))}</p>`;
  const count = recipeShoppingPicks.size;
  const button = $('#recipe-shopping-add');
  button.disabled = !count;
  button.textContent = count ? tp(count, 'Add {count} recipe to the list', 'Add {count} recipes to the list') : t('Add to the shopping list');
}

function updateRecipeShoppingPick(input) {
  const id = input.dataset.shopRecipe || input.dataset.shopServings || input.dataset.shopFactor;
  const recipe = recipeById(id);
  if (!recipe) return;
  if (input.dataset.shopRecipe) {
    if (input.checked) recipeShoppingPicks.set(recipe.id, 1); else recipeShoppingPicks.delete(recipe.id);
    return renderRecipeShopping();
  }
  const value = Number(input.value);
  if (!(value > 0) || !recipeShoppingPicks.has(recipe.id)) return;
  recipeShoppingPicks.set(recipe.id, input.dataset.shopServings ? value / recipe.servings : value);
}

function addRecipesToShopping() {
  const meals = [...recipeShoppingPicks].map(([id, scale]) => ({ recipe: recipeById(id), scale })).filter((meal) => meal.recipe);
  if (!meals.length) return;
  const lines = shoppingNeeds(meals, { fromStock: $('#recipe-shopping-stock').checked });
  $('#recipe-shopping-dialog').close();
  activeView = 'shopping';
  if (!lines.length) {
    withUndo(t('Everything for these recipes is in stock.'), ['shopping'], () => {});
    return render();
  }
  withUndo(tp(meals.length, '{count} recipe added to the shopping list', '{count} recipes added to the shopping list'), ['shopping'], () => addToShoppingList(lines, { combine: true }));
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
      body: JSON.stringify({ items: groupedShoppingItems(state.shopping), title: t('Shopping list') }),
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
  if (action === 'print') printPage();
  if (action === 'share-shopping-text') shareShoppingText();
  if (action === 'backup-data') await backupKitchen();
  if (action === 'mealie-save') await saveMealieSettings();
  if (action === 'deepl-save') await saveDeeplSettings();
  if (action === 'deepl-help') $('#deepl-help-dialog').showModal();
  if (action === 'deepl-disconnect') await disconnectDeepl();
  if (action === 'translate-choose') chooseRecipeTranslation(id);
  if (action === 'thaw-item') thawItem(id);
  if (action === 'share-recipe') { recipeSharing = { recipeId: id, status: '' }; render(); }
  if (action === 'share-recipe-text') await shareRecipe(id, 'text');
  if (action === 'share-recipe-file') await shareRecipe(id, 'file');
  if (action === 'share-recipe-close') { recipeSharing = null; render(); }
  if (action === 'shelf-life-use') { answerShelfLife(id, Number(button.dataset.days)); render(); }
  if (action === 'shelf-life-keep') { answerShelfLife(id, 0); render(); }
  if (action.indexOf('stocktake-') === 0) stocktakeAction(action.slice(10), id, button);
  if (action === 'translate-recipe') await startRecipeTranslation(id, ($('#translation-target') || {}).value || recipeTranslation?.target);
  if (action === 'translation-save') saveRecipeTranslation();
  if (action === 'translation-discard') { recipeTranslation = null; render(); }
  if (action === 'mealie-disconnect') await disconnectMealie();
  if (action === 'home-server-connect') await connectHomeServer();
  if (action === 'home-server-disconnect') disconnectHomeServer();
  if (action === 'sync-folder-choose') await chooseSyncFolder();
  if (action === 'sync-folder-now') await syncFolderNow();
  if (action === 'sync-folder-off') stopFolderSync();
  if (action === 'host-start') await beginHosting();
  if (action === 'host-stop') endHosting();
  if (action === 'scan-barcode') await scanBarcode();
  if (action === 'scan-putaway') await scanPutaway();
  if (action === 'scan-inventory') await scanInventory();
  if (/^scan-(?:use-one|used|wasted|edit|add|close)$/.test(action)) handleScanAction(action);
  if (action === 'steps-read-aloud') toggleReadAloud();
  if (action === 'auto-backup-folder') await chooseAutoBackupFolder();
  if (action === 'auto-backup-off') turnOffAutoBackup();
  if (action === 'updates-check') await checkForUpdates(true);
  if (action === 'find-ideas') await findIdeas(ideas.focus || '');
  if (action === 'find-ideas-all') await findIdeas('');
  if (action === 'use-it-up') await useItUp(id);
  if (action === 'add-idea') addIdea(id);
  if (action === 'pin-save') await savePin();
  if (action === 'pin-remove') await removePin();
  if (action === 'steps-listen') toggleListening();
  if (action === 'open-settings') {
    $('#settings-button').click();
    const connection = button.dataset.open && $(`#${button.dataset.open}`);
    if (connection) { showSettingsTab('connections'); connection.open = true; }
  }
  // The sidebar's sync card: Your data (backups) for a kitchen kept on this device, else Connections.
  if (action === 'open-sync-settings') {
    $('#settings-button').click();
    showSettingsTab(!isShared() && !folderSync() ? 'data' : 'connections');
  }
  if (action === 'settings-tab') showSettingsTab(button.dataset.tab);
  if (action === 'preview-idea' && !event.target.closest('a')) previewIdea(id);
  if (action === 'search-online') {
    recipeQuery = $('#recipe-search').value.trim();
    await searchOnline(recipeQuery);
  }
  if (action === 'restore-data') openFilePicker($('#restore-file'));
  if (action === 'restore-server-backup') await restoreServerBackup(button.dataset.name);
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
  if (action === 'steps-check-all') {
    const boxes = Array.from(document.querySelectorAll('#steps-body [data-steps-item]'));
    const all = boxes.every((box) => box.checked);
    boxes.forEach((box) => { if (all) cookSession.checked.delete(box.dataset.stepsItem); else cookSession.checked.add(box.dataset.stepsItem); });
    renderCookStep();
  }
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
  if (action === 'remove-item') {
    $('#item-remove-choice').hidden = false;
    $('#item-remove-choice button').focus();
  }
  if (action === 'remove-used' || action === 'remove-wasted' || action === 'remove-plain') {
    removeInventoryItem($('#item-form').elements.id.value, { 'remove-used': 'used', 'remove-wasted': 'wasted' }[action] || '');
    $('#item-dialog').close();
  }
  if (action === 'item-opened') markItemOpened($('#item-form'));
  // − and ＋ step in the unit shown (50 g, 0.1 kg, 1 oz…), so a weighed item doesn't change by one gram.
  if (action === 'adjust') {
    const item = state.inventory.find((entry) => entry.id === id);
    if (item) {
      const shown = shownAmount(item.quantity, item.unit);
      const next = Math.max(0, roundTo(Number(shown.quantity) + Number(button.dataset.delta) * stepFor(shown.unit), 2));
      const stored = shown.unit === (item.unit || '') ? next : amountIn(next, shown.unit, item.unit);
      item.quantity = stored === null ? next : stored;
      persist();
    }
  }
  if (action === 'filter-low') {
    inventoryLowOnly = !inventoryLowOnly;
    render();
    const list = $('#inventory-items');
    if (inventoryLowOnly && list && list.scrollIntoView) list.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  if (action === 'add-shopping-item') openShoppingItemDialog();
  if (action === 'use-some') openUseDialog(id);
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
  if (action === 'toggle-favourite') toggleFavourite(id);
  if (action === 'rate-recipe') rateRecipe(id, Number(button.dataset.value));
  if (action === 'delete-recipe-note') deleteRecipeNote(id);
  if (action === 'diet-filter') toggleDietFilter(button.dataset.filter);
  if (action === 'favourites-filter') {
    favouritesOnly = !favouritesOnly;
    try { localStorage.setItem(FAVOURITES_FILTER_KEY, String(favouritesOnly)); } catch { /* A per-browser convenience only. */ }
    render();
  }
  if (action === 'repeat-last-week') repeatLastWeek();
  if (action === 'suggest-week') suggestWeek();
  if (action === 'swap-suggestion') swapWeekSuggestion(button.dataset.date);
  if (action === 'drop-suggestion') {
    weekSuggestions = weekSuggestions.filter((entry) => entry.date !== button.dataset.date);
    render();
  }
  if (action === 'cancel-suggestions') { weekSuggestions = null; render(); }
  if (action === 'plan-suggestions') planWeekSuggestions();
  if (action === 'copy-day') {
    copyingDay = copyingDay === dateKey(selectedDate) ? '' : dateKey(selectedDate);
    render();
  }
  if (action === 'copy-day-to') copyDayTo(button.dataset.date);
  if (action === 'remove-plan') withUndo(t('Meal removed from the plan'), ['plan'], () => { state.plan = state.plan.filter((entry) => entry.id !== id); });
  if (action === 'undo') undoLastChange();
  if (action === 'cook') openCookDialog(state.plan.find((entry) => entry.id === id));
  if (action === 'kitchen-screen') openKitchenScreen();
  if (action === 'close-kitchen-screen') closeKitchenScreen();
  if (action === 'kitchen-cook') {
    // Cook mode opens over the kitchen screen, which is still there afterwards.
    startCookSteps(recipeById(id), button.dataset.plan || '');
  }
  if (action === 'generate-shopping') generateShopping();
  if (action === 'recipe-shopping') openRecipeShopping();
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
  if (action === 'reset-shop-order') resetShopOrder();
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
  if (action === 'calendar-make') await makeCalendarLink();
  if (action === 'shrink-photos') await shrinkLargePhotos();
  if (action === 'calendar-stop') await stopCalendarLink();
  if (action === 'calendar-copy') {
    const link = $('#calendar-link');
    link.select();
    try { await navigator.clipboard.writeText(link.value); button.textContent = t('Copied'); } catch { document.execCommand?.('copy'); }
  }
  if (action === 'share-to-recipe') {
    $('#shared-in-dialog').close();
    openRecipeEditor(null, { importFirst: true });
    $('#recipe-edit-form').elements.importText.value = sharedText;
    document.querySelector('[data-action="recipe-import-text"]').click();
  }
  if (action === 'share-to-shopping') { $('#shared-in-dialog').close(); sharedLinesToShopping(sharedText); }
  if (action === 'recipe-photo-pick') openFilePicker($('#recipe-photo-file'));
  if (action === 'recipe-photo-remove') setEditorPhoto('');
  if (action === 'recipe-import-text') {
    const shared = readRecipeFile($('#recipe-edit-form').elements.importText.value);
    if (shared) { fillRecipeEditor(shared, t('Recipe file read. Check it, then save.')); return; }
    const parsed = parseRecipeText($('#recipe-edit-form').elements.importText.value);
    parsed.instructions = tidyImportedSteps(parsed.instructions);
    fillRecipeEditor(parsed, parsed.ingredients.length || parsed.instructions.length
      ? t('Found {ingredients} ingredients and {steps} steps. Check them, then save.', { ingredients: parsed.ingredients.length, steps: parsed.instructions.length })
      : t('Nothing recognisable in that text yet.'));
  }
  if (action === 'wipe-data') openWipeDialog();
  if (action === 'clear-inventory' && clearInventory()) {
    $('#settings-dialog').close();
    activeView = 'inventory';
    render();
  }
  if (action === 'clear-list' && state.shopping.length) withUndo(t('Shopping list cleared'), ['shopping'], () => { state.shopping = []; });
});

document.addEventListener('input', (event) => {
  // The price fills in from the last known price while it wasn't typed by hand (0.51).
  const priceForm = event.target.form && ['item-form', 'putaway-form'].includes(event.target.form.getAttribute('id')) ? event.target.form : null;
  if (priceForm && event.target.name === 'price') priceForm.elements.price.dataset.auto = event.target.value ? 'false' : 'true';
  if (priceForm && ['name', 'quantity', 'unit'].includes(event.target.name) && priceForm.elements.price.dataset.auto !== 'false') {
    const name = priceForm.elements.name ? priceForm.elements.name.value : $('#putaway-item-name').textContent;
    const amount = readAmountFields(priceForm);
    priceForm.elements.price.value = priceOf(name, amount.quantity, amount.unit) ?? '';
  }
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
  if (event.target.id === 'recipe-search') {
    recipeQuery = event.target.value;
    const online = $('.search-online-button');
    if (online) online.hidden = !recipeQuery.trim();
  }
  if (event.target.form?.getAttribute('id') === 'item-form' && event.target.name === 'name') {
    const form = event.target.form;
    updateExpirationSuggestion(form.elements.name.value, form.elements.location.value, form.elements.expiresOn, $('#expiry-estimate-note'), itemFormStartDate(form));
  }
  if (event.target.name === 'expiresOn' && ['item-form', 'putaway-form'].includes(event.target.form?.getAttribute('id'))) {
    event.target.dataset.estimated = 'false';
    const noteId = event.target.form.getAttribute('id') === 'item-form' ? '#expiry-estimate-note' : '#putaway-expiry-note';
    $(noteId).textContent = event.target.value ? t('Using your chosen package date.') : t('Leaving blank will use an estimate for supported products.');
  }
});

// A file picked in one of the hidden file inputs, or through the bridge on Android 4.4 (openFilePicker).
async function useChosenFile(id, file) {
  if (!file) return;
  if (id === 'recipe-file') {
    const shared = readRecipeFile(await file.text());
    fillRecipeEditor(shared || {}, shared ? t('Recipe file read. Check it, then save.') : t('That is not a Goodstock recipe file.'));
  }
  if (id === 'restore-file') await restoreKitchen(file);
  if (id === 'recipe-photo-file') await pickRecipePhoto(file);
}

// "Open a recipe file" is a label around its input, so the bridge's picker has to take over the click there.
document.addEventListener('click', (event) => {
  const label = event.target.closest?.('label.recipe-file-button');
  if (!label || !nativeFilePicker()) return;
  event.preventDefault();
  openFilePicker(label.querySelector('input[type="file"]'));
}, true);

document.addEventListener('change', async (event) => {
  if (['recipe-file', 'restore-file', 'recipe-photo-file'].includes(event.target.id)) {
    const file = event.target.files?.[0];
    event.target.value = '';
    await useChosenFile(event.target.id, file);
    return;
  }
  if (event.target.id === 'host-start-at-login') { setStartAtLogin(event.target.checked); return; }
  if (event.target.id === 'recipe-sort') { setRecipeSort(event.target.value); return; }
  if (event.target.id === 'updates-daily') {
    saveUpdateSettings({ daily: event.target.checked });
    if (event.target.checked) await checkForUpdates();
    return;
  }
  if (event.target.id === 'location-filter') { inventoryLocation = event.target.value; render(); }
  if (event.target.form?.getAttribute('id') === 'item-form' && event.target.name === 'name' && BARCODE.test(event.target.value.trim())) {
    await fillFromBarcode(event.target.value.trim());
    return;
  }
  // Moving an item into or out of the freezer, or changing its freezer date, redoes the estimate from that day.
  if (event.target.form?.getAttribute('id') === 'item-form' && ['location', 'kind', 'frozenOn'].includes(event.target.name)) {
    const form = event.target.form;
    updateFrozenField(form);
    updateExpirationSuggestion(form.elements.name.value, form.elements.location.value, form.elements.expiresOn, $('#expiry-estimate-note'), itemFormStartDate(form));
    updateOpenedRow(form, Boolean(form.elements.id.value));
  }
  if (event.target.form?.getAttribute('id') === 'putaway-form' && event.target.name === 'location') {
    const form = event.target.form;
    updateExpirationSuggestion(form.elements.estimateName.value || $('#putaway-item-name').textContent, form.elements.location.value, form.elements.expiresOn, $('#putaway-expiry-note'));
  }
  if (event.target.id === 'week-date' && event.target.value) {
    const [year, month, day] = event.target.value.split('-').map(Number);
    selectedDate = new Date(year, month - 1, day);
    weekStart = startOfWeek(selectedDate);
    render();
  }
  if (event.target.id === 'language-select') { await changeLanguage(event.target.value); return; }
  if (event.target.id === 'currency-select') {
    try { localStorage.setItem(CURRENCY_KEY, event.target.value); } catch { /* For this visit only. */ }
    render();
    return;
  }
  if (event.target.id === 'units-select') {
    try { localStorage.setItem(UNITS_KEY, event.target.value === 'imperial' ? 'imperial' : 'metric'); } catch { /* For this visit only. */ }
    render();
    return;
  }
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
    if (item) {
      item.checked = event.target.checked;
      if (item.checked) noteShoppingTick(item);
      persist();
    }
  }
});

$('#item-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  const location = form.elements.location.value;
  const resolved = resolvedExpiration(name, location, form.elements.expiresOn, itemFormStartDate(form));
  const expiration = form.elements.kind.value === 'Household' && resolved.expirationSource === 'estimated' ? { expiresOn: '', expirationSource: '' } : resolved;
  const id = form.elements.id.value || makeId();
  const previous = state.inventory.find((entry) => entry.id === id);
  const item = metricInventoryItem({
    id,
    name,
    ...readAmountFields(form),
    ...expiration,
    location,
    kind: form.elements.kind.value,
  });
  // A price is for the whole amount; the item keeps it per unit, and the product remembers it (0.51).
  const price = Number(form.elements.price.value);
  if (price > 0 && item.quantity > 0) {
    item.unitPrice = Math.round((price / item.quantity) * 10000) / 10000;
    rememberPrice(item.name, item.unitPrice, item.unit);
  }
  // Only a date from the package can be "best before"; an estimate is just an estimate.
  if (form.elements.dateKind.value === 'best-before' && item.expiresOn && item.expirationSource !== 'estimated') item.dateKind = 'best-before';
  // The minimum was typed in the unit picked for the amount; it is kept in the unit the item is saved in.
  const typedMinimum = Number(form.elements.minimum.value);
  const minimum = typedMinimum > 0 ? (amountIn(typedMinimum, form.elements.unit.value, item.unit) ?? typedMinimum) : 0;
  if (minimum > 0) item.minimum = minimum;
  if (form.elements.barcode.value) item.barcode = form.elements.barcode.value;
  // Still listed for restocking while below the same minimum, so saving doesn't add it to the list again.
  if (previous && previous.restockListed && minimum > 0) item.restockListed = true;
  if (form.elements.openedOn.value) item.openedOn = form.elements.openedOn.value;
  if (isFrozen(item)) item.frozenOn = form.elements.frozenOn.value || dateKey(new Date());
  // When it came into the kitchen, for learning shelf life (0.30); an edit keeps the first date.
  item.addedOn = previous ? previous.addedOn : dateKey(new Date());
  if (!item.addedOn) delete item.addedOn;
  const existingIndex = state.inventory.findIndex((entry) => entry.id === item.id);
  if (existingIndex < 0) state.inventory.unshift(item); else state.inventory[existingIndex] = item;
  if (stocktake && stocktake.location && existingIndex >= 0 && !stocktake.seen.includes(item.id)) stocktake.seen.push(item.id);
  persist();
  $('#item-dialog').close();
});

$('#use-form').addEventListener('input', updateUseLeft);
$('#use-form').addEventListener('change', updateUseLeft);
$('#use-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const result = useLeftover();
  if (!result || result.left === null) return;
  result.item.quantity = result.left;
  persist();
  $('#use-dialog').close();
});

// Shopping → Add item: a line typed by hand, added to the same product already on the list when the units fit.
$('#shopping-item-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  if (!name) return;
  const amount = readAmountFields(form);
  addToShoppingList([{ name, quantity: amount.quantity, unit: amount.unit }], { combine: true });
  persist();
  $('#shopping-item-dialog').close();
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
      // The amount is shown in a friendly unit (150 g off a 1 kg bag); it comes off in the item's own unit.
      const input = form.elements[`amount-${index}`];
      const typed = Number(input?.value);
      const used = item && typed > 0 ? (amountForItem(typed, input.dataset.unit || item.unit, item) ?? typed) : 0;
      if (item && used > 0) item.quantity = Math.max(0, roundTo(Number(item.quantity) - used, 3));
    }
    if (form.elements.leftovers.checked) addLeftovers(recipe);
    addRecipeNote(recipe.id, form.elements.note.value);
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
      ...readAmountFields(form), location,
      expiration: resolvedExpiration(form.elements.estimateName.value || shoppingItem.name, location, form.elements.expiresOn),
      packageDate: Boolean(form.elements.expiresOn.value) && form.elements.expiresOn.dataset.estimated !== 'true',
      barcode: form.elements.barcode.value,
      price: Number(form.elements.price.value) || 0,
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

// Leftovers from a cooked meal: one portion in the fridge, to eat within LEFTOVER_DAYS, so they show in Use soon.
const LEFTOVER_DAYS = 3;

function addLeftovers(recipe) {
  const location = state.locations.find((place) => FRIDGE_WORDS.test(place)) || state.locations[0];
  const date = new Date();
  date.setDate(date.getDate() + LEFTOVER_DAYS);
  state.inventory.unshift({ id: makeId(), name: t('Leftovers: {name}', { name: recipe.name }), addedOn: dateKey(new Date()), quantity: 1, unit: '', expiresOn: dateKey(date), expirationSource: 'estimated', location, kind: 'Food', leftovers: true });
}

function storeShoppingItem(shoppingItem, { quantity, unit, location, expiration, packageDate, barcode = '', price = 0 }) {
  const bought = metricInventoryItem({ quantity, unit });
  const existing = state.inventory.find((entry) => cleanIngredient(entry.name) === cleanIngredient(shoppingItem.name));
  if (existing) {
    if (barcode) existing.barcode = barcode;
    const added = deductionAmount(`${bought.quantity} ${bought.unit}`.trim(), existing) || bought.quantity;
    existing.quantity = Math.round((Number(existing.quantity) + added) * 100) / 100;
    // The price paid for what was just bought sets the unit price (0.51).
    if (price > 0 && added > 0) existing.unitPrice = Math.round((price / added) * 10000) / 10000;
    if (packageDate) Object.assign(existing, expiration);
    else if (!existing.expiresOn && expiration.expiresOn) Object.assign(existing, expiration);
    // A fresh pack replaces the opened one's shorter date.
    if (existing.openedOn) { delete existing.openedOn; if (!packageDate && expiration.expiresOn) Object.assign(existing, expiration); }
  } else {
    const item = { id: makeId(), name: shoppingItem.name, quantity: bought.quantity, unit: bought.unit, ...expiration, location, kind: 'Food' };
    if (Number(shoppingItem.keep) > 0) item.minimum = Number(shoppingItem.keep);
    if (barcode) item.barcode = barcode;
    item.addedOn = dateKey(new Date());
    if (isFrozen(item)) item.frozenOn = dateKey(new Date());
    if (price > 0 && item.quantity > 0) item.unitPrice = Math.round((price / item.quantity) * 10000) / 10000;
    state.inventory.unshift(item);
  }
  if (price > 0 && bought.quantity > 0) rememberPrice(shoppingItem.name, price / bought.quantity, bought.unit);
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

// Updates (desktop and Android apps): once a day the app asks GitHub for the newest release (the tagged versions), and
// when it is newer, Settings → Your data says so with a download link and the Settings button gets a dot. Nothing is
// downloaded or installed by itself. The daily check can be turned off there.
const UPDATE_CHECK_KEY = 'goodstock-update-check-v1';
const RELEASES_API = 'https://api.github.com/repos/donefear/GoodStock/releases/latest';
const canCheckUpdates = () => STANDALONE && (nativeApp.platform === 'desktop' || (typeof nativeApp.checksForUpdates === 'function' && nativeApp.checksForUpdates() === true));
const appVersion = () => (((document.querySelector('.settings-actions .made-by') || {}).textContent || '').match(/Goodstock v(\d+\.\d+\.\d+)/) || [])[1] || '';

function isNewerVersion(candidate, current) {
  const a = String(candidate).split('.').map(Number);
  const b = String(current).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
  return false;
}

function updateSettings() {
  try { return { daily: true, ...JSON.parse(localStorage.getItem(UPDATE_CHECK_KEY) || '{}') }; } catch { return { daily: true }; }
}

function saveUpdateSettings(changes) {
  try { localStorage.setItem(UPDATE_CHECK_KEY, JSON.stringify({ ...updateSettings(), ...changes })); } catch { /* Checked again next time. */ }
}

const updateAvailable = (settings = updateSettings()) => Boolean(settings.latest && isNewerVersion(settings.latest, appVersion()));

function fillUpdates() {
  const zone = $('#updates-zone');
  zone.hidden = !canCheckUpdates();
  $('#settings-button').classList.toggle('has-update', canCheckUpdates() && updateAvailable());
  if (zone.hidden) return;
  const settings = updateSettings();
  const text = $('#updates-text');
  $('#updates-download').hidden = !updateAvailable(settings);
  $('#updates-daily').checked = settings.daily;
  if (updateCheckRunning) text.textContent = t('Checking for updates…');
  else if (updateAvailable(settings)) {
    text.textContent = t('Goodstock v{version} is available. You have v{current}.', { version: settings.latest, current: appVersion() })
      + (nativeApp.platform === 'desktop' ? '' : ` ${t('On the release page, download the .apk file and open it to install the update.')}`);
  }
  else if (settings.error) text.textContent = t('Could not check for updates. Check the internet connection and try again.');
  else if (settings.last) text.textContent = t('Up to date (v{current}). Last checked: {date}.', { current: appVersion(), date: formatDate(new Date(settings.last), { day: 'numeric', month: 'short', year: 'numeric' }) });
  else text.textContent = t('Goodstock can look for a newer version on GitHub once a day. Nothing is installed by itself.');
}

let updateCheckRunning = false;
async function checkForUpdates(force = false) {
  const settings = canCheckUpdates() && updateSettings();
  if (!settings || updateCheckRunning) return;
  if (!force && (!settings.daily || (settings.last && Date.now() - new Date(settings.last).getTime() < DAY_MS))) return fillUpdates();
  updateCheckRunning = true;
  if ($('#settings-dialog').open) fillUpdates();
  try {
    const response = JSON.parse(await nativeCall('httpRequest', RELEASES_API, JSON.stringify({ accept: 'application/vnd.github+json' })));
    const tag = response.status === 200 ? String(JSON.parse(response.body).tag_name || '') : '';
    if (!/^v?\d+\.\d+\.\d+$/.test(tag)) throw new Error(`release ${response.status}`);
    saveUpdateSettings({ latest: tag.replace(/^v/, ''), last: new Date().toISOString(), error: '' });
  } catch (error) {
    saveUpdateSettings({ error: String(error?.message || 'failed') });
  } finally {
    updateCheckRunning = false;
  }
  fillUpdates();
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
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { $('#backup-status').textContent = t('That file is not a Goodstock backup.'); return; }
  restoreKitchenData(parsed);
}

// Server backups (server version): listed in Settings → Your data, restored like a backup file.
async function fillServerBackups() {
  const zone = $('#server-backups-zone');
  zone.hidden = STANDALONE || HOSTED;
  if (zone.hidden) return;
  const list = $('#server-backups');
  try {
    const { backups, copy } = await (await fetch('/api/backups')).json();
    // BACKUP_COPY_DIR on the server (0.38): a second copy, for example on a NAS.
    const copyLine = copy
      ? `<li class="muted backup-copy-line">${copy.ok ? t('Every backup is also copied to a second folder.') : escapeHtml(t('Copying to the second folder failed: {reason}', { reason: copy.error }))}</li>`
      : '';
    list.innerHTML = copyLine + (backups.length
      ? backups.map((backup) => {
        const when = backup.savedAt ? formatDate(new Date(backup.savedAt), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : backup.name;
        const what = t('{items} inventory items and {recipes} recipes', { items: backup.inventory, recipes: backup.recipes });
        return `<li><span><b>${escapeHtml(when)}</b>${backup.safety ? ` <i>${t('before a big change')}</i>` : ''}<br/>${escapeHtml(what)}</span><button class="button button-small button-quiet" type="button" data-action="restore-server-backup" data-name="${escapeHtml(backup.name)}">${t('Restore')}</button></li>`;
      }).join('')
      : `<li class="muted">${t('No backups yet. The first one is made with the first change of the day.')}</li>`);
  } catch {
    list.innerHTML = `<li class="muted">${t('Server backups are unavailable while offline.')}</li>`;
  }
}

async function restoreServerBackup(name) {
  try {
    const response = await fetch(`/api/backups/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error('gone');
    restoreKitchenData(await response.json());
  } catch {
    $('#backup-status').textContent = t('That backup could not be loaded.');
  }
  await fillServerBackups();
}

function restoreKitchenData(parsed) {
  const status = $('#backup-status');
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

$('#recipe-shopping-form').addEventListener('input', (event) => {
  if (event.target.id === 'recipe-shopping-search') renderRecipeShopping();
  else if (event.target.dataset.shopServings || event.target.dataset.shopFactor) updateRecipeShoppingPick(event.target);
});
$('#recipe-shopping-form').addEventListener('change', (event) => {
  if (event.target.dataset.shopRecipe) updateRecipeShoppingPick(event.target);
});
$('#recipe-shopping-form').addEventListener('submit', (event) => {
  event.preventDefault();
  addRecipesToShopping();
});

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
  if (formId === 'recipe-note-form') {
    event.preventDefault();
    const form = event.target;
    if (addRecipeNote(form.dataset.id, form.elements.text.value)) persist(); else form.elements.text.focus();
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
  $('#units-select').value = unitSystem();
  fillLanguageSelect();
  showSettingsTab('general');
  for (const connection of $$('#settings-dialog .settings-connection')) connection.open = false;
  $('#settings-dialog').showModal();
  await fillSettings();
});

// Settings has three tabs: General (this device), Connections (Mealie, DeepL, PIN, home server, each folded to one
// line with its status) and Your data (backups, wipe). It opens on General with the connections folded.
function showSettingsTab(tab) {
  for (const button of $$('#settings-dialog [data-action="settings-tab"]')) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  for (const panel of $$('#settings-dialog .settings-panel')) panel.hidden = panel.dataset.panel !== tab;
}

// The parts of Settings that depend on this device and on the connections, in the chosen language.
// The meal plan as a calendar feed (0.53, server version): the server keeps only a hash of the link's token, so a
// link is shown once, when it is made; making another replaces it.
async function loadCalendarStatus() {
  if (STANDALONE) return;
  try {
    const { enabled } = await (await fetch('api/calendar')).json();
    showCalendarStatus(enabled, '');
  } catch {
    $('#calendar-note').textContent = t('Could not reach the server.');
  }
}

function showCalendarStatus(enabled, link) {
  $('#calendar-note').textContent = enabled ? t('On: your calendar gets every planned meal') : t('Off');
  $('#calendar-link-row').hidden = !link;
  $('#calendar-link').value = link;
  $('#calendar-copy').hidden = !link;
  $('#calendar-stop').hidden = !enabled;
  $('#calendar-make').textContent = enabled ? t('Make a new link') : t('Make a calendar link');
}

async function makeCalendarLink() {
  const response = await fetch('api/calendar', { method: 'POST' });
  if (!response.ok) { $('#calendar-note').textContent = t('Could not reach the server.'); return; }
  const { token } = await response.json();
  showCalendarStatus(true, new URL(`api/plan.ics?token=${encodeURIComponent(token)}`, location.href).href);
  $('#calendar-link').select();
}

async function stopCalendarLink() {
  await fetch('api/calendar', { method: 'DELETE' });
  showCalendarStatus(false, '');
}

// Size of the kitchen (0.55): every device loads and syncs all of it, and photos are most of it. Recipe photos are
// small JPEGs since v3.2.3, but older or imported ones can be bigger; "Shrink large photos" makes them small too.
const LARGE_PHOTO = 150_000; // characters of data URL, about 110 kB

function formatBytes(bytes) {
  const number = (value) => new Intl.NumberFormat(languageLocale(), { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
  return bytes >= 1_000_000 ? `${number(bytes / 1_000_000)} MB` : `${number(Math.max(1, bytes / 1000))} kB`;
}

const largePhotoRecipes = () => state.recipes.filter((recipe) => String(recipe.photo || '').startsWith('data:') && recipe.photo.length > LARGE_PHOTO);

function showKitchenSize() {
  const total = new Blob([JSON.stringify(state)]).size;
  const photos = state.recipes.reduce((sum, recipe) => sum + (String(recipe.photo || '').startsWith('data:') ? recipe.photo.length : 0), 0);
  const large = largePhotoRecipes().length;
  $('#kitchen-size-text').textContent = [
    t('{size} in all, of which {photos} photos. Every device keeps and syncs all of it.', { size: formatBytes(total), photos: formatBytes(photos) }),
    large ? tp(large, '{count} photo is larger than it needs to be.', '{count} photos are larger than they need to be.') : '',
  ].filter(Boolean).join(' ');
  $('#shrink-photos').hidden = !large;
}

async function shrinkLargePhotos() {
  for (const recipe of largePhotoRecipes()) {
    try {
      const [, type, data] = /^data:([^;,]+);base64,(.*)$/.exec(recipe.photo) || [];
      if (!data) continue;
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      recipe.photo = await shrinkPhoto(new Blob([bytes], { type }));
    } catch {
      // A photo that can't be read stays as it is.
    }
  }
  persist();
  showKitchenSize();
}

async function fillSettings() {
  loadCalendarStatus();
  showKitchenSize();
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
  fillFolderSyncSettings();
  fillHostSettings();
  fillAutoBackup();
  fillUpdates();
  await Promise.all([loadMealieSettings(), loadDeeplSettings(), fillPinSettings(), fillServerBackups()]);
}

function fillSettingsMode() {
  const phoneShared = STANDALONE && (homeServer() || folderSync());
  $('#settings-mode-title').textContent = STANDALONE && !phoneShared ? t('Kept on this device') : t('Shared kitchen');
  const mode = $('#settings-mode-text');
  if (hosting()) mode.textContent = t('This device hosts the kitchen for your household. The others stay in step while Goodstock is open here.');
  else if (folderSync()) mode.textContent = t('This device shares the kitchen through a shared folder and keeps a full copy, so it also works offline.');
  else if (phoneShared) mode.textContent = t('This phone shares the kitchen on your home server and keeps a copy, so it also works when you are out.');
  else if (STANDALONE) mode.textContent = t('The phone app keeps everything on this device and works without a server. Use Back up below to save a copy.');
  else if (HOSTED) mode.textContent = t('This kitchen is shared from a phone or computer on your Wi-Fi. It stays in step while Goodstock runs there.');
  else if (liveSync.connected) mode.textContent = tp(liveSync.devices, 'Everyone who opens Goodstock on this server sees the same kitchen, updated live ({count} device connected now).', 'Everyone who opens Goodstock on this server sees the same kitchen, updated live ({count} devices connected now).');
  else mode.textContent = t('Everyone who opens Goodstock on this server sees the same kitchen, updated live.');
}

function setMealieNote(text, kind = '') {
  const note = $('#mealie-note');
  note.textContent = text;
  note.className = `settings-note${kind ? ` is-${kind}` : ''}`;
}

async function loadMealieSettings() {
  const form = $('#settings-form');
  form.elements.mealieKey.value = '';
  if (!mealieAvailable()) { mealieConfigured = false; return; }
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
    const response = await fetch('/api/mealie/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, apiKey, publicUrl }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(serverError(result, N_('Could not connect to Mealie.')), { unreachable: /Could not reach/.test(result.error || '') });
    const user = result.user || '';
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
  await fetch('/api/mealie/config', { method: 'DELETE' }).catch(() => {});
  mealieResults = [];
  await loadMealieSettings();
  render();
}

document.addEventListener('click', (event) => {
  if (event.target.matches('[data-close]')) event.target.closest('dialog').close();
});

// Seven quick taps on the little logo.
let logoTaps = [];
document.addEventListener('click', (event) => {
  const signature = event.target.closest && event.target.closest('.made-by');
  if (!signature) return;
  const now = Date.now();
  logoTaps = logoTaps.filter((time) => now - time < 3000).concat(now);
  if (logoTaps.length < 7) return;
  logoTaps = [];
  signature.classList.add('made-by-egg');
  setTimeout(() => signature.classList.remove('made-by-egg'), 4000);
});

// Settings → Feedback: an email with room for the person's own words, then what helps to look into a problem.
const FEEDBACK_EMAIL = 'donefear.space@gmail.com';
function feedbackMailto(kind) {
  const problem = kind === 'problem';
  const version = appVersion();
  const where = STANDALONE ? `${nativeApp.platform || 'android'} app${isShared() ? ', shared kitchen' : ''}` : 'browser, server kitchen';
  const subject = `Goodstock ${problem ? 'problem' : 'idea'} (v${version})`;
  const body = [problem ? t('What happened, and what did you expect to happen?') : t('Your idea:'), '', '', '', '---',
    `Goodstock v${version} · ${where} · ${currentLanguage}`, navigator.userAgent].join('\n');
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

document.addEventListener('click', (event) => {
  const link = event.target.closest && event.target.closest('[data-feedback]');
  if (link) link.href = feedbackMailto(link.dataset.feedback);
});

// A recipe photo that can't load (a web address while offline, a Mealie server that's off) is simply left out.
document.addEventListener('error', (event) => {
  if (event.target.classList && event.target.classList.contains('recipe-photo')) event.target.hidden = true;
}, true);

$('#steps-body').addEventListener('change', (event) => {
  const key = event.target.dataset.stepsItem;
  if (!key || !cookSession) return;
  if (event.target.checked) cookSession.checked.add(key); else cookSession.checked.delete(key);
  const toggle = $('#steps-body .steps-check-all');
  if (toggle) toggle.textContent = Array.from(document.querySelectorAll('#steps-body [data-steps-item]')).every((box) => box.checked) ? t('Clear all') : `✓ ${t('Select all')}`;
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
// The Android widget opens the app on a page (Inventory or Shopping); MainActivity keeps it until the page asks.
function openViewFromApp() {
  if (!STANDALONE || typeof nativeApp.takeOpenView !== 'function') return;
  const view = String(nativeApp.takeOpenView() || '');
  if (['inventory', 'shopping', 'week', 'recipes', 'tools'].includes(view)) { activeView = view; render(); }
}

// Shared into Goodstock (0.52): the Android app is in the phone's share menu. A web address (with at most a title)
// opens Import with it; other text asks whether it is a recipe or things for the shopping list.
let sharedText = '';

function takeSharedText() {
  if (!STANDALONE || typeof nativeApp.takeSharedText !== 'function') return;
  const text = String(nativeApp.takeSharedText() || '').trim();
  if (text) handleSharedText(text);
}

function handleSharedText(text) {
  const link = /https?:\/\/[^\s]+/.exec(text);
  const rest = link ? text.replace(link[0], '').trim() : text;
  if (link && rest.split('\n').filter(Boolean).length <= 1) {
    openRecipeEditor(null, { importFirst: true });
    $('#recipe-edit-form').elements.importUrl.value = link[0];
    importRecipeFromUrl();
    return;
  }
  sharedText = text;
  $('#shared-preview').textContent = text.length > 300 ? `${text.slice(0, 300)}…` : text;
  $('#shared-in-dialog').showModal();
}

// Each line becomes a shopping item ("2 kg potatoes", "- milk", "☐ bread").
function sharedLinesToShopping(text) {
  const lines = text.split('\n').map((line) => line.replace(/^\s*(?:[-*•·]|\[\s?[xX]?\]|☐|☑|\d+[.)])\s*/, '').trim()).filter((line) => line && !/^https?:\/\//.test(line));
  if (!lines.length) return;
  withUndo(tp(lines.length, '{count} item added to the shopping list', '{count} items added to the shopping list'), ['shopping'], () => {
    addToShoppingList(lines.map((line) => {
      const { amount, unitText, name } = parseIngredient(line);
      const { id, ...item } = metricInventoryItem({ id: '', name: name.charAt(0).toUpperCase() + name.slice(1), quantity: amount ?? '', unit: unitText || '', source: t('Shared') });
      return item;
    }), { combine: true });
  });
  activeView = 'shopping';
  render();
}

window.goodstockResume = () => {
  takeSharedText();
  openViewFromApp();
  checkRemoteRevision();
  syncFolderNow();
  runAutoBackup();
  checkForUpdates();
  refreshTimers();
  checkExpiryReminders();
};
// Browsers only allow sound after a tap, so the first touch after a reload unlocks the alarm.
document.addEventListener('pointerdown', unlockAlarmAudio, { once: true, capture: true });
window.addEventListener('offline', () => { updateSyncStatus('offline'); render(); });

// The kitchen screen: Escape goes back to the app; at night a tap anywhere on it brightens it first.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#kitchen-screen').hidden && !document.querySelector('dialog[open]')) closeKitchenScreen();
});
$('#kitchen-screen').addEventListener('click', (event) => {
  if (!event.currentTarget.classList.contains('night')) return;
  event.preventDefault();
  event.stopPropagation();
  wakeKitchenScreen();
}, true);

initialize().then(openViewFromApp).then(() => { if (kitchenScreenRemembered()) openKitchenScreen(); takeSharedText(); });
