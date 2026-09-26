const STORAGE_KEY = 'goodstock-state-v1';
const PENDING_KEY = 'goodstock-pending-v1';
const THEME_KEY = 'goodstock-theme-v1';
const INGREDIENTS_KEY = 'goodstock-ingredients-v1';
const INVENTORY_MODE_KEY = 'goodstock-inventory-mode-v1';
const EXPIRY_REMINDERS_KEY = 'goodstock-expiry-reminders-v1';
const LAST_EXPIRY_REMINDER_KEY = 'goodstock-last-expiry-reminder-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WINDOW_DAYS = 3;
const defaultLocations = ['Pantry', 'Fridge', 'Freezer', 'Cleaning shelf'];
const starterRecipes = [
  { id: 'tomato-bean-soup', name: 'Tomato & white bean soup', description: 'A bright, hearty one-pot lunch.', ingredients: ['1 onion', '2 cans white beans', '1 can tomatoes', 'vegetable stock'], source: 'Goodstock' },
  { id: 'lemon-pasta', name: 'Lemony greens pasta', description: 'Fast pasta with greens and a little parmesan.', ingredients: ['pasta', 'spinach', '1 lemon', 'parmesan'], source: 'Goodstock' },
  { id: 'crispy-potatoes', name: 'Crispy potato tray', description: 'Crisp edges, soft middle, plenty of herbs.', ingredients: ['potatoes', 'olive oil', 'garlic', 'rosemary'], source: 'Goodstock' },
  { id: 'oat-pancakes', name: 'Everyday oat pancakes', description: 'A small-batch breakfast for slow mornings.', ingredients: ['rolled oats', '2 eggs', 'milk', '1 banana'], source: 'Goodstock' },
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function freshState() {
  return {
    inventory: [
      { id: makeId(), name: 'Rolled oats', quantity: 1, unit: 'bag', location: 'Pantry', kind: 'Food' },
      { id: makeId(), name: 'Eggs', quantity: 6, unit: 'pcs', location: 'Fridge', kind: 'Food' },
      { id: makeId(), name: 'Potatoes', quantity: 4, unit: 'pcs', location: 'Pantry', kind: 'Food' },
      { id: makeId(), name: 'Dish soap', quantity: 1, unit: 'bottle', location: 'Cleaning shelf', kind: 'Household' },
    ],
    recipes: starterRecipes.map((recipe) => ({ ...recipe, ingredients: [...recipe.ingredients] })),
    plan: [],
    shopping: [],
    locations: [...defaultLocations],
  };
}

function normalizeState(value) {
  const defaults = freshState();
  if (!value || typeof value !== 'object') return defaults;
  return {
    inventory: Array.isArray(value.inventory) ? value.inventory : defaults.inventory,
    recipes: Array.isArray(value.recipes) ? value.recipes : defaults.recipes,
    plan: Array.isArray(value.plan) ? value.plan : [],
    shopping: Array.isArray(value.shopping) ? value.shopping : [],
    locations: Array.isArray(value.locations) && value.locations.length ? value.locations : defaults.locations,
  };
}

let state = normalizeState(null);
let activeView = 'inventory';
let weekStart = startOfWeek(new Date());
let selectedDate = new Date();
let inventoryQuery = '';
let inventoryLocation = 'All locations';
let recipeQuery = '';
let mealieResults = [];
let mealieConfigured = false;
let syncing = false;
let ingredientCatalog = [];
let shoppingShareUrl = '';
let inventoryMode = 'list';
let sendingExpiryReminder = false;

function dateKey(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function startOfWeek(date) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

function dateAtOffset(offset) {
  const date = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  date.setDate(date.getDate() + offset);
  return date;
}

function formatDate(date, options = { weekday: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function currentWeekPlans() {
  const first = dateKey(weekStart);
  const last = dateKey(dateAtOffset(6));
  return state.plan.filter((entry) => entry.date >= first && entry.date <= last);
}

function ingredientRecord(value) {
  const normalized = cleanIngredient(value);
  if (!normalized) return undefined;
  return ingredientCatalog.find((ingredient) => [ingredient.en, ingredient.nl].some((name) => {
    const alias = cleanIngredient(name);
    return normalized === alias || (normalized.length > 4 && normalized.includes(alias));
  }));
}

function ingredientTerms(value) {
  const normalized = cleanIngredient(value);
  const record = ingredientRecord(value);
  return record ? [normalized, cleanIngredient(record.en), cleanIngredient(record.nl)] : [normalized];
}

function recipeById(id) {
  return state.recipes.find((recipe) => recipe.id === id || recipe.slug === id);
}

function cleanIngredient(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/^\s*\d+(?:[./]\d+)?\s*/, '')
    .replace(/\b(?:g|kg|ml|l|oz|lb|lbs|cup|cups|tbsp|tsp|teaspoon|teaspoons|tablespoon|tablespoons|can|cans|clove|cloves|piece|pieces|pcs|bunch|bunches|pinch|of)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ies$/, 'y')
    .replace(/s$/, '');
}

function matchingInventory(ingredient) {
  const wantedTerms = ingredientTerms(ingredient).filter(Boolean);
  if (!wantedTerms.length) return undefined;
  return state.inventory.find((item) => {
    if (Number(item.quantity) <= 0) return false;
    const availableTerms = ingredientTerms(item.name).filter(Boolean);
    return wantedTerms.some((wanted) => availableTerms.some((available) => available === wanted || (wanted.length > 3 && (available.includes(wanted) || wanted.includes(available)))));
  });
}

function expiryDaysRemaining(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  const today = new Date();
  const expiryDay = Date.UTC(year, month - 1, day);
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((expiryDay - todayDay) / DAY_MS);
}

function expirationDateText(value) {
  const [year, month, day] = value.split('-').map(Number);
  const options = year === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
  return formatDate(new Date(year, month - 1, day), options);
}

function expirationLabel(value) {
  const days = expiryDaysRemaining(value);
  if (days === null) return '';
  const date = expirationDateText(value);
  if (days < 0) return `Expired ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago · ${date}`;
  if (days === 0) return `Expires today · ${date}`;
  if (days === 1) return `Expires tomorrow · ${date}`;
  if (days <= EXPIRY_WINDOW_DAYS) return `Expires in ${days} days · ${date}`;
  return `Expires ${date}`;
}

function expiryClass(value) {
  const days = expiryDaysRemaining(value);
  return days !== null && days < 0 ? 'expired' : days !== null && days <= EXPIRY_WINDOW_DAYS ? 'expiring' : 'expiry-normal';
}

function itemsNeedingExpiryAttention() {
  return state.inventory
    .filter((item) => {
      const days = expiryDaysRemaining(item.expiresOn);
      return Number(item.quantity) > 0 && days !== null && days <= EXPIRY_WINDOW_DAYS;
    })
    .sort((first, second) => first.expiresOn.localeCompare(second.expiresOn));
}

function recipesUsingInventoryItem(item) {
  return state.recipes.filter((recipe) => (recipe.ingredients || []).some((ingredient) => matchingInventory(ingredient)?.id === item.id));
}

// General estimates used when the catalog has no entry (or no value for this storage type).
const CATEGORY_SHELF_LIFE_DAYS = {
  Fruit: { pantry: 5, fridge: 7, freezer: 180 },
  Vegetables: { pantry: 7, fridge: 7, freezer: 240 },
  Herbs: { pantry: 3, fridge: 7, freezer: 180 },
  Dairy: { pantry: 1, fridge: 7, freezer: 90 },
  'Meat and fish': { pantry: 1, fridge: 2, freezer: 120 },
  Bakery: { pantry: 4, fridge: 7, freezer: 90 },
  Baking: { pantry: 365, fridge: 365, freezer: 365 },
  Seasoning: { pantry: 730, fridge: 730, freezer: 730 },
  Pantry: { pantry: 365, fridge: 5, freezer: 180 },
};
const DEFAULT_SHELF_LIFE_DAYS = { pantry: 90, fridge: 7, freezer: 90 };

function shelfLifeDaysFor(name, location) {
  const record = ingredientRecord(name);
  const storage = /freezer|vriezer/i.test(location) ? 'freezer' : /fridge|koelkast/i.test(location) ? 'fridge' : 'pantry';
  const candidates = [record?.shelfLifeDays, CATEGORY_SHELF_LIFE_DAYS[record?.category], DEFAULT_SHELF_LIFE_DAYS];
  return candidates.map((shelfLife) => shelfLife?.[storage]).find(Number.isFinite) ?? null;
}

function backfillMissingExpirations() {
  let changed = false;
  for (const item of state.inventory) {
    if (item.kind === 'Household' || item.expiresOn) continue;
    const suggestion = suggestedExpiration(item.name, item.location);
    if (!suggestion) continue;
    item.expiresOn = suggestion.date;
    item.expirationSource = 'estimated';
    changed = true;
  }
  return changed;
}

function suggestedExpiration(name, location) {
  const days = shelfLifeDaysFor(name, location);
  if (days === null) return null;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return { date: dateKey(date), days };
}

function updateExpirationSuggestion(name, location, input, note) {
  if (input.value && input.dataset.estimated !== 'true') {
    note.textContent = 'Using your chosen package date.';
    return;
  }
  const suggestion = suggestedExpiration(name, location);
  if (!suggestion) {
    input.value = '';
    input.dataset.estimated = '';
    note.textContent = 'No general estimate for this item. Add the package date if available.';
    return;
  }
  input.value = suggestion.date;
  input.dataset.estimated = 'true';
  note.textContent = `Estimated ${suggestion.days} days for ${location}. Check or override with the package date.`;
}

function resolvedExpiration(name, location, input) {
  if (input.value) {
    return { expiresOn: input.value, expirationSource: input.dataset.estimated === 'true' ? 'estimated' : 'manual' };
  }
  const suggestion = suggestedExpiration(name, location);
  return suggestion
    ? { expiresOn: suggestion.date, expirationSource: 'estimated' }
    : { expiresOn: '', expirationSource: '' };
}

function expirationText(item) {
  const label = expirationLabel(item.expiresOn);
  return item.expirationSource === 'estimated' ? `Estimate · ${label}` : label;
}

function inventoryExpiryMarkup(item, tag) {
  if (item.expiresOn) return `<${tag} class="item-expiry ${expiryClass(item.expiresOn)}">${escapeHtml(expirationText(item))}</${tag}>`;
  return item.kind === 'Household' ? '' : `<${tag} class="item-expiry expiry-missing">No expiry date</${tag}>`;
}

function checkExpiryReminders() {
  const items = itemsNeedingExpiryAttention();
  if (!items.length || sendingExpiryReminder || localStorage.getItem(EXPIRY_REMINDERS_KEY) !== 'true') return;
  if (!window.isSecureContext || !('Notification' in window) || Notification.permission !== 'granted') return;
  const today = dateKey(new Date());
  if (localStorage.getItem(LAST_EXPIRY_REMINDER_KEY) === today) return;
  const names = items.slice(0, 3).map((item) => item.name).join(', ');
  const rest = items.length > 3 ? `, and ${items.length - 3} more` : '';
  const title = `${items.length} kitchen ${items.length === 1 ? 'item' : 'items'} to use soon`;
  const options = { body: `${names}${rest}`, tag: 'goodstock-expiration-reminder' };
  sendingExpiryReminder = true;
  const markSent = () => {
    localStorage.setItem(LAST_EXPIRY_REMINDER_KEY, today);
    sendingExpiryReminder = false;
  };
  const resetSending = () => { sendingExpiryReminder = false; };
  const showReminder = async () => {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.showNotification) return registration.showNotification(title, options);
    }
    return new Notification(title, options);
  };
  showReminder().then(markSent).catch(resetSending);
}

function missingIngredients(recipe) {
  return (recipe.ingredients || []).filter((ingredient) => !matchingInventory(ingredient));
}

function updateSyncStatus(mode, detail) {
  const dot = $('#sync-dot');
  const label = $('#sync-label');
  const text = $('#sync-detail');
  dot.className = `sync-dot ${mode}`;
  label.textContent = mode === 'offline' ? 'Working offline' : mode === 'pending' ? 'Changes queued' : 'Kitchen in sync';
  text.textContent = detail || (mode === 'offline' ? 'Will sync when reconnected' : 'Your kitchen, in sync');
}

async function pushPendingState() {
  if (syncing || !navigator.onLine) return;
  const pending = localStorage.getItem(PENDING_KEY);
  if (!pending) return;
  syncing = true;
  updateSyncStatus('pending', 'Sending saved changes');
  try {
    const response = await fetch('/api/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: pending,
    });
    if (!response.ok) throw new Error('Save failed');
    if (localStorage.getItem(PENDING_KEY) === pending) localStorage.removeItem(PENDING_KEY);
    updateSyncStatus('online');
  } catch {
    updateSyncStatus('pending', 'Will retry when reconnected');
  } finally {
    syncing = false;
    if (localStorage.getItem(PENDING_KEY) && navigator.onLine) queueMicrotask(pushPendingState);
  }
}

function persist() {
  const snapshot = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, snapshot);
  localStorage.setItem(PENDING_KEY, snapshot);
  render();
  checkExpiryReminders();
  pushPendingState();
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  const themeColor = $('meta[name="theme-color"]');
  if (themeColor) themeColor.content = isDark ? '#151d19' : '#f4f5ef';
  const toggle = $('#dark-mode-toggle');
  if (toggle) toggle.checked = isDark;
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
  const options = $('#ingredient-options');
  if (options) {
    options.innerHTML = ingredientCatalog.flatMap((ingredient) => [
      `<option value="${escapeHtml(ingredient.en)}" label="${escapeHtml(ingredient.nl)} · ${escapeHtml(ingredient.category)}"></option>`,
      `<option value="${escapeHtml(ingredient.nl)}" label="${escapeHtml(ingredient.en)} · ${escapeHtml(ingredient.category)}"></option>`,
    ]).join('');
  }
}

async function initialize() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');
  const cached = localStorage.getItem(STORAGE_KEY);
  const pending = localStorage.getItem(PENDING_KEY);
  if (cached) state = normalizeState(JSON.parse(cached));
  if (!pending && navigator.onLine) {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (response.ok) {
        const remote = await response.json();
        if (remote) state = normalizeState(remote);
        else localStorage.setItem(PENDING_KEY, JSON.stringify(state));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch {
      if (cached) updateSyncStatus('offline');
    }
  }
  if (!cached && !pending) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(PENDING_KEY, JSON.stringify(state));
  }
  await loadIngredientCatalog();
  if (backfillMissingExpirations()) {
    const snapshot = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, snapshot);
    localStorage.setItem(PENDING_KEY, snapshot);
  }
  inventoryMode = localStorage.getItem(INVENTORY_MODE_KEY) === 'map' ? 'map' : 'list';
  render();
  pushPendingState();
  fetch('/api/mealie/status').then((response) => response.json()).then((result) => {
    mealieConfigured = Boolean(result.configured);
  }).catch(() => { mealieConfigured = false; }).finally(() => {
    if (activeView === 'recipes') render();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  checkExpiryReminders();
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      if (activeView === 'inventory') render();
      checkExpiryReminders();
    }
  }, 60 * 60 * 1000);
}

function render() {
  const names = { inventory: 'INVENTORY', week: 'THIS WEEK', shopping: 'SHOPPING LIST', recipes: 'RECIPES' };
  $('#page-crumb').textContent = names[activeView];
  $('#today-label').textContent = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date());
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === activeView));
  const unchecked = state.shopping.filter((item) => !item.checked).length;
  $('#shopping-count').textContent = unchecked ? String(unchecked) : '';
  const views = { inventory: renderInventory, week: renderWeek, shopping: renderShopping, recipes: renderRecipes };
  $('#view-container').innerHTML = views[activeView]();
  updateSyncStatus(navigator.onLine ? (localStorage.getItem(PENDING_KEY) ? 'pending' : 'online') : 'offline');
}

function pageHeading(eyebrow, title, subtitle, action = '') {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}

function renderInventory() {
  const locations = ['All locations', ...state.locations];
  const rows = state.inventory.filter((item) => {
    const matchesText = `${item.name} ${item.kind}`.toLowerCase().includes(inventoryQuery.toLowerCase());
    return matchesText && (inventoryLocation === 'All locations' || item.location === inventoryLocation);
  });
  const foodCount = state.inventory.filter((item) => item.kind !== 'Household' && Number(item.quantity) > 0).length;
  const lowCount = state.inventory.filter((item) => Number(item.quantity) > 0 && Number(item.quantity) <= 1).length;
  const action = '<button class="button button-primary" data-action="add-item"><span aria-hidden="true">＋</span> Add item</button>';
  return `${pageHeading('THE KITCHEN, AT A GLANCE', 'Good things on hand.', 'A clear picture of what is here, and where it lives.', action)}
    <div class="stats-row"><div class="stat"><span class="stat-icon mint">▤</span><div><strong>${foodCount}</strong><span>food items</span></div></div><div class="stat"><span class="stat-icon coral">◷</span><div><strong>${lowCount}</strong><span>running low</span></div></div><div class="stat"><span class="stat-icon yellow">⌂</span><div><strong>${state.locations.length}</strong><span>storage spots</span></div></div></div>
    ${renderExpirationPanel()}
    <section class="section-block"><div class="section-heading"><div><h2>Everything in its place</h2><span class="muted">${rows.length} ${rows.length === 1 ? 'item' : 'items'}</span></div><div class="inventory-tools"><div class="filter-controls"><label class="search-field"><span aria-hidden="true">⌕</span><input id="inventory-search" value="${escapeHtml(inventoryQuery)}" placeholder="Find something" aria-label="Find an item" /></label><select id="location-filter" aria-label="Filter by location">${locations.map((location) => `<option ${inventoryLocation === location ? 'selected' : ''}>${escapeHtml(location)}</option>`).join('')}</select></div><div class="inventory-mode-switch" role="group" aria-label="Inventory display mode"><button class="${inventoryMode === 'list' ? 'active' : ''}" data-action="inventory-mode" data-mode="list" aria-pressed="${inventoryMode === 'list'}">List</button><button class="${inventoryMode === 'map' ? 'active' : ''}" data-action="inventory-mode" data-mode="map" aria-pressed="${inventoryMode === 'map'}">Map</button></div></div></div>
    ${inventoryMode === 'map' ? renderInventoryMap(rows) : rows.length ? `<div class="inventory-list">${rows.map((item) => `<article class="inventory-row"><div class="item-symbol ${item.kind === 'Household' ? 'household' : ''}" aria-hidden="true">${item.kind === 'Household' ? '⌂' : '◌'}</div><div class="item-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.location)} <i>·</i> ${escapeHtml(item.kind)}</span>${inventoryExpiryMarkup(item, 'span')}</div><div class="quantity-stepper"><button data-action="adjust" data-id="${escapeHtml(item.id)}" data-delta="-1" aria-label="Decrease ${escapeHtml(item.name)}">−</button><span>${escapeHtml(item.quantity)} <small>${escapeHtml(item.unit || '')}</small></span><button data-action="adjust" data-id="${escapeHtml(item.id)}" data-delta="1" aria-label="Increase ${escapeHtml(item.name)}">＋</button></div><button class="row-edit" data-action="edit-item" data-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}" title="Edit item">•••</button></article>`).join('')}</div>` : `<div class="empty-state"><span class="empty-mark">＋</span><strong>${inventoryQuery ? 'Nothing found just yet.' : 'A little room for the good stuff.'}</strong><p>${inventoryQuery ? 'Try another name or location.' : 'Add what you already have in your kitchen.'}</p>${inventoryQuery ? '' : '<button class="button button-primary" data-action="add-item">Add the first item</button>'}</div>`}</section>`;
}

function renderInventoryMap(rows) {
  if (!rows.length && inventoryQuery) return '<div class="empty-state"><span class="empty-mark">⌕</span><strong>Nothing found just yet.</strong><p>Try another name or location.</p></div>';
  const locations = [...new Set([...state.locations, ...rows.map((item) => item.location).filter(Boolean)])]
    .filter((location) => inventoryLocation === 'All locations' || location === inventoryLocation);
  const categoryIcons = { Fruit: '🍎', Vegetables: '🥕', Herbs: '🌿', Dairy: '🥛', 'Meat and fish': '🍗', Bakery: '🍞', Baking: '🥣', Pantry: '🥫' };
  const locationIcon = (location) => /freezer|fridge|koelkast|vriezer/i.test(location) ? '❄' : /pantry|voorraadkast/i.test(location) ? '▤' : /clean/i.test(location) ? '✦' : '⌂';
  const itemIcon = (item) => item.kind === 'Household' ? '🧽' : categoryIcons[ingredientRecord(item.name)?.category] || '◌';
  return `<div class="storage-map">${locations.map((location) => {
    const items = rows.filter((item) => item.location === location);
    return `<section class="storage-zone"><header class="storage-zone-heading"><span class="storage-zone-icon" aria-hidden="true">${locationIcon(location)}</span><div><h3>${escapeHtml(location)}</h3><span>${items.length} ${items.length === 1 ? 'item' : 'items'}</span></div><span class="storage-zone-total">${items.length}</span></header>${items.length ? `<div class="storage-items">${items.map((item) => `<article class="visual-item"><span class="visual-item-icon" aria-hidden="true">${itemIcon(item)}</span><div class="visual-item-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.kind)}</small>${inventoryExpiryMarkup(item, 'small')}</div><div class="visual-quantity"><strong>${escapeHtml(item.quantity)}</strong><small>${escapeHtml(item.unit || 'items')}</small></div><button class="row-edit" data-action="edit-item" data-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}" title="Edit item">•••</button></article>`).join('')}</div>` : '<p class="storage-zone-empty">Nothing stored here yet</p>'}</section>`;
  }).join('')}</div>`;
}

function renderExpirationPanel() {
  const expiringItems = itemsNeedingExpiryAttention();
  if (!expiringItems.length) return '';
  const rows = expiringItems.map((item) => {
    const recipes = recipesUsingInventoryItem(item);
    const suggestions = recipes.length
      ? `<div class="expiry-suggestions"><span>Try using it in</span>${recipes.slice(0, 2).map((recipe) => `<button class="text-button expiry-recipe-link" data-action="show-expiring-recipe" data-id="${escapeHtml(recipe.id)}">${escapeHtml(recipe.name)} <span aria-hidden="true">→</span></button>`).join('')}</div>`
      : '<span class="expiry-no-recipe">No saved recipe uses this yet</span>';
    return `<article class="expiry-row"><div class="expiry-item-info"><span class="expiry-mark" aria-hidden="true">!</span><div><strong>${escapeHtml(item.name)}</strong><span class="item-expiry ${expiryClass(item.expiresOn)}">${escapeHtml(expirationText(item))} · ${escapeHtml(item.quantity)} ${escapeHtml(item.unit || '')}</span></div></div>${suggestions}</article>`;
  }).join('');
  return `<section class="expiration-panel" aria-label="Items nearing expiration"><header><div><span class="eyebrow">USE SOON</span><h2>${expiringItems.length} ${expiringItems.length === 1 ? 'item' : 'items'} nearing their date</h2></div><span class="expiry-window">Past due + ${EXPIRY_WINDOW_DAYS} days</span></header><div class="expiry-list">${rows}</div></section>`;
}

function renderWeek() {
  const plans = currentWeekPlans();
  const weekEnd = dateAtOffset(6);
  const weekLabel = `${formatDate(weekStart, { month: 'short', day: 'numeric' })} – ${formatDate(weekEnd, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const dayButtons = Array.from({ length: 7 }, (_, index) => {
    const date = dateAtOffset(index);
    const key = dateKey(date);
    const count = plans.filter((entry) => entry.date === key).length;
    return `<button class="day-chip ${key === dateKey(selectedDate) ? 'selected' : ''}" data-action="select-date" data-date="${key}"><span>${formatDate(date, { weekday: 'short' }).toUpperCase()}</span><strong>${formatDate(date, { day: 'numeric' })}</strong>${count ? `<i>${count} planned</i>` : '<i>Open day</i>'}</button>`;
  }).join('');
  const selectedPlans = plans.filter((entry) => entry.date === dateKey(selectedDate));
  const selectedLabel = formatDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' });
  const planned = selectedPlans.length ? selectedPlans.map((entry) => {
    const recipe = recipeById(entry.recipeId);
    if (!recipe) return '';
    return `<article class="planned-meal ${entry.cooked ? 'is-cooked' : ''}"><span class="meal-index">${entry.cooked ? '✓' : '01'}</span><div class="planned-copy"><strong>${escapeHtml(recipe.name)}</strong><span>${entry.cooked ? 'Cooked and confirmed' : `${recipe.ingredients.length} ingredients`}</span></div>${entry.cooked ? '<span class="cooked-label">DONE</span>' : `<button class="button button-small button-outline" data-action="cook" data-id="${escapeHtml(entry.id)}">Cook & review</button>`}<button class="icon-button remove-button" data-action="remove-plan" data-id="${escapeHtml(entry.id)}" aria-label="Remove meal">×</button></article>`;
  }).join('') : '<div class="day-empty"><span aria-hidden="true">✳</span><p>No meal planned for this day.</p><small>Pick a recipe below to give the day a little shape.</small></div>';
  const recipeOptions = [...state.recipes].sort((first, second) => missingIngredients(first).length - missingIngredients(second).length);
  return `${pageHeading('A GOOD WEEK STARTS HERE', 'Make room for dinner.', 'Plan meals at your own pace. Your list will follow along.', '<button class="button button-outline" data-action="generate-shopping">Build shopping list <span aria-hidden="true">↗</span></button>')}
    <div class="week-navigation"><button class="icon-button" data-action="previous-week" aria-label="Previous week" title="Previous week">‹</button><label class="date-jump">Jump to date<input id="week-date" type="date" value="${dateKey(selectedDate)}" aria-label="Select a date" /></label><span class="week-range">${escapeHtml(weekLabel)}</span><button class="button button-quiet today-button" data-action="go-today">Today</button><button class="icon-button" data-action="next-week" aria-label="Next week" title="Next week">›</button></div>
    <section class="week-planner"><div class="week-strip">${dayButtons}</div><div class="day-detail"><div class="section-heading"><div><span class="eyebrow">YOUR PLAN</span><h2>${escapeHtml(selectedLabel)}</h2></div><span class="plan-count">${selectedPlans.length} ${selectedPlans.length === 1 ? 'meal' : 'meals'}</span></div><div class="planned-list">${planned}</div></div></section>
    <section class="section-block recipe-picker"><div class="section-heading"><div><span class="eyebrow">PICK SOMETHING GOOD</span><h2>Add a recipe to this day</h2></div><button class="text-button" data-view="recipes">Browse all recipes <span aria-hidden="true">→</span></button></div><div class="picker-grid">${recipeOptions.slice(0, 3).map((recipe) => `<article class="picker-item"><span class="recipe-number">${String(recipe.ingredients.length).padStart(2, '0')} INGREDIENTS</span><strong>${escapeHtml(recipe.name)}</strong><p>${escapeHtml(recipe.description || 'An idea from your recipe shelf.')}</p><div class="picker-foot"><span class="match-tag ${missingIngredients(recipe).length ? 'has-missing' : ''}">${missingIngredients(recipe).length ? `${missingIngredients(recipe).length} to pick up` : 'Ready to make'}</span><button class="button button-small button-dark" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">Add <span aria-hidden="true">＋</span></button></div></article>`).join('') || '<p class="muted">Add recipes in your recipe library first.</p>'}</div></section>`;
}

function renderShopping() {
  const remaining = state.shopping.filter((item) => !item.checked).length;
  const rows = state.shopping.map((item) => `<article class="shopping-row ${item.checked ? 'checked' : ''}"><label class="check-wrap"><input type="checkbox" data-action="check-shopping" data-id="${escapeHtml(item.id)}" ${item.checked ? 'checked' : ''} /><span class="custom-check" aria-hidden="true"></span><span class="shopping-name">${escapeHtml(item.name)}</span></label><span class="shopping-amount">${escapeHtml(item.quantity || '')} ${escapeHtml(item.unit || '')}</span>${item.checked ? `<button class="button button-small button-outline putaway-button" data-action="put-away" data-id="${escapeHtml(item.id)}">Put away</button>` : `<span class="shopping-source">${escapeHtml(item.source || 'Shopping list')}</span>`}</article>`).join('');
  const actions = `<div class="shopping-heading-actions">${state.shopping.length ? '<button class="button button-outline" data-action="show-shopping-qr">Share to phone <span aria-hidden="true">▦</span></button>' : ''}<button class="button button-outline" data-action="generate-shopping">Refresh from plan <span aria-hidden="true">↻</span></button></div>`;
  return `${pageHeading('OUT AND ABOUT', 'The list, in hand.', `${remaining} ${remaining === 1 ? 'thing' : 'things'} left to pick up. Check off as you go.`, actions)}
    <section class="section-block shopping-block"><div class="section-heading"><div><h2>This week’s list</h2><span class="muted">${state.shopping.length} items</span></div><div class="list-actions">${state.shopping.some((item) => item.checked) ? '<button class="text-button" data-action="clear-checked">Clear checked</button>' : ''}${state.shopping.length ? '<button class="text-button clear-list-button" data-action="clear-list">× Clear list</button>' : ''}</div></div>${rows ? `<div class="shopping-list">${rows}</div>` : '<div class="empty-state compact"><span class="empty-mark">☷</span><strong>Your list is nice and clear.</strong><p>Build it from the meals in your weekly plan.</p><button class="button button-primary" data-action="generate-shopping">Build from this week</button></div>'}</section>`;
}

function recipeCard(recipe, isRemote = false) {
  const missing = missingIngredients(recipe);
  const status = missing.length === 0 ? 'You have everything' : `${missing.length} missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`;
  const planned = currentWeekPlans().some((entry) => entry.recipeId === recipe.id);
  const button = isRemote
    ? `<button class="button button-small button-dark" data-action="import-recipe" data-id="${escapeHtml(recipe.slug || recipe.id)}">Add to library <span aria-hidden="true">＋</span></button>`
    : `<button class="button button-small ${planned ? 'button-outline' : 'button-dark'}" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">${planned ? 'Plan another day' : 'Plan this week'} <span aria-hidden="true">→</span></button>`;
  return `<article class="recipe-card"><div class="recipe-card-top"><span class="recipe-source">${escapeHtml(recipe.source || 'Kitchen collection')}</span><span class="recipe-ingredient-count">${recipe.ingredients?.length || 0} INGREDIENTS</span></div><h3>${escapeHtml(recipe.name)}</h3><p>${escapeHtml(recipe.description || 'A recipe from your collection.')}</p><div class="recipe-missing ${missing.length ? 'has-missing' : ''}"><span aria-hidden="true">${missing.length ? '◷' : '✓'}</span>${escapeHtml(status)}</div><div class="recipe-card-bottom">${button}</div></article>`;
}

function renderRecipes() {
  const localRecipes = state.recipes.filter((recipe) => `${recipe.name} ${recipe.description || ''} ${(recipe.ingredients || []).join(' ')}`.toLowerCase().includes(recipeQuery.toLowerCase()));
  const sorted = [...localRecipes].sort((first, second) => missingIngredients(first).length - missingIngredients(second).length);
  return `${pageHeading('FROM YOUR SHELF', 'What sounds good?', 'Find something to make with what you have, or a few things you could grab.', '')}
    <form class="recipe-search" id="recipe-search-form"><span aria-hidden="true">⌕</span><input id="recipe-search" value="${escapeHtml(recipeQuery)}" placeholder="Search recipes or ingredients" aria-label="Search recipes or ingredients"/><button class="button button-primary" type="submit">Search</button></form>
    ${mealieConfigured ? '<button class="button button-outline stock-search-button" data-action="search-stocked">Find with my inventory <span aria-hidden="true">↗</span></button>' : ''}
    <div class="recipe-results-heading"><div><span class="eyebrow">YOUR RECIPE BOX</span><h2>Closest to ready</h2></div><span class="muted">${sorted.length} recipes</span></div>
    <div class="recipe-grid">${sorted.length ? sorted.map((recipe) => recipeCard(recipe)).join('') : '<p class="muted">No recipes match that search.</p>'}</div>
    ${mealieConfigured ? `<div class="recipe-results-heading remote-heading"><div><span class="eyebrow">MEALIE LIBRARY</span><h2>${mealieResults.length ? 'From Mealie' : 'Search your recipes'}</h2></div><span class="muted">Connected</span></div><div class="recipe-grid">${mealieResults.map((recipe) => recipeCard(recipe, true)).join('')}</div>` : `<div class="integration-note"><span class="integration-mark">M</span><p><strong>Already using Mealie?</strong><br/>Connect it in your Portainer stack to search and import your recipe library here.</p><span class="integration-state">NOT CONNECTED</span></div>`}`;
}

function fillLocationSelect(select, selected) {
  select.innerHTML = state.locations.map((location) => `<option value="${escapeHtml(location)}" ${location === selected ? 'selected' : ''}>${escapeHtml(location)}</option>`).join('');
}

function openItemDialog(item) {
  const dialog = $('#item-dialog');
  const form = $('#item-form');
  $('#item-dialog-title').textContent = item ? 'Edit item' : 'Add an item';
  form.elements.id.value = item?.id || '';
  form.elements.name.value = item?.name || '';
  form.elements.quantity.value = item?.quantity ?? 1;
  form.elements.unit.value = item?.unit || '';
  form.elements.expiresOn.value = item?.expiresOn || '';
  form.elements.expiresOn.dataset.estimated = item?.expirationSource === 'estimated' ? 'true' : 'false';
  form.elements.kind.value = item?.kind || 'Food';
  fillLocationSelect(form.elements.location, item?.location || state.locations[0]);
  if (item?.expiresOn) {
    $('#expiry-estimate-note').textContent = item.expirationSource === 'estimated' ? 'Approximate estimate based on storage and typical shelf life. Check the package date.' : 'Using your chosen package date.';
  } else {
    updateExpirationSuggestion(form.elements.name.value, form.elements.location.value, form.elements.expiresOn, $('#expiry-estimate-note'));
  }
  dialog.showModal();
  form.elements.name.focus();
}

function openCookDialog(plan) {
  const recipe = recipeById(plan.recipeId);
  if (!recipe) return;
  $('#cook-title').textContent = `Cooked ${recipe.name}?`;
  $('#cook-form').elements.planId.value = plan.id;
  $('#cook-ingredients').innerHTML = recipe.ingredients.map((ingredient, index) => {
    const item = matchingInventory(ingredient);
    return `<label class="ingredient-check ${item ? '' : 'not-stocked'}"><input type="checkbox" name="ingredient" value="${index}" ${item ? 'checked' : ''}><span class="custom-check" aria-hidden="true"></span><span>${escapeHtml(ingredient)}</span><small>${item ? `in ${escapeHtml(item.location)}` : 'not in inventory'}</small></label>`;
  }).join('');
  $('#cook-dialog').showModal();
}

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
    const resultSets = await Promise.all(terms.map(async (term) => {
      const response = await fetch(`/api/mealie/recipes?search=${encodeURIComponent(term)}`);
      if (!response.ok) return [];
      return response.json();
    }));
    const unique = new Map(resultSets.flat().map((recipe) => [recipe.id || recipe.slug || recipe.name, recipe]));
    const details = await Promise.all([...unique.values()].slice(0, 20).map(async (recipe) => {
      if (recipe.ingredients?.length || !recipe.slug) return recipe;
      try {
        const response = await fetch(`/api/mealie/recipes/${encodeURIComponent(recipe.slug)}`);
        return response.ok ? response.json() : recipe;
      } catch { return recipe; }
    }));
    mealieResults = details.sort((first, second) => missingIngredients(first).length - missingIngredients(second).length);
  } catch {
    mealieResults = [];
  }
  if (activeView === 'recipes') render();
}

async function importMealieRecipe(id) {
  let recipe = mealieResults.find((entry) => entry.id === id || entry.slug === id);
  try {
    const response = await fetch(`/api/mealie/recipes/${encodeURIComponent(id)}`);
    if (response.ok) recipe = await response.json();
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
    const recipe = recipeById(plan.recipeId);
    if (!recipe || plan.cooked) continue;
    for (const ingredient of recipe.ingredients || []) {
      if (matchingInventory(ingredient)) continue;
      const name = ingredient.replace(/^\s*\d+(?:[./]\d+)?\s*/, '').trim();
      const key = cleanIngredient(name);
      const alreadyListed = state.shopping.some((entry) => cleanIngredient(entry.name) === key);
      const inAdditions = additions.some((entry) => cleanIngredient(entry.name) === key);
      if (name && !alreadyListed && !inAdditions) additions.push({ id: makeId(), name, quantity: 1, unit: '', checked: false, source: recipe.name });
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
  status.textContent = 'Preparing your shopping list link…';
  dialog.showModal();
  try {
    const response = await fetch('/api/shopping/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: state.shopping }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not create the download link');
    shoppingShareUrl = result.url;
    image.src = result.qrCode;
    image.hidden = false;
    link.href = result.url;
    link.hidden = false;
    status.textContent = 'Scan with your phone camera. The download link expires in 30 minutes.';
  } catch (error) {
    status.textContent = `${error.message}. Make sure the app is online and try again.`;
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
      $('#share-status').textContent = 'Download link copied. It expires in 30 minutes.';
    } catch {
      $('#share-status').textContent = 'Could not copy the link. Scan the QR code instead.';
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
  if (action === 'plan-recipe') {
    if (!currentWeekPlans().some((entry) => entry.date === dateKey(selectedDate) && entry.recipeId === id)) {
      state.plan.push({ id: makeId(), date: dateKey(selectedDate), recipeId: id, cooked: false });
      persist();
    }
    activeView = 'week';
    render();
  }
  if (action === 'remove-plan') { state.plan = state.plan.filter((entry) => entry.id !== id); persist(); }
  if (action === 'cook') openCookDialog(state.plan.find((entry) => entry.id === id));
  if (action === 'generate-shopping') generateShopping();
  if (action === 'search-stocked') {
    recipeQuery = '';
    mealieResults = [];
    searchMealie('');
    render();
  }
  if (action === 'clear-checked') { state.shopping = state.shopping.filter((entry) => !entry.checked); persist(); }
  if (action === 'put-away') {
    const item = state.shopping.find((entry) => entry.id === id);
    if (item) openPutawayDialog(item);
  }
  if (action === 'import-recipe') await importMealieRecipe(id);
  if (action === 'wipe-data' && window.confirm('This permanently deletes all inventory, saved recipes, plans, and shopping-list items. Continue?')) {
    $('#settings-dialog').close();
    state = { inventory: [], recipes: [], plan: [], shopping: [], locations: [...defaultLocations] };
    activeView = 'inventory';
    inventoryQuery = '';
    inventoryLocation = 'All locations';
    recipeQuery = '';
    mealieResults = [];
    persist();
  }
  if (action === 'clear-list' && state.shopping.length && window.confirm('Clear every item from the shopping list?')) {
    state.shopping = [];
    persist();
  }
});

document.addEventListener('input', (event) => {
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
    $(noteId).textContent = event.target.value ? 'Using your chosen package date.' : 'Leaving blank will use an estimate for supported products.';
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.id === 'location-filter') { inventoryLocation = event.target.value; render(); }
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
      note.textContent = 'The in-app Use soon panel remains available.';
      return;
    }
    if (!window.isSecureContext || !('Notification' in window)) {
      toggle.checked = false;
      note.textContent = 'System alerts need HTTPS and browser notification support. The in-app Use soon panel remains available.';
      return;
    }
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission === 'granted') {
        localStorage.setItem(EXPIRY_REMINDERS_KEY, 'true');
        note.textContent = 'Enabled. Goodstock checks for items due soon while the app is open.';
        checkExpiryReminders();
      } else {
        toggle.checked = false;
        localStorage.removeItem(EXPIRY_REMINDERS_KEY);
        note.textContent = 'Browser notifications are blocked. Allow them in browser settings; the in-app panel remains available.';
      }
    } catch {
      toggle.checked = false;
      localStorage.removeItem(EXPIRY_REMINDERS_KEY);
      note.textContent = 'Could not enable browser notifications. The in-app panel remains available.';
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
  const item = {
    id: form.elements.id.value || makeId(),
    name,
    quantity: Number(form.elements.quantity.value),
    unit: form.elements.unit.value.trim(),
    ...expiration,
    location,
    kind: form.elements.kind.value,
  };
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
      if (item) item.quantity = Math.max(0, Number(item.quantity) - 1);
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
    const existing = state.inventory.find((entry) => cleanIngredient(entry.name) === cleanIngredient(shoppingItem.name));
    const location = form.elements.location.value;
    const expiration = resolvedExpiration(shoppingItem.name, location, form.elements.expiresOn);
    if (existing) {
      existing.quantity = Number(existing.quantity) + Number(form.elements.quantity.value);
      if (form.elements.expiresOn.value && form.elements.expiresOn.dataset.estimated !== 'true') Object.assign(existing, expiration);
      else if (!existing.expiresOn && expiration.expiresOn) Object.assign(existing, expiration);
    }
    else state.inventory.unshift({
      id: makeId(), name: shoppingItem.name, quantity: Number(form.elements.quantity.value),
      unit: form.elements.unit.value.trim(), ...expiration, location, kind: 'Food',
    });
    state.shopping = state.shopping.filter((entry) => entry.id !== shoppingItem.id);
    persist();
  }
  $('#putaway-dialog').close();
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

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'recipe-search-form') return;
  event.preventDefault();
  recipeQuery = $('#recipe-search').value.trim();
  searchMealie(recipeQuery);
  render();
});

$('#settings-button').addEventListener('click', async () => {
  const form = $('#settings-form');
  form.elements.locations.value = state.locations.join(', ');
  $('#dark-mode-toggle').checked = document.documentElement.dataset.theme === 'dark';
  const expiryToggle = $('#expiry-notifications-toggle');
  const expiryNote = $('#expiry-notifications-note');
  const canNotify = window.isSecureContext && 'Notification' in window;
  expiryToggle.disabled = !canNotify;
  expiryToggle.checked = canNotify && localStorage.getItem(EXPIRY_REMINDERS_KEY) === 'true' && Notification.permission === 'granted';
  if (!window.isSecureContext) expiryNote.textContent = 'System alerts need HTTPS. The in-app Use soon panel remains available.';
  else if (!('Notification' in window)) expiryNote.textContent = 'This browser does not support system alerts. The in-app Use soon panel remains available.';
  else if (Notification.permission === 'denied') expiryNote.textContent = 'Browser notifications are blocked. Allow them in browser settings; the in-app panel remains available.';
  else expiryNote.textContent = 'System alerts are checked daily while the app is open. The in-app Use soon panel is always available.';
  const note = $('#mealie-note');
  try {
    const response = await fetch('/api/mealie/status');
    const result = await response.json();
    mealieConfigured = Boolean(result.configured);
    note.textContent = mealieConfigured ? 'Mealie recipe search is connected.' : 'Mealie is not connected yet.';
  } catch {
    note.textContent = 'Recipe connection status is unavailable while offline.';
  }
  $('#settings-dialog').showModal();
});

document.addEventListener('click', (event) => {
  if (event.target.matches('[data-close]')) event.target.closest('dialog').close();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkExpiryReminders();
});
window.addEventListener('focus', checkExpiryReminders);
window.addEventListener('online', () => { pushPendingState(); render(); });
window.addEventListener('offline', () => { updateSyncStatus('offline'); render(); });

initialize();