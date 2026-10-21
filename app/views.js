// Goodstock, part 3 of 6: preferences (text size, theme, language), start-up, and the pages: inventory, week,
// shopping and tools, undo, the item and cook dialogs, and barcodes. Recipes are in part 4 (app/recipes.js).
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

// Suggestions when adding an item: the name in the app's language and the English one, each labelled with the other
// name and the category.
function fillIngredientOptions() {
  const options = $('#ingredient-options');
  if (!options) return;
  options.innerHTML = ingredientCatalog.flatMap((ingredient) => {
    const category = escapeHtml(t(ingredient.category || ''));
    const local = catalogNames(ingredient, currentLanguage)[0];
    const names = [...new Set([local, ingredient.en].filter(Boolean))];
    return names.map((name) => {
      const other = name === ingredient.en ? (local !== name ? local : '') : ingredient.en;
      return `<option value="${escapeHtml(name)}" label="${other ? `${escapeHtml(other)} · ` : ''}${category}"></option>`;
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
  // A device that hosts the kitchen starts its server again before connecting to it.
  if (hosting()) {
    try { await startHosting(true); } catch { /* Shown as offline; Settings can stop hosting. */ }
  }
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
  checkForUpdates();
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
  mirrorArrows($('#view-container'));
  renderKitchenScreen();
  updateSyncStatus(navigator.onLine ? (localStorage.getItem(PENDING_KEY) ? 'pending' : 'online') : 'offline');
}

// Right-to-left languages: arrows that point "forward" (→, ↗) point the other way. ‹ › and brackets are mirrored by
// the browser itself. Recipe text is left alone.
const MIRRORED_ARROWS = { '→': '←', '←': '→', '↗': '↖', '↖': '↗' };
function mirrorArrows(root) {
  if (document.documentElement.dir !== 'rtl' || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (/[→←↗↖]/.test(node.nodeValue) && !node.parentElement.closest('.recipe-method, .recipe-page-ingredients, .term-card p')) node.nodeValue = node.nodeValue.replace(/[→←↗↖]/g, (arrow) => MIRRORED_ARROWS[arrow]);
  }
}

// Kitchen screen (0.46): for a tablet on the wall or the counter, read from across the room. Only the big things:
// the time, today's meals, running timers, what to use soon and the shopping count, in large type. The screen stays
// on, dims between 22:00 and 6:00 (a tap brightens it for a minute), and comes back after a restart on this device.
const KITCHEN_SCREEN_KEY = 'goodstock-kitchen-screen';
let kitchenScreenTick = null;
let kitchenScreenAwakeUntil = 0;

function openKitchenScreen() {
  $('#kitchen-screen').hidden = false;
  document.body.classList.add('kitchen-screen-open');
  try { localStorage.setItem(KITCHEN_SCREEN_KEY, '1'); } catch { /* Only remembered where storage works. */ }
  keepScreenOn(true);
  renderKitchenScreen();
}

function closeKitchenScreen() {
  $('#kitchen-screen').hidden = true;
  document.body.classList.remove('kitchen-screen-open');
  try { localStorage.removeItem(KITCHEN_SCREEN_KEY); } catch { /* See openKitchenScreen. */ }
  clearTimeout(kitchenScreenTick);
  // Cook mode keeps the screen on by itself.
  if (!$('#steps-dialog')?.open) keepScreenOn(false);
}

function kitchenScreenRemembered() {
  try { return localStorage.getItem(KITCHEN_SCREEN_KEY) === '1'; } catch { return false; }
}

function renderKitchenScreen() {
  const screen = $('#kitchen-screen');
  if (!screen || screen.hidden) return;
  clearTimeout(kitchenScreenTick);
  const now = new Date();
  const hour = now.getHours();
  screen.classList.toggle('night', (hour >= 22 || hour < 6) && Date.now() > kitchenScreenAwakeUntil);
  const today = dateKey(now);
  const meals = state.plan.filter((entry) => entry.date === today).map((entry) => ({ entry, recipe: recipeById(entry.recipeId) })).filter(({ recipe }) => recipe);
  const timers = timersByUrgency(cookTimers);
  const soon = itemsNeedingExpiryAttention().slice(0, 6);
  const shopping = state.shopping.filter((item) => !item.checked).length;
  const card = (title, body) => `<section class="kitchen-card"><h2>${title}</h2>${body}</section>`;
  screen.innerHTML = `
    <header class="kitchen-screen-head">
      <div><strong class="kitchen-clock">${escapeHtml(new Intl.DateTimeFormat(languageLocale(), { hour: '2-digit', minute: '2-digit' }).format(now))}</strong><span>${escapeHtml(formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' }))}</span></div>
      <button class="button button-outline" type="button" data-action="close-kitchen-screen">${t('Back to the app')}</button>
    </header>
    <div class="kitchen-screen-grid">
      ${card(t('Today'), meals.length
        ? `<ul class="kitchen-list">${meals.map(({ entry, recipe }) => `<li><span>${escapeHtml(recipe.name)}</span><button class="button button-primary" type="button" data-action="kitchen-cook" data-id="${escapeHtml(recipe.id)}" data-plan="${escapeHtml(entry.id)}">${t('Step by step')} <span aria-hidden="true">▶</span></button></li>`).join('')}</ul>`
        : `<p class="kitchen-empty">${t('Nothing planned for today.')}</p>`)}
      ${card(t('Timers'), timers.length
        ? `<ul class="kitchen-list">${timers.map((timer) => `<li class="${timer.done ? 'done' : ''}"><span>${escapeHtml(timer.name || timer.label || '')}</span><strong class="kitchen-timer">${timer.done ? t('Done') : formatTimer(timerRemaining(timer))}</strong></li>`).join('')}</ul>`
        : `<p class="kitchen-empty">${t('No timers running.')}</p>`)}
      ${card(t('Use soon'), soon.length
        ? `<ul class="kitchen-list">${soon.map((item) => `<li class="${expiryClass(item.expiresOn, item.dateKind)}"><span>${escapeHtml(item.name)}</span><small>${escapeHtml(expirationLabel(item.expiresOn, item.dateKind))}</small></li>`).join('')}</ul>`
        : `<p class="kitchen-empty">${t('Nothing to use soon.')}</p>`)}
      ${card(t('Shopping'), `<p class="kitchen-count">${shopping ? tp(shopping, '{count} thing on the shopping list', '{count} things on the shopping list') : t('The shopping list is empty')}</p>`)}
    </div>`;
  mirrorArrows(screen);
  // Every second while a timer runs, otherwise twice a minute for the clock.
  kitchenScreenTick = setTimeout(renderKitchenScreen, timers.some((timer) => !timer.done) ? 1000 : 30000);
}

// At night a tap on the dimmed screen brightens it for a minute.
function wakeKitchenScreen() {
  kitchenScreenAwakeUntil = Date.now() + 60000;
  renderKitchenScreen();
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
    const matchesText = matchesSearch(inventoryQuery, `${item.name} ${item.kind} ${kindLabel(item.kind)}`, [item.name]);
    return matchesText && (inventoryLocation === ALL_LOCATIONS || item.location === inventoryLocation);
  });
  const foodCount = state.inventory.filter((item) => item.kind !== 'Household' && Number(item.quantity) > 0).length;
  const lowCount = state.inventory.filter((item) => Number(item.quantity) > 0 && Number(item.quantity) <= 1).length;
  const scan = canScanBarcodes() ? `<button class="button button-outline" data-action="scan-inventory" title="${t('Scan a product to use it up or add it')}"><span aria-hidden="true">▥</span> ${t('Scan')}</button>` : '';
  const action = `<div class="inventory-heading-actions">${scan}<button class="button button-outline" data-action="stocktake-pick" title="${t('Go through one place, item by item')}"><span aria-hidden="true">☑</span> ${t('Check a place')}</button><button class="button button-primary" data-action="add-item"><span aria-hidden="true">＋</span> ${t('Add item')}</button></div>`;
  return `${pageHeading(t('THE KITCHEN, AT A GLANCE'), t('Good things on hand.'), t('A clear picture of what is here, and where it lives.'), action)}
    <div class="stats-row"><div class="stat"><span class="stat-icon mint">▤</span><div><strong>${foodCount}</strong><span>${tp(foodCount, 'food item', 'food items')}</span></div></div><div class="stat"><span class="stat-icon coral">◷</span><div><strong>${lowCount}</strong><span>${t('running low')}</span></div></div><div class="stat"><span class="stat-icon yellow">⌂</span><div><strong>${state.locations.length}</strong><span>${tp(state.locations.length, 'storage spot', 'storage spots')}</span></div></div></div>
    ${renderStocktake()}
    ${renderThawPanel()}
    ${renderExpirationPanel()}
    ${renderMonthOverview()}
    ${renderShelfLifeSuggestions()}
    <section class="section-block"><div class="section-heading"><div><h2>${t('Everything in its place')}</h2><span class="muted">${tp(rows.length, '{count} item', '{count} items')}</span></div><div class="inventory-tools"><div class="filter-controls"><label class="search-field"><span aria-hidden="true">⌕</span><input id="inventory-search" value="${escapeHtml(inventoryQuery)}" placeholder="${t('Find something')}" aria-label="${t('Find an item')}" /></label><select id="location-filter" aria-label="${t('Filter by location')}">${locations.map((location) => `<option value="${escapeHtml(location)}" ${inventoryLocation === location ? 'selected' : ''}>${escapeHtml(location === ALL_LOCATIONS ? t(ALL_LOCATIONS) : location)}</option>`).join('')}</select></div><div class="inventory-mode-switch" role="group" aria-label="${t('Inventory display mode')}"><button class="${inventoryMode === 'list' ? 'active' : ''}" data-action="inventory-mode" data-mode="list" aria-pressed="${inventoryMode === 'list'}">${t('List')}</button><button class="${inventoryMode === 'map' ? 'active' : ''}" data-action="inventory-mode" data-mode="map" aria-pressed="${inventoryMode === 'map'}">${t('Map')}</button></div></div></div>
    ${inventoryMode === 'map' ? renderInventoryMap(rows) : rows.length ? `<div class="inventory-list">${rows.map((item) => `<article class="inventory-row"><div class="item-symbol ${item.kind === 'Household' ? 'household' : ''}" aria-hidden="true">${item.kind === 'Household' ? '⌂' : '◌'}</div><div class="item-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.location)} <i>·</i> ${escapeHtml(kindLabel(item.kind))}${itemDetails(item)}</span>${inventoryExpiryMarkup(item, 'span')}</div><div class="quantity-stepper"><button data-action="adjust" data-id="${escapeHtml(item.id)}" data-delta="-1" aria-label="${t('Decrease {name}', { name: escapeHtml(item.name) })}">−</button><span>${escapeHtml(item.quantity)} <small>${escapeHtml(item.unit || '')}</small></span><button data-action="adjust" data-id="${escapeHtml(item.id)}" data-delta="1" aria-label="${t('Increase {name}', { name: escapeHtml(item.name) })}">＋</button></div><button class="row-edit" data-action="edit-item" data-id="${escapeHtml(item.id)}" aria-label="${t('Edit {name}', { name: escapeHtml(item.name) })}" title="${t('Edit item')}">•••</button></article>`).join('')}</div>` : `<div class="empty-state"><span class="empty-mark">＋</span><strong>${inventoryQuery ? t('Nothing found just yet.') : t('A little room for the good stuff.')}</strong><p>${inventoryQuery ? t('Try another name or location.') : t('Add what you already have in your kitchen.')}</p>${inventoryQuery ? '' : `<button class="button button-primary" data-action="add-item">${t('Add the first item')}</button>`}</div>`}</section>`;
}

// Extra notes on an inventory row: a staple's minimum, when it was opened, when it went into the freezer.
function itemDetails(item) {
  const notes = [];
  if (Number(item.minimum) > 0) notes.push(t('keep at least {amount}', { amount: `${item.minimum}${item.unit ? ` ${item.unit}` : ''}` }));
  if (item.openedOn && dateFromKey(item.openedOn)) notes.push(t('opened {date}', { date: expirationDateText(item.openedOn) }));
  if (isFrozen(item) && item.frozenOn && dateFromKey(item.frozenOn)) notes.push(t('frozen {date}', { date: expirationDateText(item.frozenOn) }));
  return notes.map((note) => ` <i>·</i> ${escapeHtml(note)}`).join('');
}

// This month's removed items: how many were used up and how many thrown away (with the most thrown-away names).
// Shown once something was removed with a reason this month.
function renderMonthOverview() {
  const month = dateKey(new Date()).slice(0, 7);
  const entries = state.log.filter((entry) => String(entry.date || '').startsWith(month));
  if (!entries.length) return '';
  const used = entries.filter((entry) => entry.outcome === 'used').length;
  const wasted = entries.filter((entry) => entry.outcome === 'wasted');
  const counts = new Map();
  for (const entry of wasted) counts.set(entry.name, (counts.get(entry.name) || 0) + 1);
  const names = [...counts].sort((first, second) => second[1] - first[1]).slice(0, 4).map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
  const summary = `${tp(used, '{count} used up', '{count} used up')} · ${tp(wasted.length, '{count} thrown away', '{count} thrown away')}`;
  return `<section class="month-overview" aria-label="${t('This month')}"><span class="eyebrow">${t('THIS MONTH')}</span><strong>${escapeHtml(summary)}</strong>${names.length ? `<span class="muted">${escapeHtml(t('Thrown away: {items}', { items: names.join(', ') }))}</span>` : ''}</section>`;
}

// Shelf lives learned from what was thrown away (shelfLifeSuggestions in app/core.js): "Use 4 days" or "Keep 7 days".
const STORAGE_PLACES = { fridge: N_('in the fridge'), freezer: N_('in the freezer'), pantry: N_('in the cupboard') };
const dayCount = (days) => tp(days, '{count} day', '{count} days');

function renderShelfLifeSuggestions() {
  const suggestions = shelfLifeSuggestions();
  if (!suggestions.length) return '';
  return `<section class="month-overview shelf-life-suggestions" aria-label="${t('Learned from your kitchen')}"><span class="eyebrow">${t('LEARNED FROM YOUR KITCHEN')}</span>${suggestions.map((suggestion) => {
    const key = escapeHtml(suggestion.key);
    return `<div class="shelf-life-suggestion"><div><strong>${escapeHtml(suggestion.name)} · ${t(STORAGE_PLACES[suggestion.storage])}</strong><span class="muted">${escapeHtml(t('Thrown away {times} times, usually after {days}. The estimate is {estimate}.', { times: suggestion.times, days: dayCount(suggestion.days), estimate: dayCount(suggestion.estimate) }))}</span></div><div class="shelf-life-actions"><button class="button button-small button-primary" type="button" data-action="shelf-life-use" data-id="${key}" data-days="${suggestion.days}">${escapeHtml(t('Use {days}', { days: dayCount(suggestion.days) }))}</button><button class="button button-small button-quiet" type="button" data-action="shelf-life-keep" data-id="${key}">${escapeHtml(t('Keep {days}', { days: dayCount(suggestion.estimate) }))}</button></div></div>`;
  }).join('')}<span class="muted shelf-life-note">${t('A shorter time only changes the estimate for new items. Package dates always win.')}</span></section>`;
}

function renderInventoryMap(rows) {
  if (!rows.length && inventoryQuery) return `<div class="empty-state"><span class="empty-mark">⌕</span><strong>${t('Nothing found just yet.')}</strong><p>${t('Try another name or location.')}</p></div>`;
  const locations = [...new Set([...state.locations, ...rows.map((item) => item.location).filter(Boolean)])]
    .filter((location) => inventoryLocation === ALL_LOCATIONS || location === inventoryLocation);
  const categoryIcons = { Fruit: '🍎', Vegetables: '🥕', Herbs: '🌿', Dairy: '🥛', 'Meat and fish': '🍗', Bakery: '🍞', Baking: '🥣', Pantry: '🥫' };
  const locationIcon = (location) => FREEZER_WORDS.test(location) || FRIDGE_WORDS.test(location) ? '❄' : PANTRY_WORDS.test(location) ? '▤' : /clean|schoonmaak|putz|nettoyage|limpieza|pulizia|limpeza|curățenie|sprzątan|temizlik|убор|清洁|掃除|تنظيف|ניקיון/i.test(location) ? '✦' : '⌂';
  const itemIcon = (item) => item.kind === 'Household' ? '🧽' : categoryIcons[ingredientRecord(item.name)?.category] || '◌';
  return `<div class="storage-map">${locations.map((location) => {
    const items = rows.filter((item) => item.location === location);
    return `<section class="storage-zone"><header class="storage-zone-heading"><span class="storage-zone-icon" aria-hidden="true">${locationIcon(location)}</span><div><h3>${escapeHtml(location)}</h3><span>${tp(items.length, '{count} item', '{count} items')}</span></div><span class="storage-zone-total">${items.length}</span></header>${items.length ? `<div class="storage-items">${items.map((item) => `<article class="visual-item"><span class="visual-item-icon" aria-hidden="true">${itemIcon(item)}</span><div class="visual-item-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(kindLabel(item.kind))}</small>${inventoryExpiryMarkup(item, 'small')}</div><div class="visual-quantity"><strong>${escapeHtml(item.quantity)}</strong><small>${escapeHtml(item.unit || t('items'))}</small></div><button class="row-edit" data-action="edit-item" data-id="${escapeHtml(item.id)}" aria-label="${t('Edit {name}', { name: escapeHtml(item.name) })}" title="${t('Edit item')}">•••</button></article>`).join('')}</div>` : `<p class="storage-zone-empty">${t('Nothing stored here yet')}</p>`}</section>`;
  }).join('')}</div>`;
}

// Stocktake: one storage place at a time, item by item: still there, less (edit the amount) or gone (used up or
// thrown away). A finished place gets today's date in state.checks ({ id: place, date }), shared like the rest.
let stocktake = null; // null, { picking: true } or { location, seen: [item ids], asking: item id }

function placeCheckedText(location) {
  const check = (state.checks || []).find((entry) => entry.id === location);
  const days = check ? -expiryDaysRemaining(check.date) : null;
  if (days === null) return t('never checked');
  if (days <= 0) return t('checked today');
  if (days < 14) return tp(days, 'checked {count} day ago', 'checked {count} days ago');
  return tp(Math.round(days / 7), 'checked {count} week ago', 'checked {count} weeks ago');
}

const stocktakeItems = (location) => state.inventory.filter((item) => item.location === location && Number(item.quantity) > 0)
  .sort((first, second) => first.name.localeCompare(second.name));

function renderStocktake() {
  if (!stocktake) return '';
  const close = `<button class="button button-small button-quiet" type="button" data-action="stocktake-close">${t('Close')}</button>`;
  if (stocktake.picking) {
    const places = [...new Set([...state.locations, ...state.inventory.map((item) => item.location).filter(Boolean)])];
    return `<section class="section-block stocktake-panel"><div class="section-heading"><div><span class="eyebrow">${t('STOCKTAKE')}</span><h2>${t('Which place do you want to check?')}</h2></div>${close}</div>
      <div class="stocktake-places">${places.map((place) => `<button class="stocktake-place" type="button" data-action="stocktake-start" data-location="${escapeHtml(place)}"><strong>${escapeHtml(place)}</strong><span>${tp(stocktakeItems(place).length, '{count} item', '{count} items')} · ${escapeHtml(placeCheckedText(place))}</span></button>`).join('')}</div></section>`;
  }
  const items = stocktakeItems(stocktake.location);
  const left = items.filter((item) => !stocktake.seen.includes(item.id)).length;
  const rows = items.map((item) => {
    const seen = stocktake.seen.includes(item.id);
    const id = escapeHtml(item.id);
    const actions = seen
      ? `<span class="stocktake-seen">✓ ${t('Still there')}</span>`
      : stocktake.asking === item.id
        ? `<button class="button button-small button-outline" type="button" data-action="stocktake-used" data-id="${id}">${t('Used up')}</button><button class="button button-small button-outline" type="button" data-action="stocktake-wasted" data-id="${id}">${t('Thrown away')}</button><button class="button button-small button-quiet" type="button" data-action="stocktake-gone-cancel">${t('Cancel')}</button>`
        : `<button class="button button-small button-primary" type="button" data-action="stocktake-ok" data-id="${id}">${t('Still there')}</button><button class="button button-small button-outline" type="button" data-action="edit-item" data-id="${id}">${t('Less')}</button><button class="button button-small button-outline" type="button" data-action="stocktake-gone" data-id="${id}">${t('Gone')}</button>`;
    return `<article class="stocktake-row${seen ? ' is-seen' : ''}"><div class="item-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.quantity)} ${escapeHtml(item.unit || '')}${item.expiresOn ? ` · ${escapeHtml(expirationText(item))}` : ''}</span></div><div class="stocktake-actions">${actions}</div></article>`;
  }).join('');
  return `<section class="section-block stocktake-panel"><div class="section-heading"><div><span class="eyebrow">${t('STOCKTAKE')} · ${escapeHtml(stocktake.location.toUpperCase())}</span><h2>${left ? tp(left, '{count} item to check', '{count} items to check') : t('All checked')}</h2></div>${close}</div>
    ${items.length ? `<div class="stocktake-list">${rows}</div>` : `<p class="muted">${t('Nothing is stored here.')}</p>`}
    <div class="stocktake-footer"><span class="muted">${escapeHtml(placeCheckedText(stocktake.location))}</span><button class="button ${left ? 'button-outline' : 'button-primary'}" type="button" data-action="stocktake-done">${t('Done')}</button></div></section>`;
}

// "Take out of the freezer": what today's and tomorrow's meals need that is only in the freezer.
function renderThawPanel() {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const rows = [[today, t('today')], [tomorrow, t('tomorrow')]].flatMap(([date, when]) => thawNeeds(date).map((need) => ({ ...need, when })));
  if (!rows.length) return '';
  const list = rows.map(({ item, recipe, when }) => `<article class="expiry-row thaw-row"><div class="expiry-item-info"><span class="expiry-mark" aria-hidden="true">❄</span><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(t('for {recipe} {when}', { recipe: recipe.name, when }))} · ${escapeHtml(item.location)}</span></div></div><div class="expiry-suggestions"><button class="button button-small button-outline" type="button" data-action="thaw-item" data-id="${escapeHtml(item.id)}">${t('Moved to the fridge')}</button></div></article>`).join('');
  return `<section class="expiration-panel thaw-panel" aria-label="${t('Take out of the freezer')}"><header><div><span class="eyebrow">${t('TAKE OUT OF THE FREEZER')}</span><h2>${tp(rows.length, '{count} thing to thaw for your meals', '{count} things to thaw for your meals')}</h2></div></header><div class="expiry-list">${list}</div></section>`;
}

function renderExpirationPanel() {
  const expiringItems = itemsNeedingExpiryAttention();
  if (!expiringItems.length) return '';
  const rows = expiringItems.map((item) => {
    const recipes = recipesUsingInventoryItem(item);
    const suggestions = recipes.length
      ? `<div class="expiry-suggestions"><span>${t('Try using it in')}</span>${recipes.slice(0, 2).map((recipe) => `<button class="text-button expiry-recipe-link" data-action="show-expiring-recipe" data-id="${escapeHtml(recipe.id)}">${escapeHtml(recipe.name)} <span aria-hidden="true">→</span></button>`).join('')}</div>`
      : `<span class="expiry-no-recipe">${t('No saved recipe uses this yet')}</span>`;
    const ideasButton = `<button class="text-button expiry-ideas" type="button" data-action="use-it-up" data-id="${escapeHtml(item.id)}">${t('Recipe ideas')} <span aria-hidden="true">✨</span></button>`;
    return `<article class="expiry-row"><div class="expiry-item-info"><span class="expiry-mark" aria-hidden="true">!</span><div><strong>${escapeHtml(item.name)}</strong><span class="item-expiry ${expiryClass(item.expiresOn, item.dateKind)}">${escapeHtml(expirationText(item))} · ${escapeHtml(item.quantity)} ${escapeHtml(item.unit || '')}</span></div></div><div class="expiry-actions">${suggestions}${ideasButton}</div></article>`;
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
  const copyRow = copyingDay === dateKey(selectedDate) && selectedPlans.length ? renderCopyDayTargets() : '';
  const copyButton = selectedPlans.length ? `<button class="text-button" data-action="copy-day" aria-expanded="${Boolean(copyRow)}">${t('Copy this day to…')}</button>` : '';
  const repeatCount = lastWeekMeals().length;
  // Suggestions belong to the week they were made for.
  if (weekSuggestions && !weekSuggestions.every((entry) => entry.date >= dateKey(weekStart) && entry.date <= dateKey(weekEnd))) weekSuggestions = null;
  const fillButton = !weekSuggestions && state.recipes.length && emptyDaysThisWeek().length ? `<button class="button button-outline" data-action="suggest-week">${t('Fill the empty days')} <span aria-hidden="true">✨</span></button>` : '';
  const repeatButton = repeatCount ? `<button class="button button-outline" data-action="repeat-last-week" title="${tp(repeatCount, 'Plan {count} meal from last week again', 'Plan {count} meals from last week again')}">${t('Repeat last week')} <span aria-hidden="true">↻</span></button>` : '';
  const planned = selectedPlans.length ? selectedPlans.map((entry) => {
    const recipe = recipeById(entry.recipeId);
    if (!recipe) return '';
    const title = `<button class="mealie-link recipe-title-link" type="button" data-action="view-recipe" data-id="${escapeHtml(recipe.id)}" title="${t('Show recipe')}">${escapeHtml(recipe.name)} <span aria-hidden="true">→</span></button>`;
    return `<article class="planned-meal ${entry.cooked ? 'is-cooked' : ''}"><span class="meal-index">${entry.cooked ? '✓' : '01'}</span><div class="planned-copy"><strong>${title}</strong><span>${entry.cooked ? t('Cooked and confirmed') : tp(recipe.ingredients.length, '{count} ingredient', '{count} ingredients')}${planScale(entry) !== 1 ? ` · ${escapeHtml(scaleLabel(recipe, planScale(entry)))}` : ''}</span></div>${entry.cooked ? `<span class="cooked-label">${t('DONE')}</span>` : `<div class="planned-actions"><button class="button button-small button-dark steps-start" data-action="start-steps" data-id="${escapeHtml(recipe.id)}" data-plan="${escapeHtml(entry.id)}" title="${t('Cook it step by step')}">${t('Steps')} <span aria-hidden="true">▶</span></button><button class="button button-small button-quiet" data-action="review-plan" data-id="${escapeHtml(entry.id)}" title="${t('See what this needs and what you have')}">${t('Review')}</button><button class="button button-small button-outline" data-action="cook" data-id="${escapeHtml(entry.id)}" title="${t('Mark as cooked and remove the ingredients from stock')}">${t('Cooked')} <span aria-hidden="true">✓</span></button></div>`}<button class="icon-button remove-button" data-action="remove-plan" data-id="${escapeHtml(entry.id)}" aria-label="${t('Remove meal')}">×</button></article>`;
  }).join('') : `<div class="day-empty"><span aria-hidden="true">✳</span><p>${t('No meal planned for this day.')}</p><small>${t('Pick a recipe below to give the day a little shape.')}</small></div>`;
  // Recipes that use something from Use soon come first ("plan these first"), then the ones closest to ready.
  const soon = itemsNeedingExpiryAttention();
  const usesSoon = new Map(state.recipes.map((recipe) => [recipe.id, soon.filter((item) => (recipe.ingredients || []).some((ingredient) => matchingInventory(ingredient)?.id === item.id))]));
  const recipeOptions = [...state.recipes].sort((first, second) => usesSoon.get(second.id).length - usesSoon.get(first.id).length || missingIngredients(first).length - missingIngredients(second).length);
  const soonTag = (recipe) => (usesSoon.get(recipe.id).length ? `<span class="use-soon-tag">${escapeHtml(t('Uses {items} soon', { items: usesSoon.get(recipe.id).slice(0, 2).map((item) => item.name).join(', ') }))}</span>` : '');
  return `${pageHeading(t('A GOOD WEEK STARTS HERE'), t('Make room for dinner.'), t('Plan meals at your own pace. Your list will follow along.'), `<div class="week-heading-actions">${fillButton}${repeatButton}<button class="button button-outline" data-action="generate-shopping">${t('Build shopping list')} <span aria-hidden="true">↗</span></button></div>`)}
    <div class="week-navigation"><button class="icon-button" data-action="previous-week" aria-label="${t('Previous week')}" title="${t('Previous week')}">‹</button><label class="date-jump">${t('Jump to date')}<input id="week-date" type="date" value="${dateKey(selectedDate)}" aria-label="${t('Select a date')}" /></label><span class="week-range">${escapeHtml(weekLabel)}</span><button class="button button-quiet today-button" data-action="go-today">${t('Today')}</button><button class="icon-button" data-action="next-week" aria-label="${t('Next week')}" title="${t('Next week')}">›</button></div>
    ${renderWeekSuggestions()}
    <section class="week-planner"><div class="week-strip">${dayButtons}</div><div class="day-detail"><div class="section-heading"><div><span class="eyebrow">${t('YOUR PLAN')}</span><h2>${escapeHtml(selectedLabel)}</h2></div><div class="day-detail-actions">${copyButton}<span class="plan-count">${tp(selectedPlans.length, '{count} meal', '{count} meals')}</span></div></div>${copyRow}<div class="planned-list">${planned}</div></div></section>
    <section class="section-block recipe-picker"><div class="section-heading"><div><span class="eyebrow">${t('PICK SOMETHING GOOD')}</span><h2>${t('Add a recipe to this day')}</h2></div><button class="text-button" data-view="recipes">${t('Browse all recipes')} <span aria-hidden="true">→</span></button></div><div class="picker-grid">${recipeOptions.slice(0, 3).map((recipe) => `<article class="picker-item"><span class="recipe-number">${tp(recipe.ingredients.length, '{count} INGREDIENT', '{count} INGREDIENTS', { count: String(recipe.ingredients.length).padStart(2, '0') })}</span><strong>${escapeHtml(recipe.name)}</strong>${soonTag(recipe)}<p>${escapeHtml(recipe.description || t('An idea from your recipe shelf.'))}</p><div class="picker-foot"><span class="match-tag ${missingIngredients(recipe).length ? 'has-missing' : ''}">${missingIngredients(recipe).length ? tp(missingIngredients(recipe).length, '{count} to pick up', '{count} to pick up') : t('Ready to make')}</span><button class="button button-small button-dark" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">${t('Add')} <span aria-hidden="true">＋</span></button></div></article>`).join('') || `<p class="muted">${t('Add recipes in your recipe library first.')}</p>`}</div></section>`;
}

// Faster planning: "Repeat last week" plans last week's meals again on the same weekdays, and "Copy this day to…"
// copies a day's meals to another day of this week or the next. Meals already planned there are not doubled.
let copyingDay = '';

const plannedMeal = (entry) => ({ id: makeId(), date: entry.date, recipeId: entry.recipeId, cooked: false, ...(planScale(entry) !== 1 ? { scale: planScale(entry) } : {}) });
const alreadyPlanned = (date, recipeId) => state.plan.some((entry) => entry.date === date && entry.recipeId === recipeId);

function shiftDateKey(key, days) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

// Last week's meals that aren't planned on the same weekday this week yet.
function lastWeekMeals() {
  const first = dateKey(dateAtOffset(-7));
  const last = dateKey(dateAtOffset(-1));
  return state.plan.filter((entry) => entry.date >= first && entry.date <= last && recipeById(entry.recipeId))
    .map((entry) => ({ ...entry, date: shiftDateKey(entry.date, 7) }))
    .filter((entry, index, list) => !alreadyPlanned(entry.date, entry.recipeId) && list.findIndex((other) => other.date === entry.date && other.recipeId === entry.recipeId) === index);
}

function repeatLastWeek() {
  const meals = lastWeekMeals();
  if (!meals.length) return;
  withUndo(tp(meals.length, '{count} meal from last week planned again', '{count} meals from last week planned again'), ['plan'], () => {
    state.plan.push(...meals.map(plannedMeal));
  });
}

// "Fill the empty days" (0.47): a recipe for each day of the shown week (from today on) that has nothing planned.
// Recipes that use up something from Use soon go first and on the earliest days, then the ones needing the least
// shopping; nothing that was planned or cooked in the last ten days, and no recipe twice. Each suggestion can be
// swapped for the next one or left out; nothing is planned until "Plan these".
let weekSuggestions = null; // [{ date, recipeId }] while the suggestions are shown

function emptyDaysThisWeek() {
  const today = dateKey(new Date());
  return Array.from({ length: 7 }, (_, index) => dateKey(dateAtOffset(index)))
    .filter((key) => key >= today && !state.plan.some((entry) => entry.date === key));
}

function rankedForWeek() {
  const soon = itemsNeedingExpiryAttention();
  const recentFrom = shiftDateKey(dateKey(new Date()), -10);
  const recent = new Set(state.plan.filter((entry) => entry.date >= recentFrom).map((entry) => entry.recipeId));
  return state.recipes
    .filter((recipe) => !recent.has(recipe.id) && (recipe.ingredients || []).length)
    .map((recipe) => ({ recipe, uses: soon.filter((item) => recipe.ingredients.some((ingredient) => matchingInventory(ingredient)?.id === item.id)).length, missing: missingIngredients(recipe).length }))
    .sort((first, second) => second.uses - first.uses || first.missing - second.missing || first.recipe.name.localeCompare(second.recipe.name))
    .map(({ recipe }) => recipe.id);
}

function suggestWeek() {
  const ranked = rankedForWeek();
  weekSuggestions = emptyDaysThisWeek().map((date, index) => ({ date, recipeId: ranked[index] || '' })).filter((entry) => entry.recipeId);
  render();
}

// The next recipe not suggested on another day.
function swapWeekSuggestion(date) {
  const ranked = rankedForWeek();
  const taken = new Set(weekSuggestions.map((entry) => entry.recipeId));
  const entry = weekSuggestions.find((suggestion) => suggestion.date === date);
  if (!entry) return;
  const start = ranked.indexOf(entry.recipeId);
  const next = [...ranked.slice(start + 1), ...ranked.slice(0, Math.max(0, start))].find((id) => !taken.has(id));
  if (next) entry.recipeId = next;
  render();
}

function planWeekSuggestions() {
  const meals = (weekSuggestions || []).filter((entry) => recipeById(entry.recipeId) && !alreadyPlanned(entry.date, entry.recipeId));
  weekSuggestions = null;
  if (!meals.length) { render(); return; }
  withUndo(tp(meals.length, '{count} meal planned', '{count} meals planned'), ['plan'], () => {
    state.plan.push(...meals.map((entry) => ({ id: makeId(), date: entry.date, recipeId: entry.recipeId, cooked: false })));
  });
}

function renderWeekSuggestions() {
  if (!weekSuggestions) return '';
  const rows = weekSuggestions.map((entry) => {
    const recipe = recipeById(entry.recipeId);
    const missing = missingIngredients(recipe).length;
    return `<li><span class="suggestion-day">${escapeHtml(formatDate(dateFromKey(entry.date), { weekday: 'short', day: 'numeric' }))}</span><span class="suggestion-recipe"><strong>${escapeHtml(recipe.name)}</strong><small>${missing ? tp(missing, '{count} to pick up', '{count} to pick up') : t('Ready to make')}</small></span><button class="text-button" type="button" data-action="swap-suggestion" data-date="${entry.date}">${t('Swap')} <span aria-hidden="true">↻</span></button><button class="icon-button remove-button" type="button" data-action="drop-suggestion" data-date="${entry.date}" aria-label="${t('Leave this day empty')}" title="${t('Leave this day empty')}">×</button></li>`;
  }).join('');
  return `<section class="week-suggestions" aria-label="${t('Suggested for the empty days')}"><div class="section-heading"><div><span class="eyebrow">${t('PLAN MY WEEK')}</span><h2>${t('Suggested for the empty days')}</h2></div></div>${rows ? `<ul>${rows}</ul>` : `<p class="muted">${t('No recipe fits: add recipes, or ones you have not had lately.')}</p>`}<div class="week-suggestion-actions"><button class="button button-quiet" type="button" data-action="cancel-suggestions">${t('Cancel')}</button>${rows ? `<button class="button button-primary" type="button" data-action="plan-suggestions">${t('Plan these')}</button>` : ''}</div></section>`;
}

function renderCopyDayTargets() {
  const from = dateKey(selectedDate);
  const days = Array.from({ length: 14 }, (_, index) => dateAtOffset(index)).filter((date) => dateKey(date) !== from);
  return `<div class="copy-day-targets" role="group" aria-label="${t('Copy this day to…')}"><span>${t('Copy to')}</span>${days.map((date) => `<button class="day-target" data-action="copy-day-to" data-date="${dateKey(date)}">${escapeHtml(formatDate(date, { weekday: 'short', day: 'numeric' }))}</button>`).join('')}</div>`;
}

function copyDayTo(target) {
  const from = copyingDay;
  copyingDay = '';
  const meals = state.plan.filter((entry) => entry.date === from && recipeById(entry.recipeId) && !alreadyPlanned(target, entry.recipeId)).map((entry) => ({ ...entry, date: target }));
  const label = formatDate(dateFromKey(target), { weekday: 'long', day: 'numeric', month: 'long' });
  if (!meals.length) { render(); return; }
  withUndo(tp(meals.length, '{count} meal copied to {day}', '{count} meals copied to {day}', { day: label }), ['plan'], () => {
    state.plan.push(...meals.map(plannedMeal));
  });
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
  const row = (item) => `<article class="shopping-row ${item.checked ? 'checked' : ''}"><label class="check-wrap"><input type="checkbox" data-action="check-shopping" data-id="${escapeHtml(item.id)}" ${item.checked ? 'checked' : ''} /><span class="custom-check" aria-hidden="true"></span><span class="shopping-name">${escapeHtml(item.name)}${item.restock ? ` <small class="restock-tag">${t('restock')}</small>` : ''}</span></label><span class="shopping-amount">${escapeHtml(item.quantity || '')} ${escapeHtml(item.unit || '')}</span>${item.checked ? `<button class="button button-small button-outline putaway-button" data-action="put-away" data-id="${escapeHtml(item.id)}">${t('Put away')}</button>` : `<span class="shopping-source">${escapeHtml(item.source || t('Shopping list'))}</span>`}</article>`;
  const groups = shoppingGroups(state.shopping);
  const rows = groups.length > 1
    ? groups.map((group) => `<h3 class="shopping-group${group.items.some((item) => !item.checked) ? '' : ' is-done'}">${escapeHtml(t(group.key))} <span>${group.items.filter((item) => !item.checked).length || '✓'}</span></h3>${group.items.map(row).join('')}`).join('')
    : state.shopping.map(row).join('');
  const shareButton = STANDALONE
    ? `<button class="button button-outline" data-action="share-shopping-text">${t('Share list')} <span aria-hidden="true">↗</span></button>`
    : `<button class="button button-outline" data-action="show-shopping-qr">${t('Share to phone')} <span aria-hidden="true">▦</span></button>`;
  const printButton = canPrint() && remaining ? `<button class="button button-outline" data-action="print">${t('Print')} <span aria-hidden="true">⎙</span></button>` : '';
  const actions = `<div class="shopping-heading-actions">${state.shopping.length ? shareButton : ''}${printButton}<button class="button button-outline" data-action="generate-shopping">${t('Refresh from plan')} <span aria-hidden="true">↻</span></button></div>`;
  return `${pageHeading(t('OUT AND ABOUT'), t('The list, in hand.'), tp(remaining, '{count} thing left to pick up. Check off as you go.', '{count} things left to pick up. Check off as you go.'), actions)}
    <section class="section-block shopping-block"><div class="section-heading"><div><h2>${t('This week’s list')}</h2><span class="muted">${tp(state.shopping.length, '{count} item', '{count} items')}</span></div><div class="list-actions">${remaining ? `<button class="text-button" data-action="check-all">✓ ${t('Check all')}</button>` : ''}${state.shopping.some((item) => item.checked) ? `<button class="button button-small button-outline" data-action="put-all-away">${t('Put all away')}</button><button class="text-button" data-action="clear-checked">${t('Clear checked')}</button>` : ''}${state.shopping.length ? `<button class="text-button clear-list-button" data-action="clear-list">× ${t('Clear list')}</button>` : ''}</div></div>${rows ? `<div class="shopping-list">${rows}</div>` : `<div class="empty-state compact"><span class="empty-mark">☷</span><strong>${t('Your list is nice and clear.')}</strong><p>${t('Build it from the meals in your weekly plan.')}</p><button class="button button-primary" data-action="generate-shopping">${t('Build from this week')}</button></div>`}</section>${printFooter()}`;
}

// Printing: the browser's print dialog with the print styles at the end of styles.css (a clean recipe page, or the
// shopping list with tick boxes). The desktop app prints the same way; the phone apps' web views can't open it, so
// they print through their bridge (Android's print service, iOS's print sheet), with the same styles.
const canPrint = () => (STANDALONE ? nativeApp.platform === 'desktop' || typeof nativeApp.print === 'function' : typeof window.print === 'function');
const printPage = () => (STANDALONE && typeof nativeApp.print === 'function' ? nativeApp.print() : window.print());
const printFooter = (address = '') => `<p class="print-only print-footer">Goodstock · ${escapeHtml(formatDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' }))}${address ? ` · ${escapeHtml(address)}` : ''}</p>`;

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
      <form class="recipe-search terms-search" onsubmit="return false"><span aria-hidden="true">⌕</span><input id="terms-search" value="${escapeHtml(termsQuery)}" placeholder="${t('Search a term, like blanch or simmer')}" aria-label="${t('Search cooking terms')}" autocomplete="off" /></form>
      <div class="terms-list" id="terms-list"></div>
    </section>`;
}

// Each term shows its name and explanation in the app's language. Outside English the English name stands next
// to it, since recipes often use that one. Search finds a term by any of its names.
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
  const terms = COOKING_TERMS.filter((term) => !query || cleanIngredient(`${term.en} ${local(term)} ${term.what} ${t(term.what)}`).includes(query));
  list.innerHTML = terms.length
    ? terms.map((term) => {
      const name = local(term) || term.en;
      const second = currentLanguage === 'en' ? '' : term.en;
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

// The shopping list for sharing and the QR download, in the same supermarket groups as on screen (headings in the
// chosen language), when there is more than one group.
function groupedShoppingItems(items) {
  const groups = shoppingGroups(items);
  return groups.length > 1 ? groups.flatMap((group) => group.items.map((item) => ({ ...item, group: t(group.key) }))) : items;
}

function shoppingListText(items) {
  const lines = [t('Shopping list')];
  let group = '';
  for (const item of groupedShoppingItems(items)) {
    if (item.group && item.group !== group) { group = item.group; lines.push('', group.toUpperCase()); }
    lines.push(`☐ ${item.name}${item.quantity ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}`);
  }
  return lines.join('\n');
}

// The phone apps have no server for the QR link, so the list goes to the share sheet instead.
function shareShoppingText() {
  const items = state.shopping.filter((item) => !item.checked);
  if (!items.length) return;
  try { nativeApp.share(shoppingListText(items)); } catch { /* Sharing is optional. */ }
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

// Removing asks why: used up or thrown away goes into the month overview; a staple goes on the shopping list.
function removeInventoryItem(id, outcome = '') {
  const item = state.inventory.find((entry) => entry.id === id);
  if (!item) return;
  withUndo(t('Removed “{name}”', { name: item.name }), ['inventory', 'shopping', 'log'], () => {
    state.inventory = state.inventory.filter((entry) => entry.id !== id);
    if (outcome) logRemoval(item, outcome);
    if (Number(item.minimum) > 0) addRestockEntry(item);
  });
}

function clearInventory() {
  const count = state.inventory.length;
  if (!count) { window.alert(t('The inventory is already empty.')); return false; }
  if (!window.confirm(tp(count, 'Remove {count} item from the inventory?', 'Remove all {count} items from the inventory?'))) return false;
  withUndo(tp(count, '{count} item removed from the inventory', '{count} items removed from the inventory'), ['inventory'], () => { state.inventory = []; });
  return true;
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
    form.elements.barcode.value = code;
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

// One barcode from the camera: the phone app's scanner, or the browser's in a dialog. Empty when cancelled; a
// status line gets the reason when the camera fails or the code is not a product barcode.
async function readBarcode(status) {
  try {
    const code = String((STANDALONE ? await nativeCall('scanBarcode') : await scanBarcodeInPage()) || '').trim();
    if (code && !BARCODE.test(code)) { status.textContent = t('That is not a product barcode.'); return ''; }
    return code;
  } catch (error) {
    status.textContent = error?.message === 'cancelled' ? '' : t('The camera could not scan. Type the name or the barcode number instead.');
    return '';
  }
}

async function scanBarcode() {
  const code = await readBarcode($('#barcode-status'));
  if (code) await fillFromBarcode(code);
}

// Putting the shopping away: a scan fills in the pack size, keeps the barcode with the item, and, when the
// catalog knows the product better than the list's name ("Volle melk" for "melk"), estimates its expiry from it.
async function scanPutaway() {
  const form = $('#putaway-form');
  const status = $('#putaway-barcode-status');
  const code = await readBarcode(status);
  if (!code) return;
  form.elements.barcode.value = code;
  status.textContent = t('Looking up the product…');
  try {
    const product = await lookupBarcode(code);
    if (!product) { status.textContent = t('Product not found. The barcode is kept with the item.'); return; }
    if (product.amount) { form.elements.quantity.value = product.amount; form.elements.unit.value = product.unit; }
    const listed = $('#putaway-item-name').textContent;
    if (!ingredientRecord(listed) && ingredientRecord(product.name)) form.elements.estimateName.value = product.name;
    updateExpirationSuggestion(form.elements.estimateName.value || listed, form.elements.location.value, form.elements.expiresOn, $('#putaway-expiry-note'));
    status.textContent = t('Found: {name}', { name: product.name });
  } catch {
    status.textContent = t('Could not look up the barcode. The barcode is kept with the item.');
  }
}

// Scan something from the cupboard: found by its saved barcode, or else by the product's name, then use it up,
// throw it away or edit it. A product that isn't in the inventory yet can be added from here.
let scanResult = null; // { code, item, product }

async function scanInventory() {
  const status = $('#scan-dialog-copy');
  status.textContent = '';
  const code = await readBarcode(status);
  if (!code) { if (status.textContent) showScanResult({ message: status.textContent }); return; }
  await showScannedCode(code);
}

async function showScannedCode(code) {
  let item = state.inventory.find((entry) => entry.barcode === code);
  let product = null;
  let failed = false;
  if (!item) {
    showScanResult({ message: t('Looking up the product…') });
    try { product = await lookupBarcode(code); } catch { failed = true; }
    if (product) {
      const key = cleanIngredient(product.name);
      item = state.inventory.find((entry) => cleanIngredient(entry.name) === key) || matchingInventory(product.name);
      // Remembered, so the next scan finds it straight away.
      if (item && !item.barcode) { item.barcode = code; persist(); }
    }
  }
  showScanResult({ code, item, product, failed });
}

const countsInPieces = (item) => !UNIT_SCALES[canonicalUnit(item.unit)];

function showScanResult({ code = '', item = null, product = null, failed = false, message = '' }) {
  scanResult = { code, item, product };
  const title = $('#scan-dialog-title');
  const copy = $('#scan-dialog-copy');
  const button = (action, label, kind = 'button-outline') => `<button class="button ${kind}" type="button" data-action="${action}">${label}</button>`;
  let actions = '';
  if (message) {
    title.textContent = t('Scan');
    copy.textContent = message;
  } else if (item) {
    title.textContent = item.name;
    copy.textContent = t('{amount} in {location}', { amount: `${item.quantity}${item.unit ? ` ${item.unit}` : ''}`, location: item.location });
    actions = (countsInPieces(item) && Number(item.quantity) > 1 ? button('scan-use-one', t('Use one')) : '')
      + button('scan-used', t('Used up'), 'button-primary') + button('scan-wasted', t('Thrown away')) + button('scan-edit', t('Edit'), 'button-quiet');
  } else {
    title.textContent = product ? product.name : t('Unknown product');
    copy.textContent = product ? t('Not in your inventory yet.') : failed ? t('Could not look up the barcode. Add it by name; the barcode is kept with it.') : t('Not found in Open Food Facts. Add it by name; the barcode is kept with it.');
    actions = button('scan-add', t('Add it'), 'button-primary');
  }
  $('#scan-dialog-actions').innerHTML = `${button('scan-close', t('Close'), 'button-quiet')}${actions}`;
  const dialog = $('#scan-dialog');
  if (!dialog.open) dialog.showModal();
}

function handleScanAction(action) {
  const { code, item, product } = scanResult || {};
  $('#scan-dialog').close();
  if (action === 'scan-use-one' && item) {
    withUndo(t('Used one {name}', { name: item.name }), ['inventory', 'shopping'], () => {
      const current = state.inventory.find((entry) => entry.id === item.id);
      if (current) current.quantity = Math.max(0, Number(current.quantity) - 1);
    });
  }
  if (action === 'scan-used' && item) removeInventoryItem(item.id, 'used');
  if (action === 'scan-wasted' && item) removeInventoryItem(item.id, 'wasted');
  if (action === 'scan-edit' && item) openItemDialog(state.inventory.find((entry) => entry.id === item.id));
  if (action === 'scan-add') {
    openItemDialog();
    const form = $('#item-form');
    form.elements.barcode.value = code || '';
    if (product) {
      form.elements.name.value = product.name;
      if (product.amount) { form.elements.quantity.value = product.amount; form.elements.unit.value = product.unit; }
      updateExpirationSuggestion(product.name, form.elements.location.value, form.elements.expiresOn, $('#expiry-estimate-note'), itemFormStartDate(form));
    }
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
  $('#item-remove').hidden = !item;
  $('#item-remove-choice').hidden = true;
  form.elements.id.value = item?.id || '';
  form.elements.barcode.value = item?.barcode || '';
  form.elements.name.value = item?.name || '';
  form.elements.quantity.value = item?.quantity ?? 1;
  form.elements.unit.value = item?.unit || '';
  form.elements.minimum.value = Number(item?.minimum) > 0 ? item.minimum : '';
  form.elements.expiresOn.value = item?.expiresOn || '';
  form.elements.expiresOn.dataset.estimated = item?.expirationSource === 'estimated' ? 'true' : 'false';
  form.elements.dateKind.value = item?.dateKind || '';
  form.elements.kind.value = item?.kind || 'Food';
  form.elements.openedOn.value = item?.openedOn || '';
  form.elements.frozenOn.value = item?.frozenOn || '';
  fillLocationSelect(form.elements.location, item?.location || state.locations[0]);
  updateFrozenField(form);
  if (item?.expiresOn) {
    $('#expiry-estimate-note').textContent = item.expirationSource === 'estimated' ? t('Approximate estimate based on storage and typical shelf life. Check the package date.') : t('Using your chosen package date.');
  } else {
    updateExpirationSuggestion(form.elements.name.value, form.elements.location.value, form.elements.expiresOn, $('#expiry-estimate-note'), itemFormStartDate(form));
  }
  updateOpenedRow(form, Boolean(item));
  dialog.showModal();
  form.elements.name.focus();
}

// The item dialog's "Frozen on" date shows for food stored in a freezer; new freezer items start at today.
function updateFrozenField(form) {
  const frozen = isFrozen({ kind: form.elements.kind.value, location: form.elements.location.value });
  $('#frozen-field').hidden = !frozen;
  if (frozen && !form.elements.frozenOn.value) form.elements.frozenOn.value = dateKey(new Date());
}

// Where the shelf-life estimate counts from: the freezer date for frozen food, else today.
function itemFormStartDate(form) {
  const frozen = isFrozen({ kind: form.elements.kind.value, location: form.elements.location.value });
  return (frozen && dateFromKey(form.elements.frozenOn.value)) || new Date();
}

// "Opened today", for food already in the inventory that keeps shorter once open (not in the freezer).
function updateOpenedRow(form, existing) {
  const name = form.elements.name.value;
  const openedOn = form.elements.openedOn.value;
  const frozen = isFrozen({ kind: form.elements.kind.value, location: form.elements.location.value });
  const canOpen = existing && form.elements.kind.value !== 'Household' && !frozen && openedShelfLifeDays(name) !== null;
  $('#opened-row').hidden = !canOpen && !openedOn;
  $('#item-opened-button').hidden = Boolean(openedOn) || !canOpen;
  $('#item-opened-note').textContent = openedOn && dateFromKey(openedOn) ? t('Opened {date}.', { date: expirationDateText(openedOn) }) : '';
}

function markItemOpened(form) {
  const after = expiryAfterOpening(form.elements.name.value, form.elements.expiresOn.value);
  if (!after) return;
  form.elements.openedOn.value = dateKey(new Date());
  form.elements.expiresOn.value = after.date;
  form.elements.expiresOn.dataset.estimated = 'true';
  updateOpenedRow(form, true);
  $('#item-opened-note').textContent = tp(after.days, 'Opened today: keeps about {count} day once open.', 'Opened today: keeps about {count} days once open.');
  $('#expiry-estimate-note').textContent = t('Approximate estimate based on storage and typical shelf life. Check the package date.');
}

function openCookDialog(plan) {
  const recipe = scaledRecipe(recipeById(plan.recipeId), planScale(plan));
  if (!recipe) return;
  $('#cook-title').textContent = t('Cooked {name}?', { name: recipe.name });
  $('#cook-form').elements.planId.value = plan.id;
  $('#cook-form').elements.leftovers.checked = false;
  $('#cook-ingredients').innerHTML = recipe.ingredients.map((ingredient, index) => {
    const item = matchingInventory(ingredient);
    const amount = item ? `<span class="cook-amount"><span>${t('Remove')}</span><input type="number" name="amount-${index}" min="0" step="any" value="${Math.round(Math.min(deductionAmount(ingredient, item), Number(item.quantity)) * 100) / 100}" inputmode="decimal" aria-label="${t('Amount of {name} to remove', { name: escapeHtml(item.name) })}"><span>${escapeHtml(item.unit || t('pcs'))} <i>${t('of {quantity}', { quantity: escapeHtml(item.quantity) })}</i></span></span>` : '';
    return `<label class="ingredient-check cook-check ${item ? '' : 'not-stocked'}"><input type="checkbox" name="ingredient" value="${index}" ${item ? 'checked' : ''}><span class="custom-check" aria-hidden="true"></span><span>${escapeHtml(ingredient)}</span><small>${inStockText(item)}</small>${amount}</label>`;
  }).join('');
  $('#cook-dialog').showModal();
}

