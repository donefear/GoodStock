// Goodstock, part 1 of 5: the phone bridge, Mealie access, kitchen state and starter content, the ingredient
// catalog and matching, quantities (parsing, metric, servings), and expiry dates and reminders.
// The parts load in order as plain scripts (see index.html) and share one global scope.

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
const defaultLocations = [N_('Pantry'), N_('Fridge'), N_('Freezer'), N_('Cleaning shelf')];
const starterRecipes = [
  { id: 'tomato-bean-soup', name: N_('Tomato & white bean soup'), description: N_('A bright, hearty one-pot lunch.'), ingredients: [N_('1 onion'), N_('2 cans white beans'), N_('1 can tomatoes'), N_('500 ml vegetable stock')], source: 'Goodstock', instructions: [N_('Chop the onion.'), N_('Soften the onion in a splash of oil over medium heat for 5 minutes.'), N_('Add the tomatoes, drained beans, and stock.'), N_('Simmer for 15 minutes.'), N_('Season with salt and pepper, then mash a few beans to thicken.')] },
  { id: 'lemon-pasta', name: N_('Lemony greens pasta'), description: N_('Fast pasta with greens and a little parmesan.'), ingredients: [N_('250 g pasta'), N_('100 g spinach'), N_('1 lemon'), N_('30 g parmesan')], source: 'Goodstock', instructions: [N_('Bring a big pot of salted water to the boil.'), N_('Cook the pasta for 10 minutes.'), N_('Zest and juice the lemon while the pasta cooks.'), N_('Add the spinach to the pot for the last minute.'), N_('Drain, keeping a cup of pasta water.'), N_('Toss with lemon, grated parmesan, and a splash of pasta water.')] },
  { id: 'crispy-potatoes', name: N_('Crispy potato tray'), description: N_('Crisp edges, soft middle, plenty of herbs.'), ingredients: [N_('1 kg potatoes'), N_('2 tbsp olive oil'), N_('3 cloves garlic'), N_('2 sprigs rosemary')], source: 'Goodstock', instructions: [N_('Heat the oven to 220°C.'), N_('Cut the potatoes into chunks.'), N_('Toss with olive oil, crushed garlic, rosemary, and salt on a tray.'), N_('Roast for 40 minutes, turning once halfway.')] },
  { id: 'oat-pancakes', name: N_('Everyday oat pancakes'), description: N_('A small-batch breakfast for slow mornings.'), ingredients: [N_('100 g rolled oats'), N_('2 eggs'), N_('150 ml milk'), N_('1 banana')], source: 'Goodstock', instructions: [N_('Blend the oats into a rough flour.'), N_('Mash the banana, then whisk in the eggs, milk, and oat flour.'), N_('Let the batter rest for 5 minutes.'), N_('Cook small pancakes in a hot oiled pan for 2 minutes per side.')] },
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// Phone apps (Android APK in android/, iPhone/iPad app in ios/): the native shell injects window.GoodstockNative. There is no server then; data lives only on
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
    nativeCallbacks.set(id, (ok, payload) => (ok ? resolve(payload) : reject(new Error(payload || t('The phone could not do that.')))));
    try { nativeApp[method](id, ...args); } catch (error) { nativeCallbacks.delete(id); reject(error); }
  });
}

// Messages from the server and the shared helpers (mealie.mjs, deepl.mjs, recipe-import.mjs) arrive in English and
// are passed through t() where they are shown; these lines put them in the translation tables.
N_('Mealie did not accept the API key.'); N_('DeepL did not accept the API key.'); N_('The DeepL character limit for this month is used up.');
N_('DeepL is busy. Try again in a moment.'); N_('That recipe is too long to translate in one go.');
N_('No recipe found on that page. Try copying the recipe text and pasting it instead.'); N_('That does not look like a web address.');
N_('Enter a Mealie API key. You can create one in Mealie under your user profile → API Tokens.');
N_('Paste your DeepL API key. You find it in your DeepL account under API Keys.'); N_('Nothing to translate, or too much at once.');
N_('The shopping list must contain between 1 and 200 items'); N_('The shopping list has no named items');
N_('Could not determine the application address for the QR code');
N_('Mealie at {url} took too long to answer.'); N_('Could not reach Mealie at {url}.'); N_('Mealie answered with HTTP {status}.');
N_('DeepL answered with HTTP {status}.'); N_('DeepL took too long to answer.'); N_('Could not reach DeepL. Check that the server has internet access.');
N_('The website took too long to answer.'); N_('Could not reach that website.'); N_('Could not save the Mealie settings.');
N_('Mealie is not configured'); N_('Request failed');

// An error to show: the English text stays the message (code checks it, e.g. for "API key"), and "local" holds the
// sentence in the app's language. Sentences with a value in them arrive as a template plus values ({ text, vars }).
const localMessage = (message) => (message && message.text ? t(message.text, message.vars) : t(String(message || '')));
function serverError(result, fallback) {
  const english = (result && result.error) || fallback;
  return Object.assign(new Error(english), { local: result && result.errorText ? t(result.errorText, result.errorVars) : t(english) });
}
const errorText = (error, fallback) => (error && error.local) || t((error && error.message) || fallback);

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
  if (!config) throw new Error(t('Mealie is not connected.'));
  let response;
  try {
    response = JSON.parse(await nativeCall('httpRequest', `${config.url}/api${path}`, JSON.stringify({ authorization: `Bearer ${config.apiKey}`, accept: 'application/json' })));
  } catch {
    throw Object.assign(new Error(t('Could not reach Mealie at {url}. Check the address and that this phone is on the same network.', { url: config.url })), { unreachable: true });
  }
  if (response.status >= 400) {
    const message = window.GoodstockMealie.mealieErrorTemplate(response.status, config.url);
    throw Object.assign(new Error(window.GoodstockMealie.mealieErrorMessage(response.status, config.url)), { local: localMessage(message) });
  }
  try { return JSON.parse(response.body); } catch { throw new Error(t('Found a website at {url}, but not the Mealie API. Check the address.', { url: config.url })); }
}

async function mealieSearch(term) {
  if (STANDALONE) {
    const { mealieRows, mapMealieRecipe } = window.GoodstockMealie;
    return mealieRows(await phoneMealieGet(`/recipes?${new URLSearchParams({ search: term, perPage: '40' })}`)).map(mapMealieRecipe);
  }
  const response = await fetch(`/api/mealie/recipes?search=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error(t('Mealie search failed.'));
  return response.json();
}

async function mealieRecipe(slug) {
  if (STANDALONE) return window.GoodstockMealie.mapMealieRecipe(await phoneMealieGet(`/recipes/${encodeURIComponent(slug)}`));
  const response = await fetch(`/api/mealie/recipes/${encodeURIComponent(slug)}`);
  if (!response.ok) throw new Error(t('That Mealie recipe is unavailable.'));
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

// A new kitchen starts in the device's language: storage places, sample items and starter recipes. After that
// they are the kitchen's own data and are not translated again (a shared kitchen keeps what it was given).
const localDefaultLocations = () => defaultLocations.map((location) => t(location));

function localStarterRecipe(recipe) {
  return {
    ...recipe,
    name: t(recipe.name),
    description: t(recipe.description),
    ingredients: recipe.ingredients.map((line) => t(line)),
    instructions: recipe.instructions.map((line) => t(line)),
    ...(currentLanguage === 'en' ? {} : { language: currentLanguage }),
  };
}

function freshState() {
  const [pantry, fridge, , cleaning] = localDefaultLocations();
  return {
    inventory: [
      { id: makeId(), name: t('Rolled oats'), quantity: 1, unit: 'bag', location: pantry, kind: 'Food' },
      { id: makeId(), name: t('Eggs'), quantity: 6, unit: 'pcs', location: fridge, kind: 'Food' },
      { id: makeId(), name: t('Potatoes'), quantity: 4, unit: 'pcs', location: pantry, kind: 'Food' },
      { id: makeId(), name: t('Dish soap'), quantity: 1, unit: 'bottle', location: cleaning, kind: 'Household' },
    ],
    recipes: starterRecipes.map(localStarterRecipe),
    plan: [],
    shopping: [],
    locations: localDefaultLocations(),
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
let recipePageId = '';
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
  return new Intl.DateTimeFormat(languageLocale(), options).format(date);
}

function currentWeekPlans() {
  const first = dateKey(weekStart);
  const last = dateKey(dateAtOffset(6));
  return state.plan.filter((entry) => entry.date >= first && entry.date <= last);
}

// Every name of a catalog ingredient, in all the app's languages ("de": ["Kartoffel", "Kartoffeln"]).
const CATALOG_LANGUAGES = ['en', 'nl', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ro', 'pl', 'tr'];
const catalogNames = (ingredient, code) => [].concat(ingredient[code] || []).filter(Boolean);
const CJK = /[぀-ヿ㐀-鿿]/;
let catalogIndex = { source: null, entries: [] };

function catalogAliases() {
  if (catalogIndex.source !== ingredientCatalog) {
    catalogIndex = {
      source: ingredientCatalog,
      entries: ingredientCatalog.map((ingredient) => ({
        ingredient,
        aliases: [...new Set(CATALOG_LANGUAGES.flatMap((code) => catalogNames(ingredient, code)).map(cleanIngredient).filter(Boolean))],
        // Dutch and German glue words together (kipfilet, Eierschale), so their short names may start a longer word.
        compounds: new Set(['nl', 'de'].flatMap((code) => catalogNames(ingredient, code)).map(cleanIngredient)),
      })),
    };
  }
  return catalogIndex.entries;
}

// The catalog entry an item or recipe line is about. An exact name wins; otherwise the longest name found inside
// it, so "sweet potato" is a sweet potato and not a potato. Short names (pan, sal) must be a whole word, or start one
// in Dutch and German (kipfilet);
// Chinese and Japanese names are found anywhere, since those languages put no spaces between words.
// Matching runs for every recipe line against every item on each redraw, so results are remembered per text.
let ingredientRecordCache = { source: null, results: new Map() };

function ingredientRecord(value) {
  if (ingredientRecordCache.source !== ingredientCatalog) ingredientRecordCache = { source: ingredientCatalog, results: new Map() };
  const key = String(value || '');
  if (!ingredientRecordCache.results.has(key)) ingredientRecordCache.results.set(key, findIngredientRecord(key));
  return ingredientRecordCache.results.get(key);
}

function findIngredientRecord(value) {
  const normalized = cleanIngredient(value);
  if (!normalized) return undefined;
  let best = null;
  let bestScore = 0;
  for (const { ingredient, aliases, compounds } of catalogAliases()) {
    for (const alias of aliases) {
      let score = 0;
      if (normalized === alias) score = 1000 + alias.length;
      else if (CJK.test(alias) ? normalized.includes(alias) : normalized.length > 4 && (alias.length > 3 ? normalized.includes(alias) : new RegExp(`(?:^| )${alias}${compounds.has(alias) ? '' : '(?: |$)'}`).test(normalized))) score = alias.length;
      if (score > bestScore) { best = ingredient; bestScore = score; }
    }
  }
  return best || undefined;
}

function ingredientTerms(value) {
  const normalized = cleanIngredient(value);
  const record = ingredientRecord(value);
  if (!record) return [normalized];
  return [normalized, ...catalogAliases().find((entry) => entry.ingredient === record).aliases];
}

function recipeById(id) {
  return state.recipes.find((recipe) => recipe.id === id || recipe.slug === id);
}

function cleanIngredient(value) {
  // Accents and other marks go, letters of every script stay (Cyrillic, Chinese, Japanese), and units and small
  // linking words ("of", "de", "di") are dropped, the same way for item names and for recipe lines.
  // Turkish dotless ı counts as i, so "ıspanak" and "Ispanak" are the same word.
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i')
    .replace(/^[\s\d\u00bc\u00bd\u00be\u2153\u2154\u215b\u215c\u215d\u215e./,\u2013-]+/, '')
    .replace(/\b(?:g|gr|kg|ml|l|oz|lb|lbs|cup|cups|tbsp|tsp|teaspoon|teaspoons|tablespoon|tablespoons|el|tl|can|cans|clove|cloves|piece|pieces|pcs|bunch|bunches|pinch|of|de|di|du|del|della|da|do|d|van|von|cdas?|cdtas?|cucharadas?|cucharaditas?|tazas?|cucchiai[oa]?|cucchiaini?|stk|st|uds?|pz)\b/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
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
  g: /^(?:g|gr|grams?|grammes?|г|гр|克)$/, kg: /^(?:kg|kilos?|kilograms?|кг|公斤|千克)$/, mg: /^(?:mg|milligrams?|мг)$/,
  ml: /^(?:ml|millilit(?:er|re)s?|мл|毫升)$/, cl: /^(?:cl|centilit(?:er|re)s?)$/, dl: /^(?:dl|decilit(?:er|re)s?)$/, l: /^(?:l|lit(?:er|re)s?|л|升)$/,
  oz: /^(?:oz|ounces?)$/, lb: /^(?:lbs?|pounds?)$/, 'fl oz': /^(?:fl\.?\s*oz|fluid\s+ounces?)$/,
  pint: /^(?:pints?|pt)$/, quart: /^(?:quarts?|qt)$/, gallon: /^(?:gallons?|gal)$/, inch: /^inch(?:es)?$/, cm: /^(?:cm|centimet(?:er|re)s?)$/,
  cup: /^(?:cups?|kopjes?|tazas?|tazze|tazza|tasses?)$/, tbsp: /^(?:tbsps?|tbs|tablespoons?|el|eetlepels?|cdas?|cucharadas?|cucchiai[oa]?|linguri|lingură|łyżki|łyżka|łyżek)$/, tsp: /^(?:tsps?|teaspoons?|tl|theelepels?|cdtas?|cucharaditas?|cucchiaini?|lingurițe|linguriță|łyżeczki|łyżeczka|łyżeczek)$/,
  can: /^(?:cans?|tins?|blikj?e?s?)$/, jar: /^(?:jars?|potj?e?s?)$/, bag: /^(?:bags?|zakj?e?s?)$/, bottle: /^(?:bottles?|flessen|fles)$/,
  pack: /^(?:packs?|packets?|packages?|pakj?e?s?)$/, clove: /^(?:cloves?|teentjes?|tenen)$/, bunch: /^(?:bunch(?:es)?|bosj?e?s?)$/,
  pinch: /^(?:pinch(?:es)?|snufjes?|snuifjes?|snuf)$/, splash: /^(?:splash(?:es)?|dash(?:es)?|scheutjes?|scheut)$/, slice: /^(?:slices?|plakj?e?s?)$/, sprig: /^(?:sprigs?|takjes?)$/, handful: /^(?:handfuls?|handjes?)$/,
  stick: /^sticks?$/, pcs: /^(?:pcs?|pieces?|stuks?|st|x|whole|items?|stk|stück|uds?|un|pz|buc|bucăți|bucată|szt|sztuki|sztuk|adet|шт|個|个)$/,
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

// Servings. A recipe may say how many it serves; its page can scale it, and a planned meal remembers its scale, so
// cook mode, the shopping list and "Cooked" use the scaled amounts. Only the amount at the start of an ingredient
// line changes ("2–3 cloves garlic" → "4–6 cloves garlic").
const AMOUNT_AT_START = new RegExp(String.raw`^(${AMOUNT_SOURCE})(?:(\s*(?:-|–|to|tot)\s*)(${AMOUNT_SOURCE}))?`);
const recipeScales = new Map(); // recipe id → scale chosen on its page during this visit

function scaleIngredientLine(line, factor) {
  const text = String(line || '').trim();
  if (!factor || factor === 1) return text;
  const match = AMOUNT_AT_START.exec(text);
  if (!match) return text;
  const { unit } = parseIngredient(text);
  const scale = (amountText) => {
    const value = parseAmount(amountText.trim());
    return value ? `${formatAmount(Math.round(value * factor * 100) / 100, unit)}${/\s*$/.exec(amountText)[0]}` : amountText;
  };
  return `${scale(match[1])}${match[3] ? `${match[2]}${scale(match[3])}` : ''}${text.slice(match[0].length)}`;
}

function scaledRecipe(recipe, factor = 1) {
  if (!recipe || !factor || factor === 1) return recipe;
  return { ...recipe, ingredients: (recipe.ingredients || []).map((line) => scaleIngredientLine(line, factor)), scale: factor };
}

const planScale = (plan) => (plan && Number(plan.scale) > 0 ? Number(plan.scale) : 1);

// "6 servings" when the recipe says how many it serves, otherwise "×2" (or "Original amounts").
function scaleLabel(recipe, factor) {
  if (recipe.servings) return tp(Math.max(1, Math.round(recipe.servings * factor)), '{count} serving', '{count} servings');
  return factor === 1 ? t('Original amounts') : `×${formatAmount(factor, '')}`;
}

const SCALE_STEPS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8];

function nextScale(recipe, factor, direction) {
  if (recipe.servings) {
    const servings = Math.min(100, Math.max(1, Math.round(recipe.servings * factor) + direction));
    return servings / recipe.servings;
  }
  const index = SCALE_STEPS.findIndex((step) => step >= factor - 0.001);
  return SCALE_STEPS[Math.min(SCALE_STEPS.length - 1, Math.max(0, (index < 0 ? 2 : index) + direction))];
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
  if (days < 0) return tp(Math.abs(days), 'Expired {count} day ago · {date}', 'Expired {count} days ago · {date}', { date });
  if (days === 0) return t('Expires today · {date}', { date });
  if (days === 1) return t('Expires tomorrow · {date}', { date });
  if (days <= EXPIRY_WINDOW_DAYS) return tp(days, 'Expires in {count} day · {date}', 'Expires in {count} days · {date}', { date });
  return t('Expires {date}', { date });
}

function expiryClass(value) {
  const days = expiryDaysRemaining(value);
  return days !== null && days < 0 ? 'expired' : days !== null && days <= EXPIRY_WINDOW_DAYS ? 'expiring' : 'expiry-normal';
}

// Items due within the window, as seen on a given day (today by default): days ahead shift every countdown.
function itemsNeedingExpiryAttention(daysAhead = 0) {
  return state.inventory
    .filter((item) => {
      const days = expiryDaysRemaining(item.expiresOn);
      return Number(item.quantity) > 0 && days !== null && days - daysAhead <= EXPIRY_WINDOW_DAYS;
    })
    .sort((first, second) => first.expiresOn.localeCompare(second.expiresOn));
}

function expiryReminderText(items) {
  const names = items.slice(0, 3).map((item) => item.name).join(', ');
  const rest = items.length > 3 ? tp(items.length - 3, ', and {count} more', ', and {count} more') : '';
  return { title: tp(items.length, '{count} kitchen item to use soon', '{count} kitchen items to use soon'), body: `${names}${rest}` };
}

// Phone apps schedule the reminder for the next seven mornings at 9:00, each with what will be due that day, so it
// comes while the app is closed. Redone whenever the kitchen changes or the app opens; an empty list cancels them.
const REMINDER_HOUR = 9;
let scheduledRemindersSignature = '';

function scheduleExpiryReminders() {
  if (!STANDALONE || !nativeApp.setReminders) return;
  const reminders = [];
  if (localStorage.getItem(EXPIRY_REMINDERS_KEY) === 'true') {
    const now = new Date();
    for (let day = 0; day < 7; day++) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, REMINDER_HOUR);
      if (at <= now) continue;
      const items = itemsNeedingExpiryAttention(day);
      if (!items.length) continue;
      const { title, body } = expiryReminderText(items);
      reminders.push({ id: dateKey(at), at: at.getTime(), title, text: body });
    }
  }
  const signature = JSON.stringify(reminders);
  if (signature === scheduledRemindersSignature) return;
  scheduledRemindersSignature = signature;
  try { nativeApp.setReminders(signature); } catch { /* The in-app panel still shows them. */ }
}

function recipesUsingInventoryItem(item) {
  return state.recipes.filter((recipe) => (recipe.ingredients || []).some((ingredient) => matchingInventory(ingredient)?.id === item.id));
}

// Storage locations are the kitchen's own names, in any language; these words decide which kind of storage it is.
const FREEZER_WORDS = /freezer|vriezer|diepvries|gefrier|tiefkühl|congélateur|congelador|congelatore|congelator|zamrażar|dondurucu|морозил|冷冻|冷凍/i;
const FRIDGE_WORDS = /fridge|koelkast|kühlschrank|réfrigérateur|frigo|nevera|frigorífico|geladeira|frigorifero|frigider|lodówk|buzdolab|холодильник|冰箱|冷蔵/i;
const PANTRY_WORDS = /pantry|voorraad|vorrat|speisekammer|garde-manger|placard|despensa|dispensa|cămar|spiżar|kiler|кладов|食品|パントリー|食料/i;

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
// Ingredient categories from ingredients.json, translated where they are shown.
N_('Fruit'); N_('Vegetables'); N_('Herbs'); N_('Dairy'); N_('Meat and fish'); N_('Bakery'); N_('Baking'); N_('Seasoning'); N_('Pantry');

function shelfLifeDaysFor(name, location) {
  const record = ingredientRecord(name);
  const storage = FREEZER_WORDS.test(location) ? 'freezer' : FRIDGE_WORDS.test(location) ? 'fridge' : 'pantry';
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
    note.textContent = t('Using your chosen package date.');
    return;
  }
  const suggestion = suggestedExpiration(name, location);
  if (!suggestion) {
    input.value = '';
    input.dataset.estimated = '';
    note.textContent = t('No general estimate for this item. Add the package date if available.');
    return;
  }
  input.value = suggestion.date;
  input.dataset.estimated = 'true';
  note.textContent = tp(suggestion.days, 'Estimated {count} day for {location}. Check or override with the package date.', 'Estimated {count} days for {location}. Check or override with the package date.', { location });
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
  return item.expirationSource === 'estimated' ? t('Estimate · {label}', { label }) : label;
}

function inventoryExpiryMarkup(item, tag) {
  if (item.expiresOn) return `<${tag} class="item-expiry ${expiryClass(item.expiresOn)}">${escapeHtml(expirationText(item))}</${tag}>`;
  return item.kind === 'Household' ? '' : `<${tag} class="item-expiry expiry-missing">${t('No expiry date')}</${tag}>`;
}

function checkExpiryReminders() {
  scheduleExpiryReminders();
  const items = itemsNeedingExpiryAttention();
  if (!items.length || sendingExpiryReminder || localStorage.getItem(EXPIRY_REMINDERS_KEY) !== 'true') return;
  // Phones with scheduled reminders get today's at 9:00; only after 9:00 does opening the app send it straight away.
  if (STANDALONE && nativeApp.setReminders && new Date().getHours() < REMINDER_HOUR) return;
  if (!STANDALONE && (!window.isSecureContext || !('Notification' in window) || Notification.permission !== 'granted')) return;
  const today = dateKey(new Date());
  if (localStorage.getItem(LAST_EXPIRY_REMINDER_KEY) === today) return;
  const { title, body } = expiryReminderText(items);
  const options = { body, tag: 'goodstock-expiration-reminder' };
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
