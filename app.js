const STORAGE_KEY = 'goodstock-state-v1';
const PENDING_KEY = 'goodstock-pending-v1';
const THEME_KEY = 'goodstock-theme-v1';
const INGREDIENTS_KEY = 'goodstock-ingredients-v1';
const INVENTORY_MODE_KEY = 'goodstock-inventory-mode-v1';
const EXPIRY_REMINDERS_KEY = 'goodstock-expiry-reminders-v1';
const LAST_EXPIRY_REMINDER_KEY = 'goodstock-last-expiry-reminder-v1';
const COOK_PROGRESS_KEY = 'goodstock-cook-progress-v1';
const TIMERS_KEY = 'goodstock-timers-v1';
const TIMER_RESTORE_LIMIT_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WINDOW_DAYS = 3;
const defaultLocations = ['Pantry', 'Fridge', 'Freezer', 'Cleaning shelf'];
const starterRecipes = [
  { id: 'tomato-bean-soup', name: 'Tomato & white bean soup', description: 'A bright, hearty one-pot lunch.', ingredients: ['1 onion', '2 cans white beans', '1 can tomatoes', '500 ml vegetable stock'], source: 'Goodstock', instructions: ['Chop the onion.', 'Soften the onion in a splash of oil over medium heat for 5 minutes.', 'Add the tomatoes, drained beans, and stock.', 'Simmer for 15 minutes.', 'Season with salt and pepper, then mash a few beans to thicken.'] },
  { id: 'lemon-pasta', name: 'Lemony greens pasta', description: 'Fast pasta with greens and a little parmesan.', ingredients: ['250 g pasta', '100 g spinach', '1 lemon', '30 g parmesan'], source: 'Goodstock', instructions: ['Bring a big pot of salted water to the boil.', 'Cook the pasta for 10 minutes.', 'Zest and juice the lemon while the pasta cooks.', 'Add the spinach to the pot for the last minute.', 'Drain, keeping a cup of pasta water.', 'Toss with lemon, grated parmesan, and a splash of pasta water.'] },
  { id: 'crispy-potatoes', name: 'Crispy potato tray', description: 'Crisp edges, soft middle, plenty of herbs.', ingredients: ['1 kg potatoes', '2 tbsp olive oil', '3 cloves garlic', '2 sprigs rosemary'], source: 'Goodstock', instructions: ['Heat the oven to 220°C.', 'Cut the potatoes into chunks.', 'Toss with olive oil, crushed garlic, rosemary, and salt on a tray.', 'Roast for 40 minutes, turning once halfway.'] },
  { id: 'oat-pancakes', name: 'Everyday oat pancakes', description: 'A small-batch breakfast for slow mornings.', ingredients: ['100 g rolled oats', '2 eggs', '150 ml milk', '1 banana'], source: 'Goodstock', instructions: ['Blend the oats into a rough flour.', 'Mash the banana, then whisk in the eggs, milk, and oat flour.', 'Let the batter rest for 5 minutes.', 'Cook small pancakes in a hot oiled pan for 2 minutes per side.'] },
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// Android app: the APK's native shell injects window.GoodstockNative. There is no server then; data lives only on
// the phone, and phone features stand in for server ones (alarms, notifications, sharing, fetching recipe pages).
const nativeApp = window.GoodstockNative || null;
const STANDALONE = Boolean(nativeApp);
const nativeCallbacks = new Map();
window.__goodstockNativeCallback = (id, ok, payload) => {
  const callback = nativeCallbacks.get(id);
  nativeCallbacks.delete(id);
  callback?.(ok, payload);
};

// Calls an async native method; the shell answers through window.__goodstockNativeCallback.
function nativeCall(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = makeId();
    nativeCallbacks.set(id, (ok, payload) => (ok ? resolve(payload) : reject(new Error(payload || 'The phone could not do that.'))));
    try { nativeApp[method](id, ...args); } catch (error) { nativeCallbacks.delete(id); reject(error); }
  });
}

// Mealie is reached one of two ways: in the browser through the server (which keeps the API key), in the Android
// app straight from the phone, with the connection saved on the phone.
const MEALIE_PHONE_KEY = 'goodstock-mealie-v1';

function phoneMealie() {
  try {
    const config = JSON.parse(localStorage.getItem(MEALIE_PHONE_KEY) || 'null');
    return config?.url && config?.apiKey ? config : null;
  } catch { return null; }
}

async function phoneMealieGet(path, config = phoneMealie()) {
  if (!config) throw new Error('Mealie is not connected.');
  let response;
  try {
    response = JSON.parse(await nativeCall('httpRequest', `${config.url}/api${path}`, JSON.stringify({ authorization: `Bearer ${config.apiKey}`, accept: 'application/json' })));
  } catch {
    throw new Error(`Could not reach Mealie at ${config.url}. Check the address and that this phone is on the same network.`);
  }
  if (response.status >= 400) throw new Error(window.GoodstockMealie.mealieErrorMessage(response.status, config.url));
  try { return JSON.parse(response.body); } catch { throw new Error(`Found a website at ${config.url}, but not the Mealie API. Check the address.`); }
}

async function mealieSearch(term) {
  if (STANDALONE) {
    const { mealieRows, mapMealieRecipe } = window.GoodstockMealie;
    return mealieRows(await phoneMealieGet(`/recipes?${new URLSearchParams({ search: term, perPage: '40' })}`)).map(mapMealieRecipe);
  }
  const response = await fetch(`/api/mealie/recipes?search=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('Mealie search failed.');
  return response.json();
}

async function mealieRecipe(slug) {
  if (STANDALONE) return window.GoodstockMealie.mapMealieRecipe(await phoneMealieGet(`/recipes/${encodeURIComponent(slug)}`));
  const response = await fetch(`/api/mealie/recipes/${encodeURIComponent(slug)}`);
  if (!response.ok) throw new Error('That Mealie recipe is unavailable.');
  return response.json();
}

function mealieOpenUrl(slug) {
  if (!STANDALONE) return `/api/mealie/open/${encodeURIComponent(slug)}`;
  const config = phoneMealie();
  return config ? window.GoodstockMealie.mealieRecipePageUrl(config.publicUrl || config.url, config.groupSlug, slug) : '';
}

// Keep the screen on while cooking: the Wake Lock API in a browser, a window flag in the Android app.
async function keepScreenOn(on) {
  if (STANDALONE) { try { nativeApp.keepScreenOn(on); } catch { /* Optional. */ } return; }
  if (on) {
    if (cookWakeLock) return;
    try { cookWakeLock = await navigator.wakeLock?.request('screen'); } catch { cookWakeLock = null; }
  } else {
    cookWakeLock?.release?.().catch(() => {});
    cookWakeLock = null;
  }
}

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
    timerPresets: [],
  };
}

// Starter recipes saved before they had amounts get the new ingredient lists, unless the user changed them.
const OLD_STARTER_INGREDIENTS = {
  'tomato-bean-soup': '["1 onion","2 cans white beans","1 can tomatoes","vegetable stock"]',
  'lemon-pasta': '["pasta","spinach","1 lemon","parmesan"]',
  'crispy-potatoes': '["potatoes","olive oil","garlic","rosemary"]',
  'oat-pancakes': '["rolled oats","2 eggs","milk","1 banana"]',
};

function upgradeStarterRecipe(recipe) {
  const starter = starterRecipes.find((entry) => entry.id === recipe?.id);
  if (!starter || JSON.stringify(recipe.ingredients) !== OLD_STARTER_INGREDIENTS[starter.id]) return recipe;
  return { ...recipe, ingredients: [...starter.ingredients] };
}

function normalizeState(value) {
  const defaults = freshState();
  if (!value || typeof value !== 'object') return defaults;
  return {
    inventory: Array.isArray(value.inventory) ? value.inventory.map(metricInventoryItem) : defaults.inventory,
    recipes: Array.isArray(value.recipes) ? value.recipes.map(upgradeStarterRecipe).map(metricRecipe) : defaults.recipes,
    plan: Array.isArray(value.plan) ? value.plan : [],
    shopping: Array.isArray(value.shopping) ? value.shopping.map(metricInventoryItem) : [],
    locations: Array.isArray(value.locations) && value.locations.length ? value.locations : defaults.locations,
    timerPresets: Array.isArray(value.timerPresets) ? value.timerPresets : [],
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
    .replace(/^[\s\d\u00bc\u00bd\u00be\u2153\u2154\u215b\u215c\u215d\u215e./,\u2013-]+/, '')
    .replace(/\b(?:g|kg|ml|l|oz|lb|lbs|cup|cups|tbsp|tsp|teaspoon|teaspoons|tablespoon|tablespoons|el|tl|can|cans|clove|cloves|piece|pieces|pcs|bunch|bunches|pinch|of)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ies$/, 'y')
    .replace(/s$/, '');
}

// Quantities: parse "1 1/2 cups flour" and convert imperial amounts to metric. Cups, tbsp and tsp stay as they are.
const FRACTION_GLYPHS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const AMOUNT_SOURCE = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?\s*[¼½¾⅓⅔⅛⅜⅝⅞]?|[¼½¾⅓⅔⅛⅜⅝⅞])`;
const INGREDIENT_PATTERN = new RegExp(String.raw`^(${AMOUNT_SOURCE})(?:\s*(?:-|–|to|tot)\s*${AMOUNT_SOURCE})?\s*(.*)$`, 'i');
const IMPERIAL_PATTERN = new RegExp(String.raw`(?<![\d.,/])(${AMOUNT_SOURCE})(?:\s*(-|–|to)\s*(${AMOUNT_SOURCE}))?\s*(fl\.?\s*oz|fluid\s+ounces?|ounces?|oz|pounds?|lbs?|pints?|quarts?|gallons?|inch(?:es)?)(?![a-z])\.?`, 'gi');
const FAHRENHEIT_PATTERN = /(\d{3})\s*(?:°\s*F|degrees?\s+F(?:ahrenheit)?|F)\b/g;
const UNIT_ALIASES = {
  g: /^(?:g|gr|grams?|grammes?)$/, kg: /^(?:kg|kilos?|kilograms?)$/, mg: /^(?:mg|milligrams?)$/,
  ml: /^(?:ml|millilit(?:er|re)s?)$/, cl: /^cl$/, dl: /^dl$/, l: /^(?:l|lit(?:er|re)s?)$/,
  oz: /^(?:oz|ounces?)$/, lb: /^(?:lbs?|pounds?)$/, 'fl oz': /^(?:fl\.?\s*oz|fluid\s+ounces?)$/,
  pint: /^(?:pints?|pt)$/, quart: /^(?:quarts?|qt)$/, gallon: /^(?:gallons?|gal)$/, inch: /^inch(?:es)?$/, cm: /^(?:cm|centimet(?:er|re)s?)$/,
  cup: /^(?:cups?|kopjes?)$/, tbsp: /^(?:tbsps?|tbs|tablespoons?|el|eetlepels?)$/, tsp: /^(?:tsps?|teaspoons?|tl|theelepels?)$/,
  can: /^(?:cans?|tins?|blikj?e?s?)$/, jar: /^(?:jars?|potj?e?s?)$/, bag: /^(?:bags?|zakj?e?s?)$/, bottle: /^(?:bottles?|flessen|fles)$/,
  pack: /^(?:packs?|packets?|packages?|pakj?e?s?)$/, clove: /^(?:cloves?|teentjes?|tenen)$/, bunch: /^(?:bunch(?:es)?|bosj?e?s?)$/,
  pinch: /^(?:pinch(?:es)?|snufjes?|snuf)$/, slice: /^(?:slices?|plakj?e?s?)$/, sprig: /^(?:sprigs?|takjes?)$/, handful: /^(?:handfuls?|handjes?)$/,
  stick: /^sticks?$/, pcs: /^(?:pcs?|pieces?|stuks?|st|x|whole|items?)$/,
};
const TO_METRIC = { oz: [28.3495, 'g'], lb: [453.592, 'g'], 'fl oz': [29.5735, 'ml'], pint: [473.176, 'ml'], quart: [946.353, 'ml'], gallon: [3785.41, 'ml'], inch: [2.54, 'cm'] };
const UNIT_SCALES = { mg: ['mass', 0.001], g: ['mass', 1], kg: ['mass', 1000], ml: ['volume', 1], cl: ['volume', 10], dl: ['volume', 100], l: ['volume', 1000], tsp: ['volume', 5], tbsp: ['volume', 15], cup: ['volume', 240] };
const FRACTION_UNITS = new Set(['cup', 'tbsp', 'tsp', '', 'pcs', 'can', 'jar', 'bag', 'bottle', 'pack', 'clove', 'bunch', 'pinch', 'slice', 'sprig', 'handful', 'stick']);

function parseAmount(text) {
  const value = String(text || '').trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(value);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(value);
  if (fraction) return Number(fraction[2]) ? Number(fraction[1]) / Number(fraction[2]) : null;
  const decimal = /^(\d+(?:[.,]\d+)?)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])?$/.exec(value);
  if (!decimal || (!decimal[1] && !decimal[2])) return null;
  return Number((decimal[1] || '0').replace(',', '.')) + (FRACTION_GLYPHS[decimal[2]] || 0);
}

function canonicalUnit(value) {
  const word = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!word) return '';
  return Object.keys(UNIT_ALIASES).find((unit) => UNIT_ALIASES[unit].test(word)) ?? null;
}

function parseIngredient(text) {
  const raw = String(text || '').trim();
  const match = INGREDIENT_PATTERN.exec(raw);
  if (!match) return { amount: null, unit: '', unitText: '', name: raw };
  const amount = parseAmount(match[1]) || null;
  const rest = match[2].trim();
  const unitMatch = /^(fl\.?\s*oz\.?|fluid\s+ounces?|[\p{L}]+\.?)(?:\s+(?:of|van)\b)?\s+(.+)$/iu.exec(rest);
  const unit = unitMatch ? canonicalUnit(unitMatch[1]) : null;
  const tidy = (name) => name.replace(/^\([^)]*\)\s*/, '').trim();
  if (unit) return { amount, unit, unitText: unitMatch[1].replace(/\.$/, ''), name: tidy(unitMatch[2]) };
  return { amount, unit: '', unitText: '', name: tidy(rest) || raw };
}

function roundMetric(value, unit) {
  if (unit === 'cm') return Math.max(0.5, Math.round(value * 2) / 2);
  if (value >= 1000) return { value: Math.round(value / 100) / 10, unit: unit === 'g' ? 'kg' : 'l' };
  const step = value < 20 ? 1 : value < 250 ? 5 : 10;
  return Math.max(1, Math.round(value / step) * step);
}

function metricAmount(amount, unit) {
  const conversion = TO_METRIC[unit];
  if (!conversion || !Number.isFinite(amount)) return { amount, unit };
  const rounded = roundMetric(amount * conversion[0], conversion[1]);
  return typeof rounded === 'object' ? { amount: rounded.value, unit: rounded.unit } : { amount: rounded, unit: conversion[1] };
}

function formatAmount(amount, unit = '') {
  if (!Number.isFinite(amount)) return '';
  const whole = Math.floor(amount);
  const part = amount - whole;
  if (FRACTION_UNITS.has(unit) && part > 0.01) {
    const glyph = Object.keys(FRACTION_GLYPHS).find((key) => Math.abs(FRACTION_GLYPHS[key] - part) < 0.02);
    if (glyph) return whole ? `${whole}${glyph}` : glyph;
  }
  return String(Math.round(amount * 100) / 100);
}

// Rewrites imperial amounts (8 oz, 1 lb, 2 pints, 350°F) anywhere in a line of text. Safe to run twice.
function metricText(text) {
  return String(text || '')
    .replace(IMPERIAL_PATTERN, (match, first, dash, second, unitWord) => {
      const unit = canonicalUnit(unitWord);
      const low = metricAmount(parseAmount(first), unit);
      if (!Number.isFinite(low.amount) || low.amount === null) return match;
      const high = second ? metricAmount(parseAmount(second), unit) : null;
      return high && high.unit === low.unit ? `${formatAmount(low.amount, low.unit)}–${formatAmount(high.amount, high.unit)} ${low.unit}` : `${formatAmount(low.amount, low.unit)} ${low.unit}`;
    })
    .replace(FAHRENHEIT_PATTERN, (match, degrees) => `${Math.round(((Number(degrees) - 32) * 5) / 9 / 5) * 5}°C`);
}

function metricIngredient(text) {
  const converted = metricText(text).replace(/^0+(?:[.,]0+)?\s+/, '');
  const decimal = /^(\d*[.,]\d+)\s/.exec(converted);
  const { amount, unit } = parseIngredient(converted);
  // "0.333 cup" → "⅓ cup"
  return decimal && amount && ['cup', 'tbsp', 'tsp'].includes(unit) ? `${formatAmount(amount, unit)}${converted.slice(decimal[1].length)}` : converted;
}

function metricRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return recipe;
  return {
    ...recipe,
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.map(metricIngredient) : recipe.ingredients,
    instructions: Array.isArray(recipe.instructions) ? recipe.instructions.map(metricText) : recipe.instructions,
  };
}

function metricInventoryItem(item) {
  const unit = canonicalUnit(item?.unit);
  if (!item || !TO_METRIC[unit]) return item;
  const converted = metricAmount(Number(item.quantity), unit);
  return { ...item, quantity: converted.amount, unit: converted.unit };
}

// How much of an inventory item a recipe line uses, in the item's own unit. 0 when the units can't be compared.
function deductionAmount(ingredient, item) {
  const { amount, unit } = parseIngredient(ingredient);
  const itemUnit = canonicalUnit(item.unit);
  const isCount = (value) => value === '' || value === 'pcs';
  if (amount === null) return isCount(itemUnit) ? 1 : 0;
  if (unit === itemUnit || (isCount(unit) && isCount(itemUnit))) return amount;
  const from = UNIT_SCALES[unit];
  const to = UNIT_SCALES[itemUnit];
  if (from && to && from[0] === to[0]) return Math.round((amount * from[1] / to[1]) * 100) / 100;
  return 0;
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
  if (!STANDALONE && (!window.isSecureContext || !('Notification' in window) || Notification.permission !== 'granted')) return;
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
    if (STANDALONE) return nativeApp.notify(title, options.body);
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
  if (STANDALONE) {
    dot.className = 'sync-dot online';
    label.textContent = 'Saved on this phone';
    text.textContent = 'Back up in Settings';
    return;
  }
  dot.className = `sync-dot ${mode}`;
  label.textContent = mode === 'offline' ? 'Working offline' : mode === 'pending' ? 'Changes queued' : 'Kitchen in sync';
  text.textContent = detail || (mode === 'offline' ? 'Will sync when reconnected' : 'Your kitchen, in sync');
}

async function pushPendingState() {
  if (STANDALONE || syncing || !navigator.onLine) return;
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
  if (!STANDALONE) localStorage.setItem(PENDING_KEY, snapshot);
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
  document.documentElement.classList.toggle('is-standalone', STANDALONE);
  const cached = localStorage.getItem(STORAGE_KEY);
  const pending = STANDALONE ? 'local' : localStorage.getItem(PENDING_KEY);
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
  if (!cached && (!pending || STANDALONE)) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!STANDALONE) localStorage.setItem(PENDING_KEY, JSON.stringify(state));
  }
  await loadIngredientCatalog();
  if (backfillMissingExpirations()) {
    const snapshot = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, snapshot);
    if (!STANDALONE) localStorage.setItem(PENDING_KEY, snapshot);
  }
  inventoryMode = localStorage.getItem(INVENTORY_MODE_KEY) === 'map' ? 'map' : 'list';
  loadTimers();
  render();
  pushPendingState();
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
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      if (activeView === 'inventory') render();
      checkExpiryReminders();
    }
  }, 60 * 60 * 1000);
}

function render() {
  const names = { inventory: 'INVENTORY', week: 'THIS WEEK', shopping: 'SHOPPING LIST', recipes: 'RECIPES', timers: 'TIMERS' };
  $('#page-crumb').textContent = names[activeView];
  $('#today-label').textContent = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date());
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === activeView));
  const unchecked = state.shopping.filter((item) => !item.checked).length;
  $('#shopping-count').textContent = unchecked ? String(unchecked) : '';
  const views = { inventory: renderInventory, week: renderWeek, shopping: renderShopping, recipes: renderRecipes, timers: renderTimers };
  $('#view-container').innerHTML = views[activeView]();
  refreshTimers();
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
    const title = mealieRecipeLink(recipe, 'mealie-link', escapeHtml(recipe.name))
      || `<button class="mealie-link recipe-title-link" type="button" data-action="view-recipe" data-id="${escapeHtml(recipe.id)}" title="Show recipe">${escapeHtml(recipe.name)} <span aria-hidden="true">→</span></button>`;
    return `<article class="planned-meal ${entry.cooked ? 'is-cooked' : ''}"><span class="meal-index">${entry.cooked ? '✓' : '01'}</span><div class="planned-copy"><strong>${title}</strong><span>${entry.cooked ? 'Cooked and confirmed' : `${recipe.ingredients.length} ingredients`}</span></div>${entry.cooked ? '<span class="cooked-label">DONE</span>' : `<div class="planned-actions"><button class="button button-small button-dark steps-start" data-action="start-steps" data-id="${escapeHtml(recipe.id)}" data-plan="${escapeHtml(entry.id)}" title="Cook it step by step">Steps <span aria-hidden="true">▶</span></button><button class="button button-small button-quiet" data-action="review-plan" data-id="${escapeHtml(entry.id)}" title="See what this needs and what you have">Review</button><button class="button button-small button-outline" data-action="cook" data-id="${escapeHtml(entry.id)}" title="Mark as cooked and remove the ingredients from stock">Cooked <span aria-hidden="true">✓</span></button></div>`}<button class="icon-button remove-button" data-action="remove-plan" data-id="${escapeHtml(entry.id)}" aria-label="Remove meal">×</button></article>`;
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
  const shareButton = STANDALONE
    ? '<button class="button button-outline" data-action="share-shopping-text">Share list <span aria-hidden="true">↗</span></button>'
    : '<button class="button button-outline" data-action="show-shopping-qr">Share to phone <span aria-hidden="true">▦</span></button>';
  const actions = `<div class="shopping-heading-actions">${state.shopping.length ? shareButton : ''}<button class="button button-outline" data-action="generate-shopping">Refresh from plan <span aria-hidden="true">↻</span></button></div>`;
  return `${pageHeading('OUT AND ABOUT', 'The list, in hand.', `${remaining} ${remaining === 1 ? 'thing' : 'things'} left to pick up. Check off as you go.`, actions)}
    <section class="section-block shopping-block"><div class="section-heading"><div><h2>This week’s list</h2><span class="muted">${state.shopping.length} items</span></div><div class="list-actions">${remaining ? '<button class="text-button" data-action="check-all">✓ Check all</button>' : ''}${state.shopping.some((item) => item.checked) ? '<button class="button button-small button-outline" data-action="put-all-away">Put all away</button><button class="text-button" data-action="clear-checked">Clear checked</button>' : ''}${state.shopping.length ? '<button class="text-button clear-list-button" data-action="clear-list">× Clear list</button>' : ''}</div></div>${rows ? `<div class="shopping-list">${rows}</div>` : '<div class="empty-state compact"><span class="empty-mark">☷</span><strong>Your list is nice and clear.</strong><p>Build it from the meals in your weekly plan.</p><button class="button button-primary" data-action="generate-shopping">Build from this week</button></div>'}</section>`;
}

// Timers tab: one-tap presets, a custom timer, and every running timer (recipe timers included).
const BUILT_IN_TIMER_PRESETS = [
  { name: 'Black tea', seconds: 240, icon: '☕' },
  { name: 'Green tea', seconds: 150, icon: '🍵' },
  { name: 'Herbal tea', seconds: 360, icon: '🌿' },
  { name: 'Soft-boiled egg', seconds: 360, icon: '🥚' },
  { name: 'Jammy egg', seconds: 450, icon: '🥚' },
  { name: 'Hard-boiled egg', seconds: 600, icon: '🥚' },
  { name: 'Pasta', seconds: 600, icon: '🍝' },
  { name: 'Rice', seconds: 720, icon: '🍚' },
  { name: 'French press', seconds: 240, icon: '☕' },
  { name: 'Frozen pizza', seconds: 720, icon: '🍕' },
];

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (!minutes) return `${rest} sec`;
  return rest ? `${minutes} min ${rest} sec` : `${minutes} min`;
}

function timerPresetButton(preset, saved = false) {
  const start = `<button class="timer-preset" type="button" data-action="timer-preset" data-name="${escapeHtml(preset.name)}" data-seconds="${preset.seconds}"><span class="timer-preset-icon" aria-hidden="true">${escapeHtml(preset.icon || '⏱')}</span><strong>${escapeHtml(preset.name)}</strong><small>${formatDuration(preset.seconds)}</small></button>`;
  return saved
    ? `<div class="timer-preset-saved">${start}<button class="timer-preset-remove" type="button" data-action="timer-preset-remove" data-id="${escapeHtml(preset.id)}" aria-label="Remove ${escapeHtml(preset.name)} preset">×</button></div>`
    : start;
}

function renderTimers() {
  const running = cookTimers.length;
  const saved = state.timerPresets || [];
  return `${pageHeading('ON THE CLOCK', 'Timers for anything.', running ? `${running} ${running === 1 ? 'timer' : 'timers'} going. Tap one to stop it or add a minute.` : 'Tea, eggs, pasta or anything else. Tap a preset or make your own.')}
    <section class="section-block"><div class="section-heading"><div><h2>Running</h2><span class="muted" id="timer-view-count">${running || 'None yet'}</span></div></div><div class="timer-list timer-view-list" id="timer-view-list"></div><p class="timer-view-empty" id="timer-view-empty"${running ? ' hidden' : ''}>Nothing running. Start one below.</p></section>
    <section class="section-block"><div class="section-heading"><div><h2>Quick start</h2><span class="muted">One tap</span></div></div><div class="timer-presets">${saved.map((preset) => timerPresetButton(preset, true)).join('')}${BUILT_IN_TIMER_PRESETS.map((preset) => timerPresetButton(preset)).join('')}</div></section>
    <section class="section-block"><div class="section-heading"><div><h2>Custom timer</h2></div></div>
      <form class="custom-timer-form" id="custom-timer-form">
        <label>What's it for?<input name="name" placeholder="e.g. Oat milk porridge" maxlength="40" autocomplete="off" /></label>
        <div class="custom-timer-time"><label>Minutes<input name="minutes" type="number" min="0" max="999" step="1" value="5" inputmode="numeric" /></label><label>Seconds<input name="seconds" type="number" min="0" max="59" step="1" value="0" inputmode="numeric" /></label></div>
        <label class="custom-timer-save"><input name="save" type="checkbox" /> Save as a quick-start preset</label>
        <button class="button button-primary" type="submit">Start timer ⏱</button>
      </form>
    </section>`;
}

function startCustomTimer(name, seconds) {
  if (!(seconds > 0)) return;
  unlockAlarmAudio();
  cookTimers.push({ id: makeId(), recipe: null, name: name || 'Timer', label: formatDuration(seconds), endsAt: Date.now() + seconds * 1000, done: false });
  timerTickId ??= setInterval(refreshTimers, 1000);
  if (activeView === 'timers') render(); else refreshTimers();
}

function extendTimer(id, seconds = 60) {
  const timer = cookTimers.find((entry) => entry.id === id);
  if (!timer) return;
  timer.endsAt = timer.done ? Date.now() + seconds * 1000 : timer.endsAt + seconds * 1000;
  timer.done = false;
  timerTickId ??= setInterval(refreshTimers, 1000);
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
  form.elements.ingredients.value = (recipe?.ingredients || []).join('\n');
  form.elements.instructions.value = recipeInstructions(recipe || {}).join('\n');
  $('#recipe-edit-title').textContent = recipe ? `Edit ${recipe.name}` : 'New recipe';
  $('#recipe-edit-eyebrow').textContent = recipe ? 'EDIT RECIPE' : 'YOUR RECIPE';
  $('#recipe-import').hidden = Boolean(recipe);
  $('#recipe-import').open = importFirst;
  $('#recipe-import-status').textContent = '';
  $('#recipe-edit-dialog').showModal();
  (importFirst ? form.elements.importUrl : form.elements.name).focus();
}

// Splits pasted recipe text into name, ingredients and steps. Headings ("Ingredients", "Method", "Bereiding") help;
// without them, short lines that start with an amount count as ingredients and everything else as steps.
function parseRecipeText(text) {
  const ingredientHeading = /^(?:ingredients?|ingredi[eë]nten|you(?:'ll| will)? need|what you need|benodigdheden)\s*:?$/i;
  const stepHeading = /^(?:instructions?|directions?|method|steps?|preparation|how to make it|bereiding(?:swijze)?|werkwijze)\s*:?$/i;
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
  status.textContent = 'Fetching the recipe…';
  try {
    let result;
    if (STANDALONE) {
      // No server in the Android app: the phone fetches the page and the shared parser reads it here.
      if (!/^https?:\/\//i.test(address)) { status.textContent = 'Only http and https links can be imported.'; return; }
      const page = JSON.parse(await nativeCall('fetchPage', address));
      if (page.status >= 400) { status.textContent = `The website refused the import (HTTP ${page.status}). Some sites block this; copy the recipe text and paste it instead.`; return; }
      result = window.GoodstockRecipeImport?.extractRecipeFromHtml(page.body, page.url || address);
      if (!result) { status.textContent = window.GoodstockRecipeImport?.NO_RECIPE_MESSAGE || 'No recipe found on that page.'; return; }
    } else {
      const response = await fetch(`/api/recipes/import?url=${encodeURIComponent(address)}`);
      result = await response.json().catch(() => ({}));
      if (!response.ok) { status.textContent = result.error || 'That recipe could not be imported.'; return; }
    }
    const host = (() => { try { return new URL(result.sourceUrl).hostname.replace(/^www\./, ''); } catch { return 'the website'; } })();
    result.instructions = tidyImportedSteps(result.instructions);
    fillRecipeEditor(result, `Imported from ${host}: ${result.ingredients.length} ingredients, ${result.instructions.length} steps. Check it, then save.`);
  } catch (error) {
    if (STANDALONE) status.textContent = navigator.onLine ? `Could not load that page${error?.message ? ` (${error.message})` : ''}.` : 'You are offline. Paste the recipe text instead.';
    else status.textContent = navigator.onLine ? 'Could not reach the app server.' : 'You are offline. Paste the recipe text instead.';
  }
}

// The Android app has no server for the QR link, so the list goes to the Android share sheet instead.
function shareShoppingText() {
  const lines = state.shopping.filter((item) => !item.checked).map((item) => `☐ ${item.name}${item.quantity ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}`);
  if (!lines.length) return;
  const text = `Shopping list\n${lines.join('\n')}`;
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
  activeView = 'recipes';
  render();
}

function deleteRecipe(id) {
  const recipe = recipeById(id);
  if (!recipe || !window.confirm(`Delete “${recipe.name}” from your recipes? Meals planned with it are removed too.`)) return;
  state.recipes = state.recipes.filter((entry) => entry.id !== recipe.id);
  state.plan = state.plan.filter((entry) => entry.recipeId !== recipe.id);
  persist();
  $('#recipe-dialog').close();
  render();
}

function recipeCard(recipe, isRemote = false) {
  const missing = missingIngredients(recipe);
  const status = missing.length === 0 ? 'You have everything' : `${missing.length} missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`;
  const planned = currentWeekPlans().some((entry) => entry.recipeId === recipe.id);
  const button = isRemote
    ? `<button class="button button-small button-dark" data-action="import-recipe" data-id="${escapeHtml(recipe.slug || recipe.id)}">Add to library <span aria-hidden="true">＋</span></button>`
    : `<button class="button button-small ${planned ? 'button-outline' : 'button-dark'}" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">${planned ? 'Plan another day' : 'Plan this week'} <span aria-hidden="true">→</span></button>`;
  return `<article class="recipe-card"><div class="recipe-card-top"><span class="recipe-source">${escapeHtml(recipe.source || 'Kitchen collection')}</span><span class="recipe-ingredient-count">${recipe.ingredients?.length || 0} INGREDIENTS</span></div><h3><button class="recipe-title-link recipe-card-title" type="button" data-action="view-recipe" data-id="${escapeHtml(isRemote ? recipe.slug || recipe.id : recipe.id)}" data-remote="${isRemote}" title="Show recipe">${escapeHtml(recipe.name)}</button></h3><p>${escapeHtml(recipe.description || 'A recipe from your collection.')}</p><div class="recipe-missing ${missing.length ? 'has-missing' : ''}"><span aria-hidden="true">${missing.length ? '◷' : '✓'}</span>${escapeHtml(status)}</div><div class="recipe-card-bottom">${button}</div></article>`;
}

function renderRecipes() {
  const localRecipes = state.recipes.filter((recipe) => `${recipe.name} ${recipe.description || ''} ${(recipe.ingredients || []).join(' ')}`.toLowerCase().includes(recipeQuery.toLowerCase()));
  const sorted = [...localRecipes].sort((first, second) => missingIngredients(first).length - missingIngredients(second).length);
  const actions = '<div class="recipe-heading-actions"><button class="button button-primary" data-action="new-recipe">＋ New recipe</button><button class="button button-outline" data-action="open-recipe-import">Import <span aria-hidden="true">↓</span></button></div>';
  return `${pageHeading('FROM YOUR SHELF', 'What sounds good?', 'Find something to make with what you have, or a few things you could grab.', actions)}
    <form class="recipe-search" id="recipe-search-form"><span aria-hidden="true">⌕</span><input id="recipe-search" value="${escapeHtml(recipeQuery)}" placeholder="Search recipes or ingredients" aria-label="Search recipes or ingredients"/><button class="button button-primary" type="submit">Search</button></form>
    ${mealieConfigured ? '<button class="button button-outline stock-search-button" data-action="search-stocked">Find with my inventory <span aria-hidden="true">↗</span></button>' : ''}
    <div class="recipe-results-heading"><div><span class="eyebrow">YOUR RECIPE BOX</span><h2>Closest to ready</h2></div><span class="muted">${sorted.length} recipes</span></div>
    <div class="recipe-grid">${sorted.length ? sorted.map((recipe) => recipeCard(recipe)).join('') : '<p class="muted">No recipes match that search.</p>'}</div>
    ${mealieConfigured ? `<div class="recipe-results-heading remote-heading"><div><span class="eyebrow">MEALIE LIBRARY</span><h2>${mealieResults.length ? 'From Mealie' : 'Search your recipes'}</h2></div><span class="muted">Connected</span></div><div class="recipe-grid">${mealieResults.map((recipe) => recipeCard(recipe, true)).join('')}</div>` : `<div class="integration-note"><span class="integration-mark">M</span><p><strong>Already using Mealie?</strong><br/>Connect it in Settings to search and import your recipe library here.</p><button class="button button-small button-outline" type="button" data-action="open-settings">Connect</button></div>`}`;
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
    const amount = item ? `<span class="cook-amount"><span>Remove</span><input type="number" name="amount-${index}" min="0" step="any" value="${Math.round(Math.min(deductionAmount(ingredient, item), Number(item.quantity)) * 100) / 100}" inputmode="decimal" aria-label="Amount of ${escapeHtml(item.name)} to remove"><span>${escapeHtml(item.unit || 'pcs')} <i>of ${escapeHtml(item.quantity)}</i></span></span>` : '';
    return `<label class="ingredient-check cook-check ${item ? '' : 'not-stocked'}"><input type="checkbox" name="ingredient" value="${index}" ${item ? 'checked' : ''}><span class="custom-check" aria-hidden="true"></span><span>${escapeHtml(ingredient)}</span><small>${item ? `in ${escapeHtml(item.location)}` : 'not in inventory'}</small>${amount}</label>`;
  }).join('');
  $('#cook-dialog').showModal();
}

function mealieRecipeLink(recipe, className, label) {
  const href = recipe.source === 'Mealie' && recipe.slug ? mealieOpenUrl(recipe.slug) : '';
  return href
    ? `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="Open recipe in Mealie">${label} <span aria-hidden="true">↗</span></a>`
    : '';
}

async function openRecipeDialog(id, isRemote, planId = '') {
  let recipe = isRemote ? mealieResults.find((entry) => entry.id === id || entry.slug === id) : recipeById(id);
  if (!recipe) return;
  if (isRemote && !recipe.ingredients?.length && recipe.slug) {
    try {
      recipe = metricRecipe(await mealieRecipe(recipe.slug));
    } catch { /* Show the search-result details when Mealie is unavailable. */ }
  }
  $('#recipe-dialog-source').textContent = (recipe.source || 'Kitchen collection').toUpperCase();
  $('#recipe-dialog-title').textContent = recipe.name;
  $('#recipe-dialog-description').textContent = recipe.description || '';
  $('#recipe-dialog-description').hidden = !recipe.description;
  const ingredients = recipe.ingredients || [];
  $('#recipe-dialog-ingredients').innerHTML = ingredients.length
    ? ingredients.map((ingredient) => {
      const item = matchingInventory(ingredient);
      return `<li class="${item ? 'in-stock' : 'not-stocked'}"><span aria-hidden="true">${item ? '✓' : '○'}</span><span>${escapeHtml(ingredient)}</span><small>${item ? `in ${escapeHtml(item.location)}` : 'not in inventory'}</small></li>`;
    }).join('')
    : '<li class="not-stocked"><span></span><span>No ingredients listed.</span></li>';
  const planAction = planId
    ? ''
    : isRemote
      ? `<button class="button button-primary" type="button" data-action="import-recipe" data-id="${escapeHtml(recipe.slug || recipe.id)}">Add to library</button>`
      : `<button class="button button-primary" type="button" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">Plan this week</button>`;
  if (planId) {
    const missing = missingIngredients(recipe).length;
    $('#recipe-dialog-source').textContent = `REVIEW · ${missing ? `${missing} MISSING` : 'ALL IN STOCK'}`;
  }
  recipeDialogRecipe = recipe;
  recipeDialogPlanId = planId;
  const safeSourceUrl = /^https?:\/\//i.test(recipe.sourceUrl || '') ? recipe.sourceUrl : '';
  const manage = isRemote ? '' : `<button class="button button-quiet" type="button" data-action="edit-recipe" data-id="${escapeHtml(recipe.id)}">Edit</button><button class="button button-quiet recipe-delete-button" type="button" data-action="delete-recipe" data-id="${escapeHtml(recipe.id)}">Delete</button>`;
  const original = safeSourceUrl ? `<a class="button button-quiet" href="${escapeHtml(safeSourceUrl)}" target="_blank" rel="noopener noreferrer">Original <span aria-hidden="true">↗</span></a>` : '';
  $('#recipe-dialog-actions').innerHTML = `${manage}${original}${mealieRecipeLink(recipe, 'button button-quiet mealie-button', 'Open in Mealie')}<button class="button button-outline" type="button" data-action="start-steps" data-source="recipe-dialog">Step by step <span aria-hidden="true">▶</span></button>${planAction}`;
  const dialog = $('#recipe-dialog');
  if (!dialog.open) dialog.showModal();
}

// Step-by-step cook mode: one small, concrete action per screen.
const TIME_PATTERN = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to|tot)\s*(\d+))?\s*(hours?|hrs?|uur|uren|minutes?|minuten|minuut|mins?|seconds?|seconden|secs?)(?![a-z])/i;
const TEMPERATURE_PATTERN = /\d{2,3}\s*°\s*[CF]?/;
let recipeDialogRecipe = null;
let recipeDialogPlanId = '';
let cookSession = null;
let cookTimers = [];
let timerTickId = null;
let alarmLoopId = null;
let timerPanelOpen = false;
let cookWakeLock = null;

function readCookProgress() {
  try { return JSON.parse(localStorage.getItem(COOK_PROGRESS_KEY) || '{}'); } catch { return {}; }
}

function saveCookProgress() {
  if (!cookSession) return;
  const progress = readCookProgress();
  const finished = cookSession.index >= cookSession.bites.length - 1;
  if (finished || cookSession.index === 0) delete progress[cookSession.recipe.id]; else progress[cookSession.recipe.id] = cookSession.index;
  try { localStorage.setItem(COOK_PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Progress is a convenience only. */ }
}

function stepMinutes(text) {
  const match = TIME_PATTERN.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  const unit = match[3].toLowerCase();
  const minutes = /^(h|uur|uren)/.test(unit) ? value * 60 : /^s/.test(unit) ? value / 60 : value;
  return minutes > 0 ? { minutes, label: match[0].trim() } : null;
}

function isStepHeading(text) {
  return text.length <= 40 && !/[.!?:]$/.test(text) && text.split(/\s+/).length <= 4;
}

function splitIntoBites(text) {
  const cleaned = text.replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, '').trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9])/).flatMap((sentence) => sentence.length > 160 ? sentence.split(/;\s+/) : [sentence]);
  return sentences.reduce((bites, sentence) => {
    const previous = bites[bites.length - 1];
    if (previous && previous.length < 25) bites[bites.length - 1] = `${previous} ${sentence}`;
    else bites.push(sentence.trim());
    return bites;
  }, []).filter(Boolean);
}

function recipeInstructions(recipe) {
  if (Array.isArray(recipe.instructions) && recipe.instructions.length) return recipe.instructions;
  return starterRecipes.find((starter) => starter.id === recipe.id)?.instructions || [];
}

function unitLabel(unitText, amount) {
  if (amount <= 1 || !/^(?:cup|teaspoon|tablespoon|can|clove|jar|bag|bottle|pinch|slice|sprig|bunch|handful|stick|piece|pack|packet)$/i.test(unitText)) return unitText;
  return /(?:ch|sh)$/i.test(unitText) ? `${unitText}es` : `${unitText}s`;
}

// Puts each ingredient's amount in front of its first mention: "Add the sesame oil" → "Add 1 tbsp of sesame oil".
function addStepAmounts(steps, ingredients) {
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stem = (word) => escapeRegExp(word.replace(/(?:es|s)$/i, ''));
  for (const target of ingredients.map(parseIngredient).filter((entry) => entry.amount)) {
    const full = target.name.replace(/\([^)]*\)/g, ' ').split(',')[0].replace(/\s+/g, ' ').trim().toLowerCase();
    if (full.length < 2) continue;
    const words = full.split(' ');
    const head = words.length > 1 && words[words.length - 1].length > 3 ? words[words.length - 1] : '';
    // An article is dropped ("the oil" → "1 tbsp of oil"); a prep word stays after the amount ("3 cloves of crushed garlic").
    const prep = String.raw`\p{L}{2,}ed|ge\p{L}+(?:en|de|te)`;
    const prefix = String.raw`(?:(?:the|de|het)\s+)?(?:(${prep})\s+)?`;
    const patterns = [new RegExp(String.raw`\b${prefix}(${stem(full)}(?:e?s)?)\b`, 'iu')];
    if (head) patterns.push(new RegExp(String.raw`\b(?=(?:the|de|het|${prep})\s)${prefix}(${stem(head)}(?:e?s)?)\b`, 'iu'));
    for (const step of steps) {
      const match = patterns.map((pattern) => pattern.exec(step.text)).find(Boolean);
      if (!match) continue;
      const before = step.text.slice(0, match.index);
      if (/[\d¼½¾⅓⅔⅛⅜⅝⅞]\s*[\p{L}.]*\s*(?:of\s+|van\s+)?$/u.test(before)) break;
      const dutch = /\b(?:de|het|een|en|met|voeg|toe|snijd|bak|kook|minuten)\b/i.test(step.text);
      const unit = target.unitText ? ` ${unitLabel(target.unitText, target.amount)}${dutch ? '' : ' of'}` : '';
      const words = `${match[1] ? `${match[1]} ` : ''}${match[2]}`;
      step.text = `${before}\u0001${formatAmount(target.amount, target.unit)}${unit}\u0002 ${match.index === 0 ? words.toLowerCase() : words}${step.text.slice(match.index + match[0].length)}`;
      break;
    }
  }
}

function buildCookBites(recipe) {
  const bites = [];
  const ingredients = recipe.ingredients || [];
  for (let start = 0; start < ingredients.length; start += 6) {
    bites.push({ type: 'gather', items: ingredients.slice(start, start + 6), part: start / 6 + 1, parts: Math.ceil(ingredients.length / 6) });
  }
  const steps = [];
  let heading = '';
  for (const raw of recipeInstructions(recipe).map((text) => metricText(String(text).trim())).filter(Boolean)) {
    if (isStepHeading(raw)) {
      if (heading) steps.push({ type: 'step', heading: '', text: heading });
      heading = raw;
      continue;
    }
    for (const text of splitIntoBites(raw)) steps.push({ type: 'step', heading, text, timer: stepMinutes(text) });
    heading = '';
  }
  if (heading) steps.push({ type: 'step', heading: '', text: heading });
  addStepAmounts(steps, ingredients);
  const ovenIndex = steps.findIndex((step) => TEMPERATURE_PATTERN.test(step.text));
  if (ovenIndex > 0) {
    const temperature = steps[ovenIndex].text.match(TEMPERATURE_PATTERN)[0].replace(/\s+/g, '');
    steps.unshift({ type: 'step', heading: 'Heads-up', text: `Turn the oven on to ${temperature} now. You will need it in step ${ovenIndex + 2}.` });
  }
  for (const step of steps) step.tools = typeof kitchenToolsIn === 'function' ? kitchenToolsIn(step.text) : [];
  const tools = [...new Set(steps.flatMap((step) => step.tools))];
  if (tools.length) bites.push({ type: 'tools', tools });
  if (!steps.length) bites.push({ type: 'empty' });
  bites.push(...steps, { type: 'done' });
  return bites;
}

function highlightStepText(text) {
  const pattern = new RegExp(`${TIME_PATTERN.source}|${TEMPERATURE_PATTERN.source}`, 'gi');
  return escapeHtml(text).replace(pattern, (match) => `<mark>${match}</mark>`)
    .replace(/\u0001([^\u0002]*)\u0002/g, '<strong class="steps-amount">$1</strong>');
}

function formatTimer(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(safe / 3600);
  const rest = `${String(Math.floor((safe % 3600) / 60)).padStart(hours ? 2 : 1, '0')}:${String(safe % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${rest}` : rest;
}

// One shared audio context, unlocked by the tap on "Start timer" so the alarm may play later without a gesture.
let alarmAudio = null;

function unlockAlarmAudio() {
  try {
    alarmAudio ??= new AudioContext();
    if (alarmAudio.state === 'suspended') alarmAudio.resume().catch(() => {});
  } catch { alarmAudio = null; }
}

// Timers: any number can run at once, each tied to its recipe and step. The alarm beeps every 2 seconds
// while any timer has finished, until each finished timer is tapped or stopped.
function timerAlarm(timer) {
  if (!alarmLoopId) {
    timerBeep();
    alarmLoopId = setInterval(timerBeep, 2000);
  }
  // The Android app posts its own alarm notification when it is in the background.
  if (!STANDALONE && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Goodstock timer', { body: `${timerTitle(timer)}: ${timer.label} is done.`, tag: timer.id, requireInteraction: true });
  }
}

function timerBeep() {
  try {
    unlockAlarmAudio();
    const context = alarmAudio;
    [0, 0.35, 0.7].forEach((offset) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, context.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + offset + 0.3);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + offset);
      oscillator.stop(context.currentTime + offset + 0.3);
    });
  } catch { /* Sound is optional. */ }
  if (STANDALONE) { try { nativeApp.vibrate(700); } catch { /* Optional. */ } } else navigator.vibrate?.([300, 150, 300]);
}

const timerRemaining = (timer) => (timer.endsAt - Date.now()) / 1000;
// Finished timers first, then the one that ends soonest.
const timersByUrgency = (timers) => [...timers].sort((a, b) => Number(b.done) - Number(a.done) || a.endsAt - b.endsAt);
const currentStepTimer = () => cookSession && cookTimers.find((timer) => timer.recipe?.id === cookSession.recipe.id && timer.stepIndex === cookSession.index);

const timerTitle = (timer) => timer.recipe?.name || timer.name || 'Timer';

function timerPillText(timer) {
  return {
    time: timer.done ? 'Time is up!' : formatTimer(timerRemaining(timer)),
    label: `${timerTitle(timer)} · ${timer.done ? (timer.recipe ? 'tap to go back' : 'tap to clear') : timer.label}`,
  };
}

// Keyed update so the pills are not rebuilt every second (a tap mid-rebuild would get lost).
function syncTimerList(container, timers, { extend = false } = {}) {
  const wanted = new Set(timers.map((timer) => timer.id));
  for (const pill of [...container.children]) if (!wanted.has(pill.dataset.timerId)) pill.remove();
  timers.forEach((timer, position) => {
    let pill = container.querySelector(`[data-timer-id="${timer.id}"]`);
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'timer-pill';
      pill.dataset.timerId = timer.id;
      pill.innerHTML = `<button class="timer-pill-open" type="button" data-action="timer-open" data-timer="${escapeHtml(timer.id)}"><span class="timer-pill-icon" aria-hidden="true">⏱</span><span><strong></strong><small></small></span></button><button class="timer-pill-stop" type="button" data-action="timer-stop" data-timer="${escapeHtml(timer.id)}" aria-label="Stop timer">×</button>`;
      if (extend) pill.querySelector('.timer-pill-stop').insertAdjacentHTML('beforebegin', `<button class="timer-pill-extend" type="button" data-action="timer-extend" data-timer="${escapeHtml(timer.id)}" aria-label="Add one minute">+1 min</button>`);
    }
    if (container.children[position] !== pill) container.insertBefore(pill, container.children[position] || null);
    const text = timerPillText(timer);
    pill.classList.toggle('is-done', timer.done);
    pill.querySelector('strong').textContent = text.time;
    pill.querySelector('small').textContent = text.label;
  });
}

const APP_TITLE = document.title;
let titleFlashId = null;

// Timers are kept per browser, so a reload or closed tab picks up where it left off.
// Timers that ended more than an hour before the app opens again are dropped instead of ringing.
// Only writes when something changed, and never rewrites identical data: another tab reloads on every write,
// so an unconditional save would bounce between tabs forever.
let savedTimersSignature = '';
const timersSignature = (timers) => JSON.stringify(timers.map((timer) => [timer.id, timer.endsAt, Boolean(timer.done)]));

function saveTimers() {
  const signature = timersSignature(cookTimers);
  if (signature === savedTimersSignature) return;
  savedTimersSignature = signature;
  const snapshot = cookTimers.map(({ id, recipe, planId, stepIndex, label, name, endsAt, done }) => ({
    id, planId, stepIndex, label, name, endsAt, done,
    recipe: recipe && { id: recipe.id, slug: recipe.slug, name: recipe.name, source: recipe.source, ingredients: recipe.ingredients, instructions: recipe.instructions },
  }));
  syncNativeTimers();
  try {
    const value = snapshot.length ? JSON.stringify(snapshot) : null;
    if (localStorage.getItem(TIMERS_KEY) === value) return;
    if (value) localStorage.setItem(TIMERS_KEY, value); else localStorage.removeItem(TIMERS_KEY);
  } catch { /* Timers still run; they just won't survive a reload. */ }
}

// In the Android app, every timer also gets a system alarm, so it rings with the app in the background or the
// screen off. Timers that disappear here are cancelled there, including a notification that is still ringing.
function syncNativeTimers() {
  if (!STANDALONE) return;
  const timers = cookTimers.map((timer) => ({ id: timer.id, endsAt: timer.endsAt, done: Boolean(timer.done), title: timerTitle(timer), text: timer.label }));
  try { nativeApp.setTimers(JSON.stringify(timers)); } catch { /* In-app alarm still works while the app is open. */ }
}

function loadTimers() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(TIMERS_KEY) || '[]'); } catch { saved = []; }
  const now = Date.now();
  saved = Array.isArray(saved) ? saved : [];
  cookTimers = saved
    .filter((timer) => timer && timer.id && Number.isFinite(timer.endsAt) && now - timer.endsAt < TIMER_RESTORE_LIMIT_MS)
    .map((timer) => ({ ...timer, done: Boolean(timer.done) }));
  // What is stored now; refreshTimers only saves if dropping old timers or finishing one changes it.
  savedTimersSignature = timersSignature(saved.filter((timer) => timer && timer.id));
  syncNativeTimers();
  if (cookTimers.length) timerTickId ??= setInterval(refreshTimers, 1000);
  // Already-finished timers keep ringing, without sending their notification again.
  if (cookTimers.some((timer) => timer.done) && !alarmLoopId) {
    timerBeep();
    alarmLoopId = setInterval(timerBeep, 2000);
  }
  refreshTimers();
}

function refreshTimers() {
  for (const timer of cookTimers) {
    if (!timer.done && timerRemaining(timer) <= 0) {
      timer.done = true;
      timerAlarm(timer);
    }
  }
  saveTimers();
  if (alarmLoopId && !cookTimers.some((timer) => timer.done)) {
    clearInterval(alarmLoopId);
    alarmLoopId = null;
    navigator.vibrate?.(0);
  }
  if (!cookTimers.length && timerTickId) {
    clearInterval(timerTickId);
    timerTickId = null;
  }
  const stepsOpen = $('#steps-dialog').open;
  const here = stepsOpen ? currentStepTimer() : null;
  const others = timersByUrgency(cookTimers.filter((timer) => timer !== here));

  // Big countdown under this step's Start button.
  const inline = $('#steps-timer-inline');
  if (inline) {
    inline.hidden = !here;
    inline.classList.toggle('is-done', Boolean(here?.done));
    if (here) {
      inline.dataset.timer = here.id;
      inline.innerHTML = here.done ? '<strong>Time is up</strong><span>Tap to clear</span>' : `<strong>${formatTimer(timerRemaining(here))}</strong><span>Tap to stop</span>`;
    }
  }

  // Top-bar chip in step-by-step: the most urgent other timer and how many more. Tap to list them all.
  const chip = $('#steps-timer-chip');
  chip.hidden = !others.length;
  if (!others.length) timerPanelOpen = false;
  if (others.length) {
    const first = others[0];
    chip.classList.toggle('is-done', first.done);
    chip.textContent = `${first.done ? '⏰ Time is up' : `⏱ ${formatTimer(timerRemaining(first))}`}${others.length > 1 ? ` · +${others.length - 1} more` : ` · ${timerTitle(first)}`}`;
    chip.setAttribute('aria-expanded', String(timerPanelOpen));
  }
  const panel = $('#steps-timer-panel');
  panel.hidden = !stepsOpen || !timerPanelOpen;
  if (!panel.hidden) syncTimerList(panel, others);

  // Every timer on the Timers tab, with +1 min.
  const viewList = $('#timer-view-list');
  if (viewList) {
    syncTimerList(viewList, timersByUrgency(cookTimers), { extend: true });
    $('#timer-view-empty').hidden = cookTimers.length > 0;
    $('#timer-view-count').textContent = cookTimers.length ? String(cookTimers.length) : 'None yet';
  }
  $('#timer-count').textContent = cookTimers.length ? String(cookTimers.length) : '';

  // Stacked pills on the main screen while step-by-step is closed (the Timers tab already lists them).
  const floating = $('#floating-timers');
  floating.hidden = stepsOpen || !cookTimers.length || activeView === 'timers';
  if (!floating.hidden) syncTimerList(floating, timersByUrgency(cookTimers));

  const flash = cookTimers.some((timer) => timer.done);
  if (flash && !titleFlashId) {
    titleFlashId = setInterval(() => { document.title = document.title === APP_TITLE ? '⏰ Time is up!' : APP_TITLE; }, 1000);
  } else if (!flash && titleFlashId) {
    clearInterval(titleFlashId);
    titleFlashId = null;
    document.title = APP_TITLE;
  }
}

// Jump to the recipe and step a timer belongs to, switching recipes if needed. Tapping a finished timer also clears it.
function openTimerStep(id) {
  const timer = cookTimers.find((entry) => entry.id === id);
  if (!timer) return;
  if (timer.done) cookTimers = cookTimers.filter((entry) => entry !== timer);
  if (!timer.recipe) {
    if ($('#steps-dialog').open) $('#steps-dialog').close();
    activeView = 'timers';
    render();
    return;
  }
  if (cookSession?.recipe.id === timer.recipe.id) {
    cookSession.index = timer.stepIndex;
  } else {
    if (cookSession) saveCookProgress();
    cookSession = { recipe: timer.recipe, bites: buildCookBites(timer.recipe), index: timer.stepIndex, planId: timer.planId, checked: new Set(), resumed: false };
  }
  timerPanelOpen = false;
  renderCookStep();
  const dialog = $('#steps-dialog');
  if (!dialog.open) {
    dialog.showModal();
    keepScreenOn(true);
  }
  refreshTimers();
}

// Starting a step's timer again restarts it rather than adding a duplicate.
function startCookTimer(minutes, label) {
  if (!cookSession) return;
  unlockAlarmAudio();
  const existing = currentStepTimer();
  if (existing) cookTimers = cookTimers.filter((timer) => timer !== existing);
  cookTimers.push({ id: makeId(), recipe: cookSession.recipe, planId: cookSession.planId, stepIndex: cookSession.index, label, endsAt: Date.now() + minutes * 60_000, done: false });
  timerTickId ??= setInterval(refreshTimers, 1000);
  refreshTimers();
}

function stopCookTimer(id) {
  cookTimers = cookTimers.filter((timer) => timer.id !== id);
  refreshTimers();
}

function renderCookStep() {
  const { recipe, bites, index, checked } = cookSession;
  const bite = bites[index];
  const stepCount = bites.filter((entry) => entry.type === 'step').length;
  const stepNumber = bites.slice(0, index + 1).filter((entry) => entry.type === 'step').length;
  $('#steps-recipe-name').textContent = recipe.name;
  $('#steps-counter').textContent = bite.type === 'gather' || bite.type === 'tools' ? 'GET READY' : bite.type === 'done' ? 'FINISHED' : bite.type === 'empty' ? 'NO STEPS' : `STEP ${stepNumber} OF ${stepCount}`;
  $('#steps-progress-bar').style.width = `${Math.round((index / Math.max(1, bites.length - 1)) * 100)}%`;
  const resume = cookSession.resumed && index > 0 ? '<button class="text-button steps-restart" type="button" data-action="steps-restart">Resumed where you left off · start over</button>' : '';
  let body = '';
  if (bite.type === 'gather') {
    body = `<h3 class="steps-heading">Get these out${bite.parts > 1 ? ` (${bite.part}/${bite.parts})` : ''}</h3><p class="steps-hint">Tap each one as it lands on the counter.</p><div class="steps-gather">${bite.items.map((item) => {
      const key = `${index}:${item}`;
      const stocked = matchingInventory(item);
      return `<label class="ingredient-check"><input type="checkbox" data-steps-item="${escapeHtml(key)}" ${checked.has(key) ? 'checked' : ''}><span class="custom-check" aria-hidden="true"></span><span>${escapeHtml(item)}</span><small>${stocked ? escapeHtml(stocked.location) : 'not in inventory'}</small></label>`;
    }).join('')}</div>`;
  } else if (bite.type === 'tools') {
    body = `<h3 class="steps-heading">Tools you'll need</h3><p class="steps-hint">Tap each one once it's out and ready.</p><div class="steps-gather">${bite.tools.map((tool) => {
      const key = `${index}:${tool.id}`;
      return `<label class="ingredient-check tool-check"><input type="checkbox" data-steps-item="${escapeHtml(key)}" ${checked.has(key) ? 'checked' : ''}><span class="custom-check" aria-hidden="true"></span>${kitchenToolIcon(tool)}<span><strong>${escapeHtml(tool.name)}</strong><small>${escapeHtml(tool.description)}</small></span></label>`;
    }).join('')}</div>`;
  } else if (bite.type === 'step') {
    const timer = bite.timer
      ? `<button class="button button-outline steps-timer-button" type="button" data-action="steps-timer-start" data-minutes="${bite.timer.minutes}" data-label="${escapeHtml(bite.timer.label)}">⏱ Start ${escapeHtml(bite.timer.label)} timer</button><button class="steps-timer-inline" id="steps-timer-inline" type="button" data-action="timer-stop" aria-live="polite" hidden><strong>0:00</strong><span>Tap to stop</span></button>`
      : '';
    const tools = bite.tools?.length
      ? `<ul class="steps-tools" aria-label="Tools for this step">${bite.tools.map((tool) => `<li title="${escapeHtml(tool.description)}">${kitchenToolIcon(tool)}<span>${escapeHtml(tool.name)}</span></li>`).join('')}</ul>`
      : '';
    body = `${bite.heading ? `<span class="steps-step-heading">${escapeHtml(bite.heading)}</span>` : ''}<p class="steps-text">${highlightStepText(bite.text)}</p>${tools}${timer}`;
  } else if (bite.type === 'empty') {
    body = `<h3 class="steps-heading">No steps saved for this recipe</h3><p class="steps-hint">The ingredients are ready above. ${mealieRecipeLink(recipe, 'mealie-link', 'Check the full recipe in Mealie') || 'Add instructions to the recipe to get small steps here.'}</p>`;
  } else {
    const plan = cookSession.planId && state.plan.find((entry) => entry.id === cookSession.planId);
    body = `<div class="steps-done"><span aria-hidden="true">✓</span><h3 class="steps-heading">You did it.</h3><p class="steps-hint">${plan && !plan.cooked ? 'Mark it as cooked and take the used ingredients out of your stock.' : 'Enjoy your meal.'}</p>${plan && !plan.cooked ? `<button class="button button-primary" type="button" data-action="steps-review" data-id="${escapeHtml(plan.id)}">Mark as cooked ✓</button>` : ''}</div>`;
  }
  $('#steps-body').innerHTML = `${resume}${body}`;
  $('.steps-back').disabled = index === 0;
  $('.steps-next').textContent = index === bites.length - 1 ? 'Close' : index === bites.length - 2 ? 'Finish ›' : 'Next ›';
  refreshTimers();
}

async function startCookSteps(recipe, planId = '') {
  if (!recipe) return;
  if (recipe.source === 'Mealie' && recipe.slug && !Array.isArray(recipe.instructions)) {
    try {
      const details = metricRecipe(await mealieRecipe(recipe.slug));
      const saved = recipeById(recipe.id);
      if (saved) { saved.instructions = details.instructions || []; persist(); }
      recipe = { ...recipe, instructions: details.instructions || [] };
    } catch { /* Fall back to ingredients only while Mealie is unreachable. */ }
  }
  const bites = buildCookBites(recipe);
  const saved = readCookProgress()[recipe.id];
  const index = Number.isInteger(saved) && saved > 0 && saved < bites.length - 1 ? saved : 0;
  cookSession = { recipe, bites, index, planId, checked: new Set(), resumed: index > 0 };
  renderCookStep();
  const dialog = $('#steps-dialog');
  if (!dialog.open) dialog.showModal();
  await keepScreenOn(true);
}

function moveCookStep(direction) {
  if (!cookSession) return;
  const next = cookSession.index + direction;
  if (next >= cookSession.bites.length) { $('#steps-dialog').close(); return; }
  cookSession.index = Math.max(0, next);
  cookSession.resumed = false;
  saveCookProgress();
  renderCookStep();
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
    const recipe = recipeById(plan.recipeId);
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
  if (action === 'share-shopping-text') shareShoppingText();
  if (action === 'backup-data') await backupKitchen();
  if (action === 'mealie-save') await saveMealieSettings();
  if (action === 'mealie-disconnect') await disconnectMealie();
  if (action === 'open-settings') $('#settings-button').click();
  if (action === 'restore-data') $('#restore-file').click();
  if (action === 'view-recipe') openRecipeDialog(id, button.dataset.remote === 'true');
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
  if (action === 'check-all') { for (const entry of state.shopping) entry.checked = true; persist(); }
  if (action === 'put-all-away') {
    const checked = state.shopping.filter((entry) => entry.checked);
    if (checked.length && window.confirm(`Put ${checked.length} checked ${checked.length === 1 ? 'item' : 'items'} away? Each goes to its usual spot with an estimated expiry date. You can edit them in Inventory afterwards.`)) {
      for (const entry of checked) {
        const location = defaultStorageLocation(entry.name);
        storeShoppingItem(entry, { quantity: Number(entry.quantity) || 1, unit: String(entry.unit || '').trim(), location, expiration: resolvedExpiration(entry.name, location, { value: '', dataset: {} }), packageDate: false });
      }
      persist();
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
      ? `Found ${parsed.ingredients.length} ingredients and ${parsed.instructions.length} steps. Check them, then save.`
      : 'Nothing recognisable in that text yet.');
  }
  if (action === 'wipe-data') openWipeDialog();
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
  if (event.target.id === 'restore-file') {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await restoreKitchen(file);
    return;
  }
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
    if (STANDALONE) {
      const allowed = await nativeCall('requestNotifications').then((result) => result === 'granted').catch(() => false);
      toggle.checked = allowed;
      if (allowed) localStorage.setItem(EXPIRY_REMINDERS_KEY, 'true'); else localStorage.removeItem(EXPIRY_REMINDERS_KEY);
      note.textContent = allowed ? 'Enabled. Goodstock checks for items due soon when you open the app.' : 'Notifications are off for Goodstock. Allow them in Android settings; the in-app panel remains available.';
      if (allowed) checkExpiryReminders();
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
  const pattern = (shelfLife.fridge ?? 0) > (shelfLife.pantry ?? 0) ? /fridge|koelkast/i : /pantry|voorraad/i;
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
async function backupKitchen() {
  const fileName = `goodstock-backup-${dateKey(new Date())}.json`;
  const content = JSON.stringify({ app: 'goodstock', backupVersion: 1, exportedAt: new Date().toISOString(), state }, null, 2);
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
    status.textContent = `Saved ${fileName}.`;
  } catch (error) {
    status.textContent = error?.message === 'cancelled' ? '' : 'The backup could not be saved.';
  }
}

async function restoreKitchen(file) {
  const status = $('#backup-status');
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { status.textContent = 'That file is not a Goodstock backup.'; return; }
  const restored = parsed?.state || parsed;
  if (!restored || !Array.isArray(restored.inventory) || !Array.isArray(restored.recipes)) { status.textContent = 'That file is not a Goodstock backup.'; return; }
  const summary = `${restored.inventory.length} inventory items and ${restored.recipes.length} recipes`;
  if (!window.confirm(`Replace everything in this kitchen with the backup (${summary})? This cannot be undone.`)) return;
  state = normalizeState(restored);
  persist();
  status.textContent = `Restored ${summary}.`;
}

function openWipeDialog() {
  const count = (list, one, many) => `<li><strong>${list.length}</strong> ${list.length === 1 ? one : many}</li>`;
  $('#wipe-summary').innerHTML = count(state.inventory, 'inventory item', 'inventory items') + count(state.recipes, 'saved recipe', 'saved recipes')
    + count(state.plan, 'planned meal', 'planned meals') + count(state.shopping, 'shopping-list item', 'shopping-list items');
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
  state = { inventory: [], recipes: [], plan: [], shopping: [], locations: [...defaultLocations], timerPresets: [] };
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
  const form = $('#settings-form');
  form.elements.locations.value = state.locations.join(', ');
  $('#dark-mode-toggle').checked = document.documentElement.dataset.theme === 'dark';
  const expiryToggle = $('#expiry-notifications-toggle');
  const expiryNote = $('#expiry-notifications-note');
  const canNotify = STANDALONE || (window.isSecureContext && 'Notification' in window);
  expiryToggle.disabled = !canNotify;
  expiryToggle.checked = canNotify && localStorage.getItem(EXPIRY_REMINDERS_KEY) === 'true' && (STANDALONE ? nativeApp.notificationsAllowed() : Notification.permission === 'granted');
  if (STANDALONE) expiryNote.textContent = 'A daily Android notification for items due within 3 days, checked when you open the app. The in-app Use soon panel is always available.';
  else if (!window.isSecureContext) expiryNote.textContent = 'System alerts need HTTPS. The in-app Use soon panel remains available.';
  else if (!('Notification' in window)) expiryNote.textContent = 'This browser does not support system alerts. The in-app Use soon panel remains available.';
  else if (Notification.permission === 'denied') expiryNote.textContent = 'Browser notifications are blocked. Allow them in browser settings; the in-app panel remains available.';
  else expiryNote.textContent = 'System alerts are checked daily while the app is open. The in-app Use soon panel is always available.';
  $('#settings-dialog').showModal();
  await loadMealieSettings();
});

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
    form.elements.mealieKey.placeholder = config ? 'Saved. Leave empty to keep it.' : 'Paste a Mealie API token';
    $('#mealie-disconnect').hidden = !config;
    setMealieNote(config ? `Connected to ${config.url}.` : 'Not connected. Recipes added with New recipe or Import work without it.', config ? 'connected' : '');
    return;
  }
  try {
    const status = await (await fetch('/api/mealie/status')).json();
    mealieConfigured = Boolean(status.configured);
    form.elements.mealieUrl.value = status.url || '';
    form.elements.mealiePublicUrl.value = status.publicUrl || '';
    form.elements.mealieKey.placeholder = status.configured ? 'Saved. Leave empty to keep it.' : 'Paste a Mealie API token';
    $('#mealie-disconnect').hidden = status.source !== 'settings';
    setMealieNote(status.configured
      ? `Connected to ${status.url}${status.source === 'environment' ? ' (set in Portainer)' : ''}.`
      : 'Not connected yet.', status.configured ? 'connected' : '');
  } catch {
    setMealieNote('Mealie status is unavailable while offline.');
  }
}

// Tests the connection first and only saves it when Mealie accepts the key. An address typed without http:// or
// https:// tries https first, then http, which is what most home servers use.
async function saveMealieSettings() {
  const form = $('#settings-form');
  const typed = form.elements.mealieUrl.value.trim();
  if (typed && !/^https?:\/\//i.test(typed)) {
    await connectMealie(`https://${typed}`);
    if ($('#mealie-note').classList.contains('is-error') && /Could not reach/.test($('#mealie-note').textContent)) await connectMealie(`http://${typed}`);
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
  setMealieNote('Testing the connection…');
  try {
    let user = '';
    if (STANDALONE) {
      if (!url) throw new Error('Enter the address of your Mealie server.');
      const current = phoneMealie();
      // A new address needs the key typed again, so a saved key is never sent to a different server.
      const key = apiKey || (current?.url === url ? current.apiKey : '');
      if (!key) throw new Error('Enter a Mealie API key. You can create one in Mealie under your profile → API Tokens.');
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
      if (!response.ok) throw new Error(result.error || 'Could not connect to Mealie.');
      user = result.user || '';
    }
    await loadMealieSettings();
    setMealieNote(`Connected to ${url}${user ? ` as ${user}` : ''}.`, 'connected');
    mealieResults = [];
    render();
  } catch (error) {
    setMealieNote(error?.message || 'Could not connect to Mealie.', 'error');
  }
}

async function disconnectMealie() {
  if (!window.confirm('Disconnect Mealie? Recipes you already added to your library stay.')) return;
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
  saveCookProgress();
  keepScreenOn(false);
  refreshTimers();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkExpiryReminders();
});
window.addEventListener('focus', checkExpiryReminders);
window.addEventListener('online', () => { pushPendingState(); render(); });
// Keep timers in step across tabs of this browser.
window.addEventListener('storage', (event) => { if (event.key === TIMERS_KEY) loadTimers(); });

// Android app hooks. Back closes the top dialog, then returns to Inventory, then leaves the app.
window.goodstockBack = () => {
  const open = $$('dialog[open]');
  if (open.length) { open[open.length - 1].close(); return true; }
  if (activeView !== 'inventory') { activeView = 'inventory'; render(); return true; }
  return false;
};
// Coming back to the app: catch up on timers that ended while it was paused, and on expiry reminders.
window.goodstockResume = () => {
  refreshTimers();
  checkExpiryReminders();
};
// Browsers only allow sound after a tap, so the first touch after a reload unlocks the alarm.
document.addEventListener('pointerdown', unlockAlarmAudio, { once: true, capture: true });
window.addEventListener('offline', () => { updateSyncStatus('offline'); render(); });

initialize();