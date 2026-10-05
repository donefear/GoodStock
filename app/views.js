// Goodstock, part 3 of 5: preferences (text size, theme, language), start-up, and every page: inventory, week,
// shopping, tools, recipes and the recipe page, the recipe editor and import, translation, item and recipe
// dialogs, and barcodes.
// The parts load in order as plain scripts (see index.html) and share one global scope.

// Text size: a per-device preference that scales the whole interface (CSS zoom, which Chrome 81 has too).
const TEXT_SIZE_KEY = 'goodstock-text-size-v1';
const TEXT_SIZES = { normal: 1, large: 1.15, xlarge: 1.3 };

function applyTextSize(size) {
  const chosen = TEXT_SIZES[size] ? size : 'normal';
  document.documentElement.style.zoom = chosen === 'normal' ? '' : String(TEXT_SIZES[chosen]);
  document.documentElement.dataset.textSize = chosen;
  const select = $('#text-size-select');
  if (select) select.value = chosen;
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  const themeColor = $('meta[name="theme-color"]');
  if (themeColor) themeColor.content = isDark ? '#151d19' : '#f4f5ef';
  const toggle = $('#dark-mode-toggle');
  if (toggle) toggle.checked = isDark;
}

function fillLanguageSelect() {
  $('#language-select').innerHTML = LANGUAGES.map((language) => `<option value="${language.code}" ${language.code === currentLanguage ? 'selected' : ''}>${escapeHtml(language.name)}</option>`).join('');
}

// Switching language redraws everything that was written in the old one: the fixed page (i18n.js), the current
// view, timers and the open Settings dialog.
async function changeLanguage(code) {
  await setLanguage(code, { remember: true });
  fillIngredientOptions();
  if (cookSession) cookSession.bites = buildCookBites(cookSession.recipe);
  if ($('#steps-dialog').open && cookSession) renderCookStep();
  syncNativeTimers();
  render();
  if ($('#settings-dialog').open) await fillSettings();
}

async function loadIngredientCatalog() {
  try {
    const response = await fetch('/ingredients.json');
    if (!response.ok) throw new Error('Ingredient catalog unavailable');
    ingredientCatalog = await response.json();
    localStorage.setItem(INGREDIENTS_KEY, JSON.stringify(ingredientCatalog));
  } catch {
    try {
      ingredientCatalog = JSON.parse(localStorage.getItem(INGREDIENTS_KEY) || '[]');
    } catch {
      ingredientCatalog = [];
    }
  }
  fillIngredientOptions();
}

// Suggestions when adding an item: the name in the app's language first, plus English and Dutch (the household's
// other usual languages), each labelled with the other name and the category.
function fillIngredientOptions() {
  const options = $('#ingredient-options');
  if (!options) return;
  options.innerHTML = ingredientCatalog.flatMap((ingredient) => {
    const category = escapeHtml(t(ingredient.category || ''));
    const local = catalogNames(ingredient, currentLanguage)[0];
    const names = [...new Set([local, ingredient.en, ingredient.nl].filter(Boolean))];
    return names.map((name) => {
      const other = name === ingredient.en ? (local && local !== name ? local : ingredient.nl) : ingredient.en;
      return `<option value="${escapeHtml(name)}" label="${escapeHtml(other)} · ${category}"></option>`;
    });
  }).join('');
}

// Older Chrome (before 84, e.g. the last Chrome for Android 4.4 tablets) has no gap in flex rows; styles.css then
// spaces things with margins instead.
function detectFlexGap() {
  const probe = document.createElement('div');
  probe.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
  probe.append(document.createElement('div'), document.createElement('div'));
  document.body.append(probe);
  const supported = probe.scrollHeight === 1;
  probe.remove();
  document.documentElement.classList.toggle('no-flex-gap', !supported);
}

async function initialize() {
  detectFlexGap();
  await setLanguage(preferredLanguage());
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');
  try { applyTextSize(localStorage.getItem(TEXT_SIZE_KEY)); } catch { applyTextSize('normal'); }
  document.documentElement.classList.toggle('is-standalone', STANDALONE);
  const cached = localStorage.getItem(STORAGE_KEY);
  // First visit on this device: the starting kitchen in the device's language (an existing server kitchen
  // replaces it below).
  if (!cached) state = freshState();
  const shared = isShared();
  const pending = shared ? localStorage.getItem(PENDING_KEY) : 'local';
  if (cached) state = normalizeState(JSON.parse(cached));
  // Shared kitchen: start from the server's copy, folding in anything this device changed while away.
  if (shared && navigator.onLine) {
    try {
      const remote = await fetchRemoteKitchen();
      if (remote.state) {
        state = normalizeState(pending ? mergeStates(readSyncBase()?.state, JSON.parse(pending), remote.state) : remote.state);
        writeSyncBase(remote);
        if (pending) localStorage.setItem(PENDING_KEY, JSON.stringify(state));
      } else {
        // An empty server: this device's kitchen becomes the shared one.
        localStorage.setItem(PENDING_KEY, JSON.stringify(state));
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      if (cached) updateSyncStatus('offline');
    }
  }
  if (!cached && (!pending || !shared)) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (shared) localStorage.setItem(PENDING_KEY, JSON.stringify(state));
  }
  await loadIngredientCatalog();
  if (backfillMissingExpirations()) {
    const snapshot = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, snapshot);
    if (shared) localStorage.setItem(PENDING_KEY, snapshot);
  }
  inventoryMode = localStorage.getItem(INVENTORY_MODE_KEY) === 'map' ? 'map' : 'list';
  loadTimers();
  render();
  pushPendingState();
  connectLiveSync();
  if (!STANDALONE) {
    fetch('/api/mealie/status').then((response) => response.json()).then((result) => {
      mealieConfigured = Boolean(result.configured);
    }).catch(() => { mealieConfigured = false; }).finally(() => {
      if (activeView === 'recipes' || activeView === 'week') render();
    });
    // The Android app ships its files inside the APK, so it needs no offline cache.
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  } else {
    mealieConfigured = Boolean(phoneMealie());
  }
  checkExpiryReminders();
  runAutoBackup();
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      if (activeView === 'inventory') render();
      checkExpiryReminders();
    }
  }, 60 * 60 * 1000);
}

function render() {
  const names = { inventory: t('INVENTORY'), week: t('THIS WEEK'), shopping: t('SHOPPING LIST'), recipes: t('RECIPES'), tools: t('TOOLS'), recipe: t('RECIPE') };
  $('#page-crumb').textContent = names[activeView];
  $('#today-label').textContent = formatDate(new Date(), { month: 'short', day: 'numeric' });
  const navView = activeView === 'recipe' ? 'recipes' : activeView;
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === navView));
  const unchecked = state.shopping.filter((item) => !item.checked).length;
  $('#shopping-count').textContent = unchecked ? String(unchecked) : '';
  const views = { inventory: renderInventory, week: renderWeek, shopping: renderShopping, recipes: renderRecipes, tools: renderTools, recipe: renderRecipePage };
  $('#view-container').innerHTML = views[activeView]();
  refreshTimers();
  if (activeView === 'tools') afterToolsRender();
  updateSyncStatus(navigator.onLine ? (localStorage.getItem(PENDING_KEY) ? 'pending' : 'online') : 'offline');
}

function pageHeading(eyebrow, title, subtitle, action = '') {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}

// "Food" and "Household" are stored in English and shown in the chosen language.
const KIND_LABELS = { Food: N_('Food'), Household: N_('Household') };
const kindLabel = (kind) => (KIND_LABELS[kind] ? t(KIND_LABELS[kind]) : kind || '');
const ALL_LOCATIONS = N_('All locations');

function renderInventory() {
  const locations = [ALL_LOCATIONS, ...state.locations];
  const rows = state.inventory.filter((item) => {
    const matchesText = `${item.name} ${item.kind} ${kindLabel(item.kind)}`.toLowerCase().includes(inventoryQuery.toLowerCase());
    return matchesText && (inventoryLocation === ALL_LOCATIONS || item.location === inventoryLocation);
  });
  const foodCount = state.inventory.filter((item) => item.kind !== 'Household' && Number(item.quantity) > 0).length;
  const lowCount = state.inventory.filter((item) => Number(item.quantity) > 0 && Number(item.quantity) <= 1).length;
  const action = `<button class="button button-primary" data-action="add-item"><span aria-hidden="true">＋</span> ${t('Add item')}</button>`;
  return `${pageHeading(t('THE KITCHEN, AT A GLANCE'), t('Good things on hand.'), t('A clear picture of what is here, and where it lives.'), action)}
    <div class="stats-row"><div class="stat"><span class="stat-icon mint">▤</span><div><strong>${foodCount}</strong><span>${tp(foodCount, 'food item', 'food items')}</span></div></div><div class="stat"><span class="stat-icon coral">◷</span><div><strong>${lowCount}</strong><span>${t('running low')}</span></div></div><div class="stat"><span class="stat-icon yellow">⌂</span><div><strong>${state.locations.length}</strong><span>${tp(state.locations.length, 'storage spot', 'storage spots')}</span></div></div></div>
    ${renderExpirationPanel()}
    <section class="section-block"><div class="section-heading"><div><h2>${t('Everything in its place')}</h2><span class="muted">${tp(rows.length, '{count} item', '{count} items')}</span></div><div class="inventory-tools"><div class="filter-controls"><label class="search-field"><span aria-hidden="true">⌕</span><input id="inventory-search" value="${escapeHtml(inventoryQuery)}" placeholder="${t('Find something')}" aria-label="${t('Find an item')}" /></label><select id="location-filter" aria-label="${t('Filter by location')}">${locations.map((location) => `<option value="${escapeHtml(location)}" ${inventoryLocation === location ? 'selected' : ''}>${escapeHtml(location === ALL_LOCATIONS ? t(ALL_LOCATIONS) : location)}</option>`).join('')}</select></div><div class="inventory-mode-switch" role="group" aria-label="${t('Inventory display mode')}"><button class="${inventoryMode === 'list' ? 'active' : ''}" data-action="inventory-mode" data-mode="list" aria-pressed="${inventoryMode === 'list'}">${t('List')}</button><button class="${inventoryMode === 'map' ? 'active' : ''}" data-action="inventory-mode" data-mode="map" aria-pressed="${inventoryMode === 'map'}">${t('Map')}</button></div></div></div>
    ${inventoryMode === 'map' ? renderInventoryMap(rows) : rows.length ? `<div class="inventory-list">${rows.map((item) => `<article class="inventory-row"><div class="item-symbol ${item.kind === 'Household' ? 'household' : ''}" aria-hidden="true">${item.kind === 'Household' ? '⌂' : '◌'}</div><div class="item-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.location)} <i>·</i> ${escapeHtml(kindLabel(item.kind))}</span>${inventoryExpiryMarkup(item, 'span')}</div><div class="quantity-stepper"><button data-action="adjust" data-id="${escapeHtml(item.id)}" data-delta="-1" aria-label="${t('Decrease {name}', { name: escapeHtml(item.name) })}">−</button><span>${escapeHtml(item.quantity)} <small>${escapeHtml(item.unit || '')}</small></span><button data-action="adjust" data-id="${escapeHtml(item.id)}" data-delta="1" aria-label="${t('Increase {name}', { name: escapeHtml(item.name) })}">＋</button></div><button class="row-edit" data-action="edit-item" data-id="${escapeHtml(item.id)}" aria-label="${t('Edit {name}', { name: escapeHtml(item.name) })}" title="${t('Edit item')}">•••</button></article>`).join('')}</div>` : `<div class="empty-state"><span class="empty-mark">＋</span><strong>${inventoryQuery ? t('Nothing found just yet.') : t('A little room for the good stuff.')}</strong><p>${inventoryQuery ? t('Try another name or location.') : t('Add what you already have in your kitchen.')}</p>${inventoryQuery ? '' : `<button class="button button-primary" data-action="add-item">${t('Add the first item')}</button>`}</div>`}</section>`;
}

function renderInventoryMap(rows) {
  if (!rows.length && inventoryQuery) return `<div class="empty-state"><span class="empty-mark">⌕</span><strong>${t('Nothing found just yet.')}</strong><p>${t('Try another name or location.')}</p></div>`;
  const locations = [...new Set([...state.locations, ...rows.map((item) => item.location).filter(Boolean)])]
    .filter((location) => inventoryLocation === ALL_LOCATIONS || location === inventoryLocation);
  const categoryIcons = { Fruit: '🍎', Vegetables: '🥕', Herbs: '🌿', Dairy: '🥛', 'Meat and fish': '🍗', Bakery: '🍞', Baking: '🥣', Pantry: '🥫' };
  const locationIcon = (location) => FREEZER_WORDS.test(location) || FRIDGE_WORDS.test(location) ? '❄' : PANTRY_WORDS.test(location) ? '▤' : /clean|schoonmaak|putz|nettoyage|limpieza|pulizia|limpeza|curățenie|sprzątan|temizlik|убор|清洁|掃除/i.test(location) ? '✦' : '⌂';
  const itemIcon = (item) => item.kind === 'Household' ? '🧽' : categoryIcons[ingredientRecord(item.name)?.category] || '◌';
  return `<div class="storage-map">${locations.map((location) => {
    const items = rows.filter((item) => item.location === location);
    return `<section class="storage-zone"><header class="storage-zone-heading"><span class="storage-zone-icon" aria-hidden="true">${locationIcon(location)}</span><div><h3>${escapeHtml(location)}</h3><span>${tp(items.length, '{count} item', '{count} items')}</span></div><span class="storage-zone-total">${items.length}</span></header>${items.length ? `<div class="storage-items">${items.map((item) => `<article class="visual-item"><span class="visual-item-icon" aria-hidden="true">${itemIcon(item)}</span><div class="visual-item-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(kindLabel(item.kind))}</small>${inventoryExpiryMarkup(item, 'small')}</div><div class="visual-quantity"><strong>${escapeHtml(item.quantity)}</strong><small>${escapeHtml(item.unit || t('items'))}</small></div><button class="row-edit" data-action="edit-item" data-id="${escapeHtml(item.id)}" aria-label="${t('Edit {name}', { name: escapeHtml(item.name) })}" title="${t('Edit item')}">•••</button></article>`).join('')}</div>` : `<p class="storage-zone-empty">${t('Nothing stored here yet')}</p>`}</section>`;
  }).join('')}</div>`;
}

function renderExpirationPanel() {
  const expiringItems = itemsNeedingExpiryAttention();
  if (!expiringItems.length) return '';
  const rows = expiringItems.map((item) => {
    const recipes = recipesUsingInventoryItem(item);
    const suggestions = recipes.length
      ? `<div class="expiry-suggestions"><span>${t('Try using it in')}</span>${recipes.slice(0, 2).map((recipe) => `<button class="text-button expiry-recipe-link" data-action="show-expiring-recipe" data-id="${escapeHtml(recipe.id)}">${escapeHtml(recipe.name)} <span aria-hidden="true">→</span></button>`).join('')}</div>`
      : `<span class="expiry-no-recipe">${t('No saved recipe uses this yet')}</span>`;
    return `<article class="expiry-row"><div class="expiry-item-info"><span class="expiry-mark" aria-hidden="true">!</span><div><strong>${escapeHtml(item.name)}</strong><span class="item-expiry ${expiryClass(item.expiresOn)}">${escapeHtml(expirationText(item))} · ${escapeHtml(item.quantity)} ${escapeHtml(item.unit || '')}</span></div></div>${suggestions}</article>`;
  }).join('');
  return `<section class="expiration-panel" aria-label="${t('Items nearing expiration')}"><header><div><span class="eyebrow">${t('USE SOON')}</span><h2>${tp(expiringItems.length, '{count} item nearing its date', '{count} items nearing their date')}</h2></div><span class="expiry-window">${tp(EXPIRY_WINDOW_DAYS, 'Past due + {count} day', 'Past due + {count} days')}</span></header><div class="expiry-list">${rows}</div></section>`;
}

function renderWeek() {
  const plans = currentWeekPlans();
  const weekEnd = dateAtOffset(6);
  const weekLabel = `${formatDate(weekStart, { month: 'short', day: 'numeric' })} – ${formatDate(weekEnd, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const dayButtons = Array.from({ length: 7 }, (_, index) => {
    const date = dateAtOffset(index);
    const key = dateKey(date);
    const count = plans.filter((entry) => entry.date === key).length;
    return `<button class="day-chip ${key === dateKey(selectedDate) ? 'selected' : ''}" data-action="select-date" data-date="${key}"><span>${formatDate(date, { weekday: 'short' }).toUpperCase()}</span><strong>${formatDate(date, { day: 'numeric' })}</strong>${count ? `<i>${tp(count, '{count} planned', '{count} planned')}</i>` : `<i>${t('Open day')}</i>`}</button>`;
  }).join('');
  const selectedPlans = plans.filter((entry) => entry.date === dateKey(selectedDate));
  const selectedLabel = formatDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' });
  const planned = selectedPlans.length ? selectedPlans.map((entry) => {
    const recipe = recipeById(entry.recipeId);
    if (!recipe) return '';
    const title = `<button class="mealie-link recipe-title-link" type="button" data-action="view-recipe" data-id="${escapeHtml(recipe.id)}" title="${t('Show recipe')}">${escapeHtml(recipe.name)} <span aria-hidden="true">→</span></button>`;
    return `<article class="planned-meal ${entry.cooked ? 'is-cooked' : ''}"><span class="meal-index">${entry.cooked ? '✓' : '01'}</span><div class="planned-copy"><strong>${title}</strong><span>${entry.cooked ? t('Cooked and confirmed') : tp(recipe.ingredients.length, '{count} ingredient', '{count} ingredients')}${planScale(entry) !== 1 ? ` · ${escapeHtml(scaleLabel(recipe, planScale(entry)))}` : ''}</span></div>${entry.cooked ? `<span class="cooked-label">${t('DONE')}</span>` : `<div class="planned-actions"><button class="button button-small button-dark steps-start" data-action="start-steps" data-id="${escapeHtml(recipe.id)}" data-plan="${escapeHtml(entry.id)}" title="${t('Cook it step by step')}">${t('Steps')} <span aria-hidden="true">▶</span></button><button class="button button-small button-quiet" data-action="review-plan" data-id="${escapeHtml(entry.id)}" title="${t('See what this needs and what you have')}">${t('Review')}</button><button class="button button-small button-outline" data-action="cook" data-id="${escapeHtml(entry.id)}" title="${t('Mark as cooked and remove the ingredients from stock')}">${t('Cooked')} <span aria-hidden="true">✓</span></button></div>`}<button class="icon-button remove-button" data-action="remove-plan" data-id="${escapeHtml(entry.id)}" aria-label="${t('Remove meal')}">×</button></article>`;
  }).join('') : `<div class="day-empty"><span aria-hidden="true">✳</span><p>${t('No meal planned for this day.')}</p><small>${t('Pick a recipe below to give the day a little shape.')}</small></div>`;
  const recipeOptions = [...state.recipes].sort((first, second) => missingIngredients(first).length - missingIngredients(second).length);
  return `${pageHeading(t('A GOOD WEEK STARTS HERE'), t('Make room for dinner.'), t('Plan meals at your own pace. Your list will follow along.'), `<button class="button button-outline" data-action="generate-shopping">${t('Build shopping list')} <span aria-hidden="true">↗</span></button>`)}
    <div class="week-navigation"><button class="icon-button" data-action="previous-week" aria-label="${t('Previous week')}" title="${t('Previous week')}">‹</button><label class="date-jump">${t('Jump to date')}<input id="week-date" type="date" value="${dateKey(selectedDate)}" aria-label="${t('Select a date')}" /></label><span class="week-range">${escapeHtml(weekLabel)}</span><button class="button button-quiet today-button" data-action="go-today">${t('Today')}</button><button class="icon-button" data-action="next-week" aria-label="${t('Next week')}" title="${t('Next week')}">›</button></div>
    <section class="week-planner"><div class="week-strip">${dayButtons}</div><div class="day-detail"><div class="section-heading"><div><span class="eyebrow">${t('YOUR PLAN')}</span><h2>${escapeHtml(selectedLabel)}</h2></div><span class="plan-count">${tp(selectedPlans.length, '{count} meal', '{count} meals')}</span></div><div class="planned-list">${planned}</div></div></section>
    <section class="section-block recipe-picker"><div class="section-heading"><div><span class="eyebrow">${t('PICK SOMETHING GOOD')}</span><h2>${t('Add a recipe to this day')}</h2></div><button class="text-button" data-view="recipes">${t('Browse all recipes')} <span aria-hidden="true">→</span></button></div><div class="picker-grid">${recipeOptions.slice(0, 3).map((recipe) => `<article class="picker-item"><span class="recipe-number">${tp(recipe.ingredients.length, '{count} INGREDIENT', '{count} INGREDIENTS', { count: String(recipe.ingredients.length).padStart(2, '0') })}</span><strong>${escapeHtml(recipe.name)}</strong><p>${escapeHtml(recipe.description || t('An idea from your recipe shelf.'))}</p><div class="picker-foot"><span class="match-tag ${missingIngredients(recipe).length ? 'has-missing' : ''}">${missingIngredients(recipe).length ? tp(missingIngredients(recipe).length, '{count} to pick up', '{count} to pick up') : t('Ready to make')}</span><button class="button button-small button-dark" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">${t('Add')} <span aria-hidden="true">＋</span></button></div></article>`).join('') || `<p class="muted">${t('Add recipes in your recipe library first.')}</p>`}</div></section>`;
}

// The shopping list in groups, roughly in the order of a supermarket walk: fresh produce first, things that need
// the fridge or freezer near the end. Anything the ingredient catalog does not know goes under Other.
const SHOPPING_GROUPS = ['Vegetables', 'Fruit', 'Herbs', 'Bakery', 'Pantry', 'Baking', 'Seasoning', 'Dairy', 'Meat and fish'];
N_('Other');

function shoppingGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const category = ingredientRecord(item.name)?.category;
    const key = SHOPPING_GROUPS.includes(category) ? category : 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...SHOPPING_GROUPS, 'Other'].filter((key) => groups.has(key)).map((key) => ({ key, items: groups.get(key) }));
}

function renderShopping() {
  const remaining = state.shopping.filter((item) => !item.checked).length;
  const row = (item) => `<article class="shopping-row ${item.checked ? 'checked' : ''}"><label class="check-wrap"><input type="checkbox" data-action="check-shopping" data-id="${escapeHtml(item.id)}" ${item.checked ? 'checked' : ''} /><span class="custom-check" aria-hidden="true"></span><span class="shopping-name">${escapeHtml(item.name)}</span></label><span class="shopping-amount">${escapeHtml(item.quantity || '')} ${escapeHtml(item.unit || '')}</span>${item.checked ? `<button class="button button-small button-outline putaway-button" data-action="put-away" data-id="${escapeHtml(item.id)}">${t('Put away')}</button>` : `<span class="shopping-source">${escapeHtml(item.source || t('Shopping list'))}</span>`}</article>`;
  const groups = shoppingGroups(state.shopping);
  const rows = groups.length > 1
    ? groups.map((group) => `<h3 class="shopping-group">${escapeHtml(t(group.key))} <span>${group.items.filter((item) => !item.checked).length || '✓'}</span></h3>${group.items.map(row).join('')}`).join('')
    : state.shopping.map(row).join('');
  const shareButton = STANDALONE
    ? `<button class="button button-outline" data-action="share-shopping-text">${t('Share list')} <span aria-hidden="true">↗</span></button>`
    : `<button class="button button-outline" data-action="show-shopping-qr">${t('Share to phone')} <span aria-hidden="true">▦</span></button>`;
  const actions = `<div class="shopping-heading-actions">${state.shopping.length ? shareButton : ''}<button class="button button-outline" data-action="generate-shopping">${t('Refresh from plan')} <span aria-hidden="true">↻</span></button></div>`;
  return `${pageHeading(t('OUT AND ABOUT'), t('The list, in hand.'), tp(remaining, '{count} thing left to pick up. Check off as you go.', '{count} things left to pick up. Check off as you go.'), actions)}
    <section class="section-block shopping-block"><div class="section-heading"><div><h2>${t('This week’s list')}</h2><span class="muted">${tp(state.shopping.length, '{count} item', '{count} items')}</span></div><div class="list-actions">${remaining ? `<button class="text-button" data-action="check-all">✓ ${t('Check all')}</button>` : ''}${state.shopping.some((item) => item.checked) ? `<button class="button button-small button-outline" data-action="put-all-away">${t('Put all away')}</button><button class="text-button" data-action="clear-checked">${t('Clear checked')}</button>` : ''}${state.shopping.length ? `<button class="text-button clear-list-button" data-action="clear-list">× ${t('Clear list')}</button>` : ''}</div></div>${rows ? `<div class="shopping-list">${rows}</div>` : `<div class="empty-state compact"><span class="empty-mark">☷</span><strong>${t('Your list is nice and clear.')}</strong><p>${t('Build it from the meals in your weekly plan.')}</p><button class="button button-primary" data-action="generate-shopping">${t('Build from this week')}</button></div>`}</section>`;
}

// Timers tab: one-tap presets, a custom timer, and every running timer (recipe timers included).
const BUILT_IN_TIMER_PRESETS = [
  { name: N_('Black tea'), seconds: 240, icon: '☕' },
  { name: N_('Green tea'), seconds: 150, icon: '🍵' },
  { name: N_('Herbal tea'), seconds: 360, icon: '🌿' },
  { name: N_('Soft-boiled egg'), seconds: 360, icon: '🥚' },
  { name: N_('Jammy egg'), seconds: 450, icon: '🥚' },
  { name: N_('Hard-boiled egg'), seconds: 600, icon: '🥚' },
  { name: N_('Pasta'), seconds: 600, icon: '🍝' },
  { name: N_('Rice'), seconds: 720, icon: '🍚' },
  { name: N_('French press'), seconds: 240, icon: '☕' },
  { name: N_('Frozen pizza'), seconds: 720, icon: '🍕' },
];

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (!minutes) return t('{seconds} sec', { seconds: rest });
  return rest ? t('{minutes} min {seconds} sec', { minutes, seconds: rest }) : t('{minutes} min', { minutes });
}

// Built-in presets are shown in the chosen language; saved presets keep the name they were given.
function timerPresetButton(preset, saved = false) {
  const name = saved ? preset.name : t(preset.name);
  const start = `<button class="timer-preset" type="button" data-action="timer-preset" data-name="${escapeHtml(name)}" data-seconds="${preset.seconds}"><span class="timer-preset-icon" aria-hidden="true">${escapeHtml(preset.icon || '⏱')}</span><strong>${escapeHtml(name)}</strong><small>${formatDuration(preset.seconds)}</small></button>`;
  return saved
    ? `<div class="timer-preset-saved">${start}<button class="timer-preset-remove" type="button" data-action="timer-preset-remove" data-id="${escapeHtml(preset.id)}" aria-label="${t('Remove {name} preset', { name: escapeHtml(name) })}">×</button></div>`
    : start;
}

// Tools tab: timers, a unit converter and cooking terms explained, as sub-tabs. The chosen sub-tab is remembered
// per browser.
const TOOLS_TAB_KEY = 'goodstock-tools-tab-v1';
const TOOLS_TABS = [['timers', N_('Timers')], ['convert', N_('Converter')], ['terms', N_('Cooking terms')]];
let toolsTab = (() => { try { return localStorage.getItem(TOOLS_TAB_KEY) || 'timers'; } catch { return 'timers'; } })();
const converterInput = { amount: '1', unit: 'cup', ingredient: 'flour' };
const temperatureInput = { value: '180', unit: 'c' };
let termsQuery = '';

function renderTools() {
  if (!TOOLS_TABS.some(([id]) => id === toolsTab)) toolsTab = 'timers';
  const subtitles = {
    timers: cookTimers.length ? tp(cookTimers.length, '{count} timer going. Tap one to stop it or add a minute.', '{count} timers going. Tap one to stop it or add a minute.') : t('Tea, eggs, pasta or anything else. Tap a preset or make your own.'),
    convert: t('Grams, cups, spoons and ounces, and oven temperatures, converted as you type.'),
    terms: t('What sauté, blanch or fold actually mean, in plain words, with a video.'),
  };
  const tabs = `<div class="inventory-mode-switch tools-tabs" role="tablist" aria-label="${t('Tools')}">${TOOLS_TABS.map(([id, label]) => `<button role="tab" class="${toolsTab === id ? 'active' : ''}" data-action="tools-tab" data-tab="${id}" aria-selected="${toolsTab === id}">${t(label)}</button>`).join('')}</div>`;
  const body = toolsTab === 'convert' ? renderConverter() : toolsTab === 'terms' ? renderCookingTerms() : renderTimers();
  return `${pageHeading(t('HANDY IN THE KITCHEN'), t('Kitchen tools.'), subtitles[toolsTab])}${tabs}${body}`;
}

// After the Tools page is on screen, fill in the live parts (converter results, term list).
function afterToolsRender() {
  if (toolsTab === 'convert') { updateConverter(); updateTemperature(); }
  if (toolsTab === 'terms') updateCookingTerms();
}

function renderConverter() {
  const unitOptions = (kind) => CONVERTER_UNITS.filter((unit) => unit.kind === kind).map((unit) => `<option value="${unit.id}" ${converterInput.unit === unit.id ? 'selected' : ''}>${escapeHtml(t(unit.label))}</option>`).join('');
  return `<section class="section-block converter">
      <div class="section-heading"><div><h2>${t('Amounts')}</h2><span class="muted">${t('Weight and volume')}</span></div></div>
      <div class="converter-form">
        <label>${t('Amount')}<input id="conv-amount" type="text" inputmode="decimal" value="${escapeHtml(converterInput.amount)}" autocomplete="off" /></label>
        <label>${t('Unit')}<select id="conv-unit"><optgroup label="${t('Weight')}">${unitOptions('mass')}</optgroup><optgroup label="${t('Volume')}">${unitOptions('volume')}</optgroup></select></label>
        <label>${t('Ingredient')} <span class="field-hint">${t('For weight ↔ volume')}</span><select id="conv-ingredient">${CONVERTER_INGREDIENTS.map((item) => `<option value="${item.id}" ${converterInput.ingredient === item.id ? 'selected' : ''}>${escapeHtml(t(item.label))}</option>`).join('')}</select></label>
      </div>
      <div class="converter-results" id="conv-results" aria-live="polite"></div>
    </section>
    <section class="section-block converter">
      <div class="section-heading"><div><h2>${t('Oven temperature')}</h2><span class="muted">${t('°C, °F and gas mark')}</span></div></div>
      <div class="converter-form">
        <label>${t('Temperature')}<input id="temp-value" type="text" inputmode="decimal" value="${escapeHtml(temperatureInput.value)}" autocomplete="off" /></label>
        <label>${t('Unit')}<select id="temp-unit"><option value="c" ${temperatureInput.unit === 'c' ? 'selected' : ''}>°C</option><option value="f" ${temperatureInput.unit === 'f' ? 'selected' : ''}>°F</option><option value="gas" ${temperatureInput.unit === 'gas' ? 'selected' : ''}>${t('Gas mark')}</option></select></label>
      </div>
      <div class="converter-results" id="temp-results" aria-live="polite"></div>
    </section>`;
}

// Spoon and cup amounts round to the nearest ⅛ and show as fractions; weights and millilitres as whole numbers.
function formatConverted(value, unitId) {
  if (!Number.isFinite(value)) return '–';
  if (['cup', 'tbsp', 'tsp'].includes(unitId)) return formatAmount(Math.round(value * 8) / 8 || 0.125, unitId === 'cup' ? 'cup' : unitId);
  if (['kg', 'l', 'lb', 'pint'].includes(unitId)) return String(Math.round(value * 100) / 100);
  if (['oz', 'floz', 'dl', 'cl'].includes(unitId) || value < 10) return String(Math.round(value * 10) / 10);
  return String(Math.round(value));
}

function updateConverter() {
  const results = $('#conv-results');
  if (!results) return;
  const amount = parseAmount(converterInput.amount.replace(',', '.'));
  const from = CONVERTER_UNITS.find((unit) => unit.id === converterInput.unit);
  const ingredient = CONVERTER_INGREDIENTS.find((item) => item.id === converterInput.ingredient) || CONVERTER_INGREDIENTS[0];
  if (!amount || !from) { results.innerHTML = `<p class="muted">${t('Type an amount, like 250, 1.5 or 1 1/2.')}</p>`; return; }
  const base = amount * from.factor;
  const other = from.kind === 'mass' ? 'volume' : 'mass';
  const otherBase = from.kind === 'mass' ? base / ingredient.density : base * ingredient.density;
  const card = (unit, value) => `<div class="converter-result ${unit.id === from.id ? 'is-source' : ''}"><strong>${formatConverted(value / unit.factor, unit.id)}</strong><span>${escapeHtml(t(unit.label))}</span></div>`;
  const group = (kind, value, title) => `<h3 class="converter-group">${title}</h3><div class="converter-grid">${CONVERTER_UNITS.filter((unit) => unit.kind === kind).map((unit) => card(unit, value)).join('')}</div>`;
  const label = escapeHtml(t(ingredient.label).toLowerCase());
  results.innerHTML = group(from.kind, base, from.kind === 'mass' ? t('Weight') : t('Volume'))
    + group(other, otherBase, `${other === 'mass' ? t('Weight of {ingredient}', { ingredient: label }) : t('Volume of {ingredient}', { ingredient: label })} <span class="muted">${t('(approximate)')}</span>`);
}

function updateTemperature() {
  const results = $('#temp-results');
  if (!results) return;
  const value = parseAmount(temperatureInput.value.replace(',', '.').replace(/[°\s]|gas/gi, ''));
  if (value === null || !Number.isFinite(value)) { results.innerHTML = `<p class="muted">${t('Type a temperature, like 180.')}</p>`; return; }
  let celsius = value;
  if (temperatureInput.unit === 'f') celsius = ((value - 32) * 5) / 9;
  if (temperatureInput.unit === 'gas') {
    const exact = GAS_MARKS.find(([mark]) => mark === value);
    celsius = exact ? exact[1] : 140 + (value - 1) * 12.5;
  }
  const gas = GAS_MARKS.reduce((best, entry) => (Math.abs(entry[1] - celsius) < Math.abs(best[1] - celsius) ? entry : best));
  const heat = celsius < 150 ? t('A very low oven.') : celsius < 170 ? t('A low oven.') : celsius < 190 ? t('A moderate oven.') : celsius < 210 ? t('A moderately hot oven.') : celsius < 235 ? t('A hot oven.') : t('A very hot oven.');
  const round5 = (number) => Math.round(number / 5) * 5;
  const gasLabel = gas[0] < 1 ? (gas[0] === 0.25 ? '¼' : '½') : String(gas[0]);
  results.innerHTML = `<div class="converter-grid">
      <div class="converter-result ${temperatureInput.unit === 'c' ? 'is-source' : ''}"><strong>${round5(celsius)} °C</strong><span>${t('Celsius')}</span></div>
      <div class="converter-result ${temperatureInput.unit === 'f' ? 'is-source' : ''}"><strong>${round5((celsius * 9) / 5 + 32)} °F</strong><span>${t('Fahrenheit')}</span></div>
      <div class="converter-result ${temperatureInput.unit === 'gas' ? 'is-source' : ''}"><strong>${t('Gas {mark}', { mark: gasLabel })}</strong><span>${t('Gas mark')}</span></div>
      <div class="converter-result"><strong>${round5(celsius - 20)} °C</strong><span>${t('Fan oven')}</span></div>
    </div><p class="converter-note">${heat} ${t('Fan (hot-air) ovens run hotter, so set them about 20 °C lower.')}</p>`;
}

function renderCookingTerms() {
  return `<section class="section-block cooking-terms">
      <form class="recipe-search terms-search" onsubmit="return false"><span aria-hidden="true">⌕</span><input id="terms-search" value="${escapeHtml(termsQuery)}" placeholder="${t('Search a term, like blanch or sudderen')}" aria-label="${t('Search cooking terms')}" autocomplete="off" /></form>
      <div class="terms-list" id="terms-list"></div>
    </section>`;
}

// Terms are written in English and Dutch. In another language the term's translated name leads, with the
// English one next to it, and the explanation is translated.
function updateCookingTerms() {
  const list = $('#terms-list');
  if (!list) return;
  const query = cleanIngredient(termsQuery);
  // Term names have their own "term: " keys, so the verb "Whisk" and the tool "Whisk" can differ.
  const local = (term) => {
    if (currentLanguage === 'nl') return term.nl;
    const name = t(`term: ${term.en}`);
    return name.indexOf('term: ') === 0 ? term.en : name;
  };
  const terms = COOKING_TERMS.filter((term) => !query || cleanIngredient(`${term.en} ${term.nl} ${local(term)} ${term.what} ${t(term.what)}`).includes(query));
  list.innerHTML = terms.length
    ? terms.map((term) => {
      const name = local(term) || term.en;
      const second = currentLanguage === 'en' ? term.nl : term.en;
      return `<article class="term-card"><h3>${escapeHtml(name)}${second && second !== name ? ` <span>${escapeHtml(second)}</span>` : ''}</h3><p>${escapeHtml(t(term.what))}</p><a class="button button-small button-outline" href="${escapeHtml(cookingTermVideoUrl(term, currentLanguage === 'en' ? '' : t('{term} cooking technique', { term: name.replace(/\s*[(（].*$/, '') })))}" target="_blank" rel="noopener noreferrer">▶ ${t('Watch a video')}</a></article>`;
    }).join('')
    : `<p class="muted">${t('No term matches that. Try another word.')}</p>`;
}

function renderTimers() {
  const running = cookTimers.length;
  const saved = state.timerPresets || [];
  return `<section class="section-block"><div class="section-heading"><div><h2>${t('Running')}</h2><span class="muted" id="timer-view-count">${running || t('None yet')}</span></div></div><div class="timer-list timer-view-list" id="timer-view-list"></div><p class="timer-view-empty" id="timer-view-empty"${running ? ' hidden' : ''}>${t('Nothing running. Start one below.')}</p></section>
    <section class="section-block"><div class="section-heading"><div><h2>${t('Quick start')}</h2><span class="muted">${t('One tap')}</span></div></div><div class="timer-presets">${saved.map((preset) => timerPresetButton(preset, true)).join('')}${BUILT_IN_TIMER_PRESETS.map((preset) => timerPresetButton(preset)).join('')}</div></section>
    <section class="section-block"><div class="section-heading"><div><h2>${t('Custom timer')}</h2></div></div>
      <form class="custom-timer-form" id="custom-timer-form">
        <label>${t("What's it for?")}<input name="name" placeholder="${t('e.g. Oat milk porridge')}" maxlength="40" autocomplete="off" /></label>
        <div class="custom-timer-time"><label>${t('Minutes')}<input name="minutes" type="number" min="0" max="999" step="1" value="5" inputmode="numeric" /></label><label>${t('Seconds')}<input name="seconds" type="number" min="0" max="59" step="1" value="0" inputmode="numeric" /></label></div>
        <label class="custom-timer-save"><input name="save" type="checkbox" /> ${t('Save as a quick-start preset')}</label>
        <button class="button button-primary" type="submit">${t('Start timer')} ⏱</button>
      </form>
    </section>`;
}

function startCustomTimer(name, seconds) {
  if (!(seconds > 0)) return;
  unlockAlarmAudio();
  cookTimers.push({ id: makeId(), recipe: null, name: name || t('Timer'), label: formatDuration(seconds), endsAt: Date.now() + seconds * 1000, done: false });
  if (!timerTickId) timerTickId = setInterval(refreshTimers, 1000);
  if (activeView === 'tools' && toolsTab === 'timers') render(); else refreshTimers();
}

function extendTimer(id, seconds = 60) {
  const timer = cookTimers.find((entry) => entry.id === id);
  if (!timer) return;
  timer.endsAt = timer.done ? Date.now() + seconds * 1000 : timer.endsAt + seconds * 1000;
  timer.done = false;
  if (!timerTickId) timerTickId = setInterval(refreshTimers, 1000);
  refreshTimers();
}

// Your own recipes: write one, import it from a recipe website, or paste its text. No Mealie needed.
function openRecipeEditor(recipe = null, { importFirst = false } = {}) {
  const form = $('#recipe-edit-form');
  form.reset();
  form.elements.recipeId.value = recipe?.id || '';
  form.elements.sourceUrl.value = recipe?.sourceUrl || '';
  form.elements.name.value = recipe?.name || '';
  form.elements.description.value = recipe?.description || '';
  form.elements.servings.value = recipe?.servings || '';
  form.elements.ingredients.value = (recipe?.ingredients || []).join('\n');
  form.elements.instructions.value = recipeInstructions(recipe || {}).join('\n');
  $('#recipe-edit-title').textContent = recipe ? t('Edit {name}', { name: recipe.name }) : t('New recipe');
  $('#recipe-edit-eyebrow').textContent = recipe ? t('EDIT RECIPE') : t('YOUR RECIPE');
  $('#recipe-import').hidden = Boolean(recipe);
  $('#recipe-import').open = importFirst;
  $('#recipe-import-status').textContent = '';
  $('#recipe-edit-dialog').showModal();
  (importFirst ? form.elements.importUrl : form.elements.name).focus();
}

// Splits pasted recipe text into name, ingredients and steps. Headings ("Ingredients", "Method", "Bereiding") help;
// without them, short lines that start with an amount count as ingredients and everything else as steps.
function parseRecipeText(text) {
  const ingredientHeading = /^(?:ingredients?|ingredi[eë]nten|you(?:'ll| will)? need|what you need|benodigdheden|zutaten|ingrédients|ingredientes|ingredienti|ingrediente|składniki|malzemeler|ингредиенты|材料|食材|用料)\s*[:：]?$/i;
  const stepHeading = /^(?:instructions?|directions?|method|steps?|preparation|how to make it|bereiding(?:swijze)?|werkwijze|zubereitung|préparation|instructions|preparación|elaboración|preparazione|procedimento|modo de preparo|preparo|mod de preparare|preparare|przygotowanie|sposób przygotowania|hazırlanışı|yapılışı|приготовление|способ приготовления|作り方|手順|做法|步骤)\s*[:：]?$/i;
  const clean = (line) => line.replace(/^(?:[-–•*▢☐□✓]\s*|(?:step\s*)?\d+[.)]\s+)/i, '').trim();
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasHeadings = lines.some((line) => ingredientHeading.test(line) || stepHeading.test(line));
  const result = { name: '', description: '', ingredients: [], instructions: [] };
  const before = [];
  let section = null;
  for (const line of lines) {
    if (ingredientHeading.test(line)) { section = 'ingredients'; continue; }
    if (stepHeading.test(line)) { section = 'instructions'; continue; }
    if (section) { result[section].push(clean(line)); continue; }
    if (!result.name) { result.name = line; continue; }
    before.push(line);
  }
  if (hasHeadings) {
    result.description = before.join(' ').slice(0, 400);
  } else {
    for (const line of before) {
      const looksLikeIngredient = line.length < 80 && !/[.!?]$/.test(line) && /^(?:[-–•*]\s*)?(?:[\d¼½¾⅓⅔⅛]|(?:a|an|one|two|three|pinch|handful|some)\b)/i.test(line);
      (looksLikeIngredient ? result.ingredients : result.instructions).push(clean(line));
    }
  }
  return result;
}

// Imported steps often arrive as one paragraph per step. Split them the way cook mode does: one sentence per step
// (very short sentences stay with the one before), keeping short heading lines like "Sauce" as they are.
function tidyImportedSteps(instructions = []) {
  return instructions
    .map((text) => String(text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap((text) => (isStepHeading(text) ? [text] : splitIntoBites(text)));
}

function fillRecipeEditor(recipe, message) {
  const form = $('#recipe-edit-form');
  if (recipe.name) form.elements.name.value = recipe.name;
  if (recipe.description) form.elements.description.value = recipe.description;
  if (recipe.servings) form.elements.servings.value = recipe.servings;
  if (recipe.ingredients?.length) form.elements.ingredients.value = recipe.ingredients.join('\n');
  if (recipe.instructions?.length) form.elements.instructions.value = recipe.instructions.join('\n');
  if (recipe.sourceUrl) form.elements.sourceUrl.value = recipe.sourceUrl;
  $('#recipe-import-status').textContent = message;
}

async function importRecipeFromUrl() {
  const form = $('#recipe-edit-form');
  const address = form.elements.importUrl.value.trim();
  const status = $('#recipe-import-status');
  if (!address) { form.elements.importUrl.focus(); return; }
  status.textContent = t('Fetching the recipe…');
  try {
    let result;
    if (STANDALONE) {
      // No server in the Android app: the phone fetches the page and the shared parser reads it here.
      if (!/^https?:\/\//i.test(address)) { status.textContent = t('Only http and https links can be imported.'); return; }
      const page = JSON.parse(await nativeCall('fetchPage', address));
      if (page.status >= 400) { status.textContent = t('The website refused the import (HTTP {status}). Some sites block this; copy the recipe text and paste it instead.', { status: page.status }); return; }
      result = window.GoodstockRecipeImport?.extractRecipeFromHtml(page.body, page.url || address);
      if (!result) { status.textContent = t(window.GoodstockRecipeImport?.NO_RECIPE_MESSAGE || N_('No recipe found on that page.')); return; }
    } else {
      const response = await fetch(`/api/recipes/import?url=${encodeURIComponent(address)}`);
      result = await response.json().catch(() => ({}));
      if (!response.ok) { status.textContent = serverError(result, N_('That recipe could not be imported.')).local; return; }
    }
    const host = (() => { try { return new URL(result.sourceUrl).hostname.replace(/^www\./, ''); } catch { return t('the website'); } })();
    result.instructions = tidyImportedSteps(result.instructions);
    fillRecipeEditor(result, t('Imported from {host}: {ingredients} ingredients, {steps} steps. Check it, then save.', { host, ingredients: result.ingredients.length, steps: result.instructions.length }));
  } catch (error) {
    if (STANDALONE) status.textContent = navigator.onLine ? (error?.message ? t('Could not load that page ({reason}).', { reason: error.message }) : t('Could not load that page.')) : t('You are offline. Paste the recipe text instead.');
    else status.textContent = navigator.onLine ? t('Could not reach the app server.') : t('You are offline. Paste the recipe text instead.');
  }
}

// The Android app has no server for the QR link, so the list goes to the Android share sheet instead.
function shareShoppingText() {
  const lines = state.shopping.filter((item) => !item.checked).map((item) => `☐ ${item.name}${item.quantity ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}`);
  if (!lines.length) return;
  const text = `${t('Shopping list')}\n${lines.join('\n')}`;
  try { nativeApp.share(text); } catch { /* Sharing is optional. */ }
}

function saveRecipeFromEditor(form) {
  const lines = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const existing = state.recipes.find((recipe) => recipe.id === form.elements.recipeId.value);
  const sourceUrl = form.elements.sourceUrl.value.trim();
  const recipe = metricRecipe({
    ...(existing || {}),
    id: existing?.id || `my-${makeId()}`,
    name: form.elements.name.value.trim(),
    description: form.elements.description.value.trim(),
    servings: Math.round(Number(form.elements.servings.value)) >= 1 ? Math.min(100, Math.round(Number(form.elements.servings.value))) : null,
    ingredients: lines(form.elements.ingredients.value),
    instructions: lines(form.elements.instructions.value),
    source: existing?.source || (sourceUrl ? 'Imported' : 'My recipes'),
    sourceUrl: sourceUrl || existing?.sourceUrl || '',
  });
  if (!recipe.name) return;
  if (existing) Object.assign(existing, recipe); else state.recipes.unshift(recipe);
  // Steps may have changed, so a saved cook-mode position no longer lines up.
  const progress = readCookProgress();
  delete progress[recipe.id];
  try { localStorage.setItem(COOK_PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Progress is a convenience only. */ }
  persist();
  $('#recipe-edit-dialog').close();
  if ($('#recipe-dialog').open) openRecipeDialog(recipe.id, false, recipeDialogPlanId);
  // Stay on the recipe's own page when editing from there; otherwise show the recipe list.
  if (activeView === 'recipe') recipePageId = recipe.id; else activeView = 'recipes';
  render();
}

// Undo instead of "are you sure?": the change happens straight away and an Undo bar stays for 10 seconds. Only the
// parts of the kitchen the change touched are put back, so what other devices did meanwhile stays.
const UNDO_SECONDS = 10;
let undoSnapshot = null;
let undoTimer = null;

function withUndo(message, keys, change) {
  const before = Object.fromEntries(keys.map((key) => [key, JSON.stringify(state[key])]));
  change();
  persist();
  undoSnapshot = before;
  clearTimeout(undoTimer);
  const bar = $('#undo-bar');
  bar.querySelector('span').textContent = message;
  bar.hidden = false;
  undoTimer = setTimeout(hideUndo, UNDO_SECONDS * 1000);
}

function hideUndo() {
  clearTimeout(undoTimer);
  undoSnapshot = null;
  $('#undo-bar').hidden = true;
}

function undoLastChange() {
  if (!undoSnapshot) return;
  for (const [key, value] of Object.entries(undoSnapshot)) state[key] = JSON.parse(value);
  hideUndo();
  persist();
}

function deleteRecipe(id) {
  const recipe = recipeById(id);
  if (!recipe) return;
  withUndo(t('Deleted “{name}”', { name: recipe.name }), ['recipes', 'plan'], () => {
    state.recipes = state.recipes.filter((entry) => entry.id !== recipe.id);
    state.plan = state.plan.filter((entry) => entry.recipeId !== recipe.id);
  });
  $('#recipe-dialog').close();
  render();
}

// A recipe as a normal page: ingredients with what is in stock, tools, and numbered steps with the amounts written
// in. Step by step (cook mode) is one button away.
function openRecipePage(id) {
  const recipe = recipeById(id);
  if (!recipe) return;
  recipePageId = recipe.id;
  activeView = 'recipe';
  if ($('#recipe-dialog').open) $('#recipe-dialog').close();
  render();
  window.scrollTo?.(0, 0);
  ensureMealieInstructions(recipe);
}

// Mealie recipes in the library may not have their steps yet; fetch them once, then show them.
const fetchingInstructions = new Set();
async function ensureMealieInstructions(recipe) {
  if (recipe.source !== 'Mealie' || !recipe.slug || Array.isArray(recipe.instructions) || fetchingInstructions.has(recipe.id)) return;
  fetchingInstructions.add(recipe.id);
  try {
    const details = metricRecipe(await mealieRecipe(recipe.slug));
    recipe.instructions = details.instructions || [];
    persist();
  } catch { /* Shown as "no steps" while Mealie is unreachable. */ } finally {
    fetchingInstructions.delete(recipe.id);
  }
}

function recipePageSteps(recipe) {
  const lines = recipeInstructions(recipe).map((text) => metricText(String(text).trim())).filter(Boolean);
  const steps = lines.map((text) => ({ heading: isStepHeading(text), text }));
  addStepAmounts(steps.filter((step) => !step.heading), recipe.ingredients || []);
  return { lines, steps };
}

// Where a recipe came from is stored in English ("Imported") and shown in the chosen language.
const SOURCE_LABELS = { 'My recipes': N_('My recipes'), Imported: N_('Imported'), Translated: N_('Translated'), 'Kitchen collection': N_('Kitchen collection'), 'Goodstock test': N_('Goodstock test') };
const sourceLabel = (source) => (SOURCE_LABELS[source || 'Kitchen collection'] ? t(SOURCE_LABELS[source || 'Kitchen collection']) : source);
const inStockText = (item) => (item ? t('in {location}', { location: escapeHtml(item.location) }) : t('not in inventory'));

function renderRecipePage() {
  const saved = recipeById(recipePageId);
  if (!saved) { activeView = 'recipes'; return renderRecipes(); }
  const factor = recipeScales.get(saved.id) || 1;
  const recipe = scaledRecipe(saved, factor);
  const ingredients = recipe.ingredients || [];
  const servingsControl = `<div class="servings-control" role="group" aria-label="${t('Servings')}"><button class="icon-button" type="button" data-action="scale-recipe" data-id="${escapeHtml(saved.id)}" data-step="-1" aria-label="${t('Fewer')}">−</button><span>${escapeHtml(scaleLabel(saved, factor))}</span><button class="icon-button" type="button" data-action="scale-recipe" data-id="${escapeHtml(saved.id)}" data-step="1" aria-label="${t('More')}">＋</button></div>`;
  const missing = missingIngredients(recipe);
  const { lines, steps } = recipePageSteps(recipe);
  const tools = typeof kitchenToolsIn === 'function' ? kitchenToolsIn(lines.join(' ')) : [];
  const planned = currentWeekPlans().some((entry) => entry.recipeId === recipe.id);
  const safeSourceUrl = /^https?:\/\//i.test(recipe.sourceUrl || '') ? recipe.sourceUrl : '';
  const actions = `<div class="recipe-page-actions">
      <button class="button button-primary" type="button" data-action="start-steps" data-id="${escapeHtml(recipe.id)}">${t('Step by step')} <span aria-hidden="true">▶</span></button>
      <button class="button ${planned ? 'button-outline' : 'button-dark'}" type="button" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">${planned ? t('Plan another day') : t('Plan this week')}</button>
    </div>`;
  const links = [
    safeSourceUrl ? `<a class="text-button" href="${escapeHtml(safeSourceUrl)}" target="_blank" rel="noopener noreferrer">${t('Original recipe')} ↗</a>` : '',
    mealieRecipeLink(recipe, 'text-button', t('Open in Mealie')),
    renderRecipeTranslation(recipe),
    `<button class="text-button" type="button" data-action="edit-recipe" data-id="${escapeHtml(recipe.id)}">${t('Edit')}</button>`,
    `<button class="text-button recipe-delete-button" type="button" data-action="delete-recipe" data-id="${escapeHtml(recipe.id)}">${t('Delete')}</button>`,
  ].filter(Boolean).join('');
  const ingredientList = ingredients.length
    ? `<ul class="recipe-ingredient-list recipe-page-ingredients">${ingredients.map((ingredient) => {
      const item = matchingInventory(ingredient);
      return `<li class="${item ? 'in-stock' : 'not-stocked'}"><span aria-hidden="true">${item ? '✓' : '○'}</span><span>${escapeHtml(ingredient)}</span><small>${inStockText(item)}</small></li>`;
    }).join('')}</ul>`
    : `<p class="muted">${t('No ingredients listed.')}</p>`;
  let number = 0;
  const method = steps.length
    ? `<div class="recipe-method">${steps.map((step) => (step.heading
      ? `<h3 class="recipe-method-heading">${escapeHtml(step.text)}</h3>`
      : `<div class="recipe-method-step"><span class="recipe-step-number" aria-hidden="true">${++number}</span><p>${highlightStepText(step.text)}</p></div>`)).join('')}</div>`
    : `<p class="muted">${recipe.source === 'Mealie' && !Array.isArray(recipe.instructions) ? t('Loading the steps from Mealie…') : t('No steps saved for this recipe yet. Add them with Edit.')}</p>`;
  const toolRow = tools.length ? `<ul class="steps-tools recipe-page-tools" aria-label="${t('Tools')}">${tools.map((tool) => `<li title="${escapeHtml(t(tool.description))}">${kitchenToolIcon(tool)}<span>${escapeHtml(t(tool.name))}</span></li>`).join('')}</ul>` : '';
  return `<button class="text-button recipe-back" type="button" data-action="back-to-recipes">‹ ${t('All recipes')}</button>
    ${pageHeading(escapeHtml(sourceLabel(recipe.source).toUpperCase()), escapeHtml(recipe.name), escapeHtml(recipe.description || ''), actions)}
    <div class="recipe-page-links">${links}</div>
    ${renderTranslationPanel(recipe)}
    <div class="recipe-page">
      <section class="section-block recipe-page-side"><div class="section-heading"><div><h2>${t('Ingredients')}</h2><span class="muted">${ingredients.length ? (missing.length ? tp(missing.length, '{count} missing', '{count} missing') : t('All in stock')) : ''}</span></div>${ingredients.length ? servingsControl : ''}</div>${ingredientList}</section>
      <section class="section-block recipe-page-main"><div class="section-heading"><div><h2>${t('Method')}</h2><span class="muted">${number ? tp(number, '{count} step', '{count} steps') : ''}</span></div></div>${toolRow}${method}</section>
    </div>`;
}

// Translating recipes between Dutch and English with DeepL. In the browser the server calls DeepL (it blocks
// direct browser calls and keeps the key); in the Android app the phone calls DeepL with the key saved on it.
// A translation is shown first and can then be saved as a new recipe, so the original stays as it was.
const DEEPL_PHONE_KEY = 'goodstock-deepl-v1';
let recipeTranslation = null; // { recipeId, target, loading, error, result }

function phoneDeeplKey() {
  try { return localStorage.getItem(DEEPL_PHONE_KEY) || ''; } catch { return ''; }
}

async function phoneDeepl(path, key, body) {
  const { deeplUrl, deeplHeaders, deeplErrorMessage, deeplErrorTemplate } = window.GoodstockDeepl;
  let response;
  try {
    const answer = body
      ? await nativeCall('httpSend', 'POST', deeplUrl(key, path), JSON.stringify(deeplHeaders(key)), JSON.stringify(body))
      : await nativeCall('httpRequest', deeplUrl(key, path), JSON.stringify(deeplHeaders(key)));
    response = JSON.parse(answer);
  } catch {
    throw new Error(N_('Could not reach DeepL. Check that the phone is online.'));
  }
  if (response.status >= 400) throw Object.assign(new Error(deeplErrorMessage(response.status)), { local: localMessage(deeplErrorTemplate(response.status)) });
  return JSON.parse(response.body);
}

async function translateTexts(texts, target, source = '') {
  if (STANDALONE) {
    const key = phoneDeeplKey();
    if (!key) throw new Error(N_('Add a DeepL API key in Settings to translate recipes.'));
    const { deeplChunks, deeplRequestBody } = window.GoodstockDeepl;
    const translated = [];
    for (const chunk of deeplChunks(texts)) {
      const result = await phoneDeepl('/translate', key, deeplRequestBody(chunk, target, source));
      translated.push(...(result.translations || []).map((entry) => entry.text));
    }
    return translated;
  }
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texts, target, source }),
  }).catch(() => { throw new Error(N_('Could not reach the app server.')); });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw serverError(result, N_('Translation failed.'));
  return result.texts || [];
}

// The recipe's language: saved on translated copies, otherwise judged by its script and common small words.
const RECIPE_LANGUAGE_WORDS = {
  en: /\s(?:the|and|of|with|add|until|minutes|into|to|your|salt|pepper|onion|eggs|milk|butter|in the)\s/g,
  nl: /\s(?:de|het|een|en|van|met|voeg|toe|snijd|bak|kook|minuten|tot|op|je|zout|peper|ui|eieren|melk|boter|in de)\s/g,
  de: /\s(?:der|die|das|und|mit|minuten|bis|ein|eine|den|dem|zugeben|salz|pfeffer|zwiebel|eier|milch|butter|im)\s/g,
  fr: /\s(?:le|la|les|et|du|des|avec|ajouter|ajoutez|minutes|jusqu'à|une|sel|poivre|oignon|oeufs|œufs|lait|beurre|dans)\s/g,
  es: /\s(?:el|la|los|las|y|del|con|añadir|añade|minutos|hasta|una|sal|pimienta|cebolla|huevos|leche|mantequilla|en el)\s/g,
  it: /\s(?:il|lo|la|gli|e|del|della|con|aggiungere|aggiungete|minuti|fino|una|sale|pepe|cipolla|uova|latte|burro|nel)\s/g,
  pt: /\s(?:o|os|as|e|do|da|com|adicione|minutos|até|uma|sal|pimenta|cebola|ovos|leite|manteiga|no)\s/g,
  ro: /\s(?:și|cu|în|de|la|pe|minute|adaugă|sare|piper|ceapă|ouă|lapte|unt|până)\s/g,
  pl: /\s(?:i|z|w|na|do|się|minut|dodaj|sól|pieprz|cebula|jajka|mleko|masło|aż)\s/g,
  tr: /\s(?:ve|ile|bir|için|dakika|ekle|ekleyin|tuz|biber|soğan|yumurta|süt|tereyağı|kadar)\s/g,
};

function recipeLanguage(recipe) {
  if (recipe.language && LANGUAGES.some((language) => language.code === recipe.language)) return recipe.language;
  return textLanguage([recipe.name, recipe.description, ...(recipe.ingredients || []), ...recipeInstructions(recipe)].join(' '));
}

function textLanguage(value) {
  const text = ` ${String(value || '').toLowerCase()} `;
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[一-鿿]/.test(text)) return 'zh';
  if (/[Ѐ-ӿ]/.test(text)) return 'ru';
  let best = 'en';
  let bestCount = 0;
  for (const code of Object.keys(RECIPE_LANGUAGE_WORDS)) {
    const count = (text.match(RECIPE_LANGUAGE_WORDS[code]) || []).length;
    if (count > bestCount) { best = code; bestCount = count; }
  }
  return best;
}

// One tap translates into the app's language. A recipe already in that language can go between English and Dutch,
// as before, when the app is set to one of those.
function recipeTranslationTarget(recipe) {
  const source = recipeLanguage(recipe);
  if (source !== currentLanguage) return currentLanguage;
  if (source === 'en') return 'nl';
  if (source === 'nl') return 'en';
  return '';
}

async function startRecipeTranslation(id) {
  const recipe = recipeById(id);
  if (!recipe) return;
  const source = recipeLanguage(recipe);
  const target = recipeTranslationTarget(recipe);
  if (!target) return;
  const ingredients = recipe.ingredients || [];
  const steps = recipeInstructions(recipe).map((text) => String(text).trim()).filter(Boolean);
  const texts = [recipe.name, recipe.description || '', ...ingredients, ...steps];
  recipeTranslation = { recipeId: recipe.id, target, loading: true };
  render();
  try {
    const translated = await translateTexts(texts, target, source);
    if (translated.length !== texts.length) throw new Error(t('DeepL returned an incomplete translation.'));
    recipeTranslation = {
      recipeId: recipe.id,
      target,
      result: {
        name: translated[0],
        description: translated[1],
        ingredients: translated.slice(2, 2 + ingredients.length),
        instructions: translated.slice(2 + ingredients.length),
      },
    };
  } catch (error) {
    const message = error?.message || N_('Translation failed.');
    recipeTranslation = { recipeId: recipe.id, target, error: errorText(error, message), needsKey: /API key|DeepL API/.test(message) };
  }
  if (activeView === 'recipe' && recipePageId === recipe.id) render();
}

function saveRecipeTranslation() {
  const original = recipeById(recipeTranslation?.recipeId);
  const result = recipeTranslation?.result;
  if (!original || !result) return;
  const copy = metricRecipe({
    id: `my-${makeId()}`,
    name: result.name || original.name,
    description: result.description || '',
    ingredients: result.ingredients,
    instructions: result.instructions,
    source: 'Translated',
    sourceUrl: original.sourceUrl || '',
    language: recipeTranslation.target,
    translatedFrom: original.id,
  });
  state.recipes.unshift(copy);
  recipeTranslation = null;
  persist();
  openRecipePage(copy.id);
}

function renderRecipeTranslation(recipe) {
  const target = recipeTranslationTarget(recipe);
  const current = recipeTranslation?.recipeId === recipe.id ? recipeTranslation : null;
  if (!current && target) {
    return `<button class="text-button" type="button" data-action="translate-recipe" data-id="${escapeHtml(recipe.id)}">${t('Translate to {language}', { language: escapeHtml(languageName(target)) })} ⇄</button>`;
  }
  return '';
}

function renderTranslationPanel(recipe) {
  const current = recipeTranslation?.recipeId === recipe.id ? recipeTranslation : null;
  if (!current) return '';
  const label = escapeHtml(languageName(current.target));
  if (current.loading) return `<section class="translation-panel"><p class="translation-status">${t('Translating to {language}…', { language: label })}</p></section>`;
  if (current.error) {
    return `<section class="translation-panel is-error"><p class="translation-status">${escapeHtml(current.error)}</p><div class="translation-actions">${current.needsKey ?`<button class="button button-small button-outline" type="button" data-action="deepl-help">${t('How to get a key')}</button><button class="button button-small button-outline" type="button" data-action="open-settings" data-open="deepl-settings">${t('Open Settings')}</button>` : ''}<button class="button button-small button-outline" type="button" data-action="translate-recipe" data-id="${escapeHtml(recipe.id)}">${t('Try again')}</button><button class="button button-small button-quiet" type="button" data-action="translation-discard">${t('Close')}</button></div></section>`;
  }
  const { name, description, ingredients, instructions } = current.result;
  let number = 0;
  return `<section class="translation-panel">
      <div class="translation-heading"><span class="eyebrow">${t('TRANSLATION')} · ${label.toUpperCase()}</span><div class="translation-actions"><button class="button button-small button-primary" type="button" data-action="translation-save">${t('Save as a new recipe')}</button><button class="button button-small button-quiet" type="button" data-action="translation-discard">${t('Discard')}</button></div></div>
      <h2>${escapeHtml(name)}</h2>
      ${description ? `<p class="muted">${escapeHtml(description)}</p>` : ''}
      <div class="translation-columns">
        <div><h3>${t('Ingredients')}</h3><ul>${ingredients.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></div>
        <div><h3>${t('Method')}</h3>${instructions.map((line) => (isStepHeading(line) ? `<h4>${escapeHtml(line)}</h4>` : `<p><b>${++number}.</b> ${escapeHtml(line)}</p>`)).join('')}</div>
      </div>
      <p class="field-hint">${t('Translated by DeepL. Amounts and steps keep their order; check it, then save it as a new recipe. The original stays as it is.')}</p>
    </section>`;
}

// Settings: the DeepL key, tested before it is saved.
function setDeeplNote(text, kind = '') {
  const note = $('#deepl-note');
  note.textContent = text;
  note.className = `settings-note${kind ? ` is-${kind}` : ''}`;
}

async function loadDeeplSettings() {
  const form = $('#settings-form');
  form.elements.deeplKey.value = '';
  if (STANDALONE) {
    const key = phoneDeeplKey();
    form.elements.deeplKey.placeholder = key ? t('Saved. Leave empty to keep it.') : t('Paste your DeepL API key');
    $('#deepl-disconnect').hidden = !key;
    setDeeplNote(key ? t('Connected. Recipes can be translated into your language.') : t('Not set up. Needed to translate recipes.'), key ? 'connected' : '');
    return;
  }
  try {
    const status = await (await fetch('/api/translate/status')).json();
    form.elements.deeplKey.placeholder = status.configured ? t('Saved. Leave empty to keep it.') : t('Paste your DeepL API key');
    $('#deepl-disconnect').hidden = status.source !== 'settings';
    setDeeplNote(status.configured ? connectedText(deeplUsage(status.usage), status.source === 'environment') : t('Not set up. Needed to translate recipes.'), status.configured ? 'connected' : '');
  } catch {
    setDeeplNote(t('Translation status is unavailable while offline.'));
  }
}

async function saveDeeplSettings() {
  const form = $('#settings-form');
  const apiKey = form.elements.deeplKey.value.trim();
  if (!apiKey) { setDeeplNote(t('Paste your DeepL API key first.'), 'error'); form.elements.deeplKey.focus(); return; }
  setDeeplNote(t('Testing the key…'));
  try {
    let usage = '';
    if (STANDALONE) {
      usage = window.GoodstockDeepl.deeplUsageText(await phoneDeepl('/usage', apiKey));
      localStorage.setItem(DEEPL_PHONE_KEY, apiKey);
    } else {
      const response = await fetch('/api/translate/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw serverError(result, N_('Could not save the DeepL key.'));
      usage = result.usage || '';
    }
    await loadDeeplSettings();
    setDeeplNote(connectedText(deeplUsage(usage)), 'connected');
    // A "no key" error on the recipe page no longer applies.
    if (recipeTranslation?.error) { recipeTranslation = null; render(); }
  } catch (error) {
    setDeeplNote(errorText(error, 'Could not save the DeepL key.'), 'error');
  }
}

// "Connected: 1,234 of 500,000 characters used this month (set in Portainer)." in the chosen language.
function deeplUsage(text) {
  const match = /^([\d,.\s]+) of ([\d,.\s]+) characters used this month$/.exec(String(text || ''));
  return match ? t('{used} of {limit} characters used this month', { used: match[1], limit: match[2] }) : String(text || '');
}

function connectedText(detail, fromEnvironment = false) {
  const text = detail ? t('Connected: {detail}', { detail }) : t('Connected');
  return `${text}${fromEnvironment ? ` ${t('(set in Portainer)')}` : ''}.`;
}

async function disconnectDeepl() {
  if (!window.confirm(t('Remove the DeepL key? Recipes you already translated stay.'))) return;
  if (STANDALONE) localStorage.removeItem(DEEPL_PHONE_KEY);
  else await fetch('/api/translate/config', { method: 'DELETE' }).catch(() => {});
  await loadDeeplSettings();
}

function recipeCard(recipe, isRemote = false) {
  const missing = missingIngredients(recipe);
  const status = missing.length === 0 ? t('You have everything') : tp(missing.length, '{count} missing: {items}', '{count} missing: {items}', { items: `${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}` });
  const planned = currentWeekPlans().some((entry) => entry.recipeId === recipe.id);
  const button = isRemote
    ? `<button class="button button-small button-dark" data-action="import-recipe" data-id="${escapeHtml(recipe.slug || recipe.id)}">${t('Add to library')} <span aria-hidden="true">＋</span></button>`
    : `<button class="button button-small ${planned ? 'button-outline' : 'button-dark'}" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">${planned ? t('Plan another day') : t('Plan this week')} <span aria-hidden="true">→</span></button>`;
  return `<article class="recipe-card"><div class="recipe-card-top"><span class="recipe-source">${escapeHtml(sourceLabel(recipe.source))}</span><span class="recipe-ingredient-count">${tp(recipe.ingredients?.length || 0, '{count} INGREDIENT', '{count} INGREDIENTS')}</span></div><h3><button class="recipe-title-link recipe-card-title" type="button" data-action="view-recipe" data-id="${escapeHtml(isRemote ? recipe.slug || recipe.id : recipe.id)}" data-remote="${isRemote}" title="${t('Show recipe')}">${escapeHtml(recipe.name)}</button></h3><p>${escapeHtml(recipe.description || t('A recipe from your collection.'))}</p><div class="recipe-missing ${missing.length ? 'has-missing' : ''}"><span aria-hidden="true">${missing.length ? '◷' : '✓'}</span>${escapeHtml(status)}</div><div class="recipe-card-bottom">${button}</div></article>`;
}

function renderRecipes() {
  const localRecipes = state.recipes.filter((recipe) => `${recipe.name} ${recipe.description || ''} ${(recipe.ingredients || []).join(' ')}`.toLowerCase().includes(recipeQuery.toLowerCase()));
  const sorted = [...localRecipes].sort((first, second) => missingIngredients(first).length - missingIngredients(second).length);
  const actions = `<div class="recipe-heading-actions"><button class="button button-primary" data-action="new-recipe">＋ ${t('New recipe')}</button><button class="button button-outline" data-action="open-recipe-import">${t('Import')} <span aria-hidden="true">↓</span></button></div>`;
  return `${pageHeading(t('FROM YOUR SHELF'), t('What sounds good?'), t('Find something to make with what you have, or a few things you could grab.'), actions)}
    <form class="recipe-search" id="recipe-search-form"><span aria-hidden="true">⌕</span><input id="recipe-search" value="${escapeHtml(recipeQuery)}" placeholder="${t('Search recipes or ingredients')}" aria-label="${t('Search recipes or ingredients')}"/><button class="button button-primary" type="submit">${t('Search')}</button></form>
    ${renderIdeas()}
    ${mealieConfigured ? `<button class="button button-outline stock-search-button" data-action="search-stocked">${t('Find with my inventory')} <span aria-hidden="true">↗</span></button>` : ''}
    <div class="recipe-results-heading"><div><span class="eyebrow">${t('YOUR RECIPE BOX')}</span><h2>${t('Closest to ready')}</h2></div><span class="muted">${tp(sorted.length, '{count} recipe', '{count} recipes')}</span></div>
    <div class="recipe-grid">${sorted.length ? sorted.map((recipe) => recipeCard(recipe)).join('') : `<p class="muted">${t('No recipes match that search.')}</p>`}</div>
    ${mealieConfigured ? `<div class="recipe-results-heading remote-heading"><div><span class="eyebrow">${t('MEALIE LIBRARY')}</span><h2>${mealieResults.length ? t('From Mealie') : t('Search your recipes')}</h2></div><span class="muted">${t('Connected')}</span></div><div class="recipe-grid">${mealieResults.map((recipe) => recipeCard(recipe, true)).join('')}</div>` : `<div class="integration-note"><span class="integration-mark">M</span><p><strong>${t('Already using Mealie?')}</strong><br/>${t('Connect it in Settings to search and import your recipe library here.')}</p><button class="button button-small button-outline" type="button" data-action="open-settings" data-open="mealie-settings">${t('Connect')}</button></div>`}`;
}

function fillLocationSelect(select, selected) {
  select.innerHTML = state.locations.map((location) => `<option value="${escapeHtml(location)}" ${location === selected ? 'selected' : ''}>${escapeHtml(location)}</option>`).join('');
}

// Product barcodes. Open Food Facts (a free, open product database) gives the name, in the app's language when it has
// it, and the pack size. Phone apps ask it straight from the phone; the browser version through the server. The
// phone apps scan with the camera; Chrome on a phone can too (BarcodeDetector, needs HTTPS); and everywhere a
// barcode number typed or pasted into the name field is looked up.
const OPEN_FOOD_FACTS_FIELDS = ['product_name', 'generic_name', 'quantity', ...LANGUAGES.map((language) => `product_name_${language.code}`)].join(',');
const BARCODE = /^\d{8}$|^\d{12,14}$/;

async function lookupBarcode(code) {
  let data = null;
  if (STANDALONE) {
    const answer = JSON.parse(await nativeCall('httpRequest', `https://world.openfoodfacts.org/api/v2/product/${code}?fields=${OPEN_FOOD_FACTS_FIELDS}`,
      JSON.stringify({ accept: 'application/json', 'user-agent': 'Goodstock/2 (home kitchen inventory app)' })));
    data = answer.status === 200 ? JSON.parse(answer.body || 'null') : null;
  } else {
    const response = await fetch(`/api/product/${code}?fields=${OPEN_FOOD_FACTS_FIELDS}`);
    if (response.status === 502) throw new Error('unreachable');
    data = response.ok ? await response.json() : null;
  }
  const product = data && data.status === 1 ? data.product : null;
  if (!product) return null;
  const name = String(product[`product_name_${currentLanguage}`] || product.product_name || product.product_name_en || product.generic_name || '').trim();
  if (!name) return null;
  // "500 g", "1 L", "6 x 1,5 l": the first amount and unit, when they make sense.
  const size = parseIngredient(`${String(product.quantity || '').replace(/^\d+\s*[x×]\s*/i, '')} pack`);
  return { name, amount: size.amount && size.unit ? size.amount : null, unit: size.amount && size.unit ? size.unitText : '' };
}

async function fillFromBarcode(code) {
  const form = $('#item-form');
  const status = $('#barcode-status');
  status.textContent = t('Looking up the product…');
  try {
    const product = await lookupBarcode(code);
    if (!product) {
      status.textContent = t('Product not found. Type its name.');
      if (form.elements.name.value === code) form.elements.name.value = '';
      return;
    }
    form.elements.name.value = product.name;
    if (product.amount) { form.elements.quantity.value = product.amount; form.elements.unit.value = product.unit; }
    status.textContent = t('Found: {name}', { name: product.name });
    updateExpirationSuggestion(form.elements.name.value, form.elements.location.value, form.elements.expiresOn, $('#expiry-estimate-note'));
  } catch {
    status.textContent = t('Could not look up the barcode. Type the name instead.');
  }
}

function canScanBarcodes() {
  if (STANDALONE) { try { return Boolean(nativeApp.canScanBarcodes && nativeApp.canScanBarcodes()); } catch { return false; } }
  return 'BarcodeDetector' in window && Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
}

async function scanBarcode() {
  const status = $('#barcode-status');
  try {
    const code = STANDALONE ? await nativeCall('scanBarcode') : await scanBarcodeInPage();
    if (code && BARCODE.test(code)) await fillFromBarcode(code);
    else if (code) status.textContent = t('That is not a product barcode.');
  } catch (error) {
    status.textContent = error?.message === 'cancelled' ? '' : t('The camera could not scan. Type the name or the barcode number instead.');
  }
}

// Chrome on Android (over HTTPS): the camera in a dialog, read with the browser's BarcodeDetector.
function scanBarcodeInPage() {
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog barcode-dialog';
    dialog.innerHTML = `<video playsinline muted></video><p class="dialog-copy">${t('Point the camera at the barcode')}</p><div class="dialog-actions"><button class="button button-quiet" type="button">${t('Cancel')}</button></div>`;
    document.body.append(dialog);
    const video = dialog.querySelector('video');
    let stream = null;
    let done = false;
    const finish = (error, code) => {
      if (done) return;
      done = true;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      dialog.close();
      dialog.remove();
      if (error) reject(error); else resolve(code);
    };
    dialog.querySelector('button').addEventListener('click', () => finish(new Error('cancelled')));
    dialog.addEventListener('cancel', () => finish(new Error('cancelled')));
    dialog.showModal();
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((camera) => {
      stream = camera;
      video.srcObject = camera;
      return video.play();
    }).then(() => {
      const look = () => {
        if (done) return;
        detector.detect(video).then((codes) => (codes.length ? finish(null, codes[0].rawValue) : setTimeout(look, 250))).catch(() => setTimeout(look, 500));
      };
      look();
    }).catch((error) => finish(error));
  });
}

function openItemDialog(item) {
  const dialog = $('#item-dialog');
  const form = $('#item-form');
  $('#scan-barcode-button').hidden = Boolean(item) || !canScanBarcodes();
  $('#barcode-status').textContent = '';
  $('#item-dialog-title').textContent = item ? t('Edit item') : t('Add an item');
  form.elements.id.value = item?.id || '';
  form.elements.name.value = item?.name || '';
  form.elements.quantity.value = item?.quantity ?? 1;
  form.elements.unit.value = item?.unit || '';
  form.elements.expiresOn.value = item?.expiresOn || '';
  form.elements.expiresOn.dataset.estimated = item?.expirationSource === 'estimated' ? 'true' : 'false';
  form.elements.kind.value = item?.kind || 'Food';
  fillLocationSelect(form.elements.location, item?.location || state.locations[0]);
  if (item?.expiresOn) {
    $('#expiry-estimate-note').textContent = item.expirationSource === 'estimated' ? t('Approximate estimate based on storage and typical shelf life. Check the package date.') : t('Using your chosen package date.');
  } else {
    updateExpirationSuggestion(form.elements.name.value, form.elements.location.value, form.elements.expiresOn, $('#expiry-estimate-note'));
  }
  dialog.showModal();
  form.elements.name.focus();
}

function openCookDialog(plan) {
  const recipe = scaledRecipe(recipeById(plan.recipeId), planScale(plan));
  if (!recipe) return;
  $('#cook-title').textContent = t('Cooked {name}?', { name: recipe.name });
  $('#cook-form').elements.planId.value = plan.id;
  $('#cook-ingredients').innerHTML = recipe.ingredients.map((ingredient, index) => {
    const item = matchingInventory(ingredient);
    const amount = item ? `<span class="cook-amount"><span>${t('Remove')}</span><input type="number" name="amount-${index}" min="0" step="any" value="${Math.round(Math.min(deductionAmount(ingredient, item), Number(item.quantity)) * 100) / 100}" inputmode="decimal" aria-label="${t('Amount of {name} to remove', { name: escapeHtml(item.name) })}"><span>${escapeHtml(item.unit || t('pcs'))} <i>${t('of {quantity}', { quantity: escapeHtml(item.quantity) })}</i></span></span>` : '';
    return `<label class="ingredient-check cook-check ${item ? '' : 'not-stocked'}"><input type="checkbox" name="ingredient" value="${index}" ${item ? 'checked' : ''}><span class="custom-check" aria-hidden="true"></span><span>${escapeHtml(ingredient)}</span><small>${inStockText(item)}</small>${amount}</label>`;
  }).join('');
  $('#cook-dialog').showModal();
}

function mealieRecipeLink(recipe, className, label) {
  const href = recipe.source === 'Mealie' && recipe.slug ? mealieOpenUrl(recipe.slug) : '';
  return href
    ? `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${t('Open recipe in Mealie')}">${label} <span aria-hidden="true">↗</span></a>`
    : '';
}

async function openRecipeDialog(id, isRemote, planId = '') {
  let recipe = isRemote ? mealieResults.find((entry) => entry.id === id || entry.slug === id) : recipeById(id);
  if (!recipe) return;
  if (planId) recipe = scaledRecipe(recipe, planScale(state.plan.find((entry) => entry.id === planId)));
  if (isRemote && !recipe.ingredients?.length && recipe.slug) {
    try {
      recipe = metricRecipe(await mealieRecipe(recipe.slug));
    } catch { /* Show the search-result details when Mealie is unavailable. */ }
  }
  $('#recipe-dialog-source').textContent = sourceLabel(recipe.source).toUpperCase();
  $('#recipe-dialog-title').textContent = recipe.name;
  $('#recipe-dialog-description').textContent = recipe.description || '';
  $('#recipe-dialog-description').hidden = !recipe.description;
  const ingredients = recipe.ingredients || [];
  $('#recipe-dialog-ingredients').innerHTML = ingredients.length
    ? ingredients.map((ingredient) => {
      const item = matchingInventory(ingredient);
      return `<li class="${item ? 'in-stock' : 'not-stocked'}"><span aria-hidden="true">${item ? '✓' : '○'}</span><span>${escapeHtml(ingredient)}</span><small>${inStockText(item)}</small></li>`;
    }).join('')
    : `<li class="not-stocked"><span></span><span>${t('No ingredients listed.')}</span></li>`;
  const planAction = planId
    ? ''
    : isRemote
      ? `<button class="button button-primary" type="button" data-action="import-recipe" data-id="${escapeHtml(recipe.slug || recipe.id)}">${t('Add to library')}</button>`
      : `<button class="button button-primary" type="button" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">${t('Plan this week')}</button>`;
  if (planId) {
    const missing = missingIngredients(recipe).length;
    $('#recipe-dialog-source').textContent = `${t('REVIEW')} · ${missing ? tp(missing, '{count} MISSING', '{count} MISSING') : t('ALL IN STOCK')}`;
  }
  recipeDialogRecipe = recipe;
  recipeDialogPlanId = planId;
  const safeSourceUrl = /^https?:\/\//i.test(recipe.sourceUrl || '') ? recipe.sourceUrl : '';
  const manage = isRemote ? '' : `<button class="button button-quiet" type="button" data-action="view-recipe" data-id="${escapeHtml(recipe.id)}">${t('Full recipe')}</button><button class="button button-quiet" type="button" data-action="edit-recipe" data-id="${escapeHtml(recipe.id)}">${t('Edit')}</button><button class="button button-quiet recipe-delete-button" type="button" data-action="delete-recipe" data-id="${escapeHtml(recipe.id)}">${t('Delete')}</button>`;
  const original = safeSourceUrl ? `<a class="button button-quiet" href="${escapeHtml(safeSourceUrl)}" target="_blank" rel="noopener noreferrer">${t('Original')} <span aria-hidden="true">↗</span></a>` : '';
  $('#recipe-dialog-actions').innerHTML = `${manage}${original}${mealieRecipeLink(recipe, 'button button-quiet mealie-button', t('Open in Mealie'))}<button class="button button-outline" type="button" data-action="start-steps" data-source="recipe-dialog">${t('Step by step')} <span aria-hidden="true">▶</span></button>${planAction}`;
  const dialog = $('#recipe-dialog');
  if (!dialog.open) dialog.showModal();
}
