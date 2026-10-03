// Interface languages. English is written straight into the code and is the key for every translation: t('Save item')
// looks the English text up in the chosen language's table (lang/<code>.js) and falls back to English when a line
// has no translation yet. Placeholders in braces are filled in afterwards: t('Expires in {days} days', { days }).
// The language is a per-device preference, like the theme, because several people may share one kitchen.
const LANGUAGES = [
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'nl', name: 'Nederlands', locale: 'nl-NL' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'it', name: 'Italiano', locale: 'it-IT' },
  { code: 'pt', name: 'Português', locale: 'pt-BR' },
  { code: 'ru', name: 'Русский', locale: 'ru-RU' },
  { code: 'zh', name: '中文', locale: 'zh-CN' },
  { code: 'ja', name: '日本語', locale: 'ja-JP' },
];
const LANGUAGE_KEY = 'goodstock-language-v1';

// Language files register themselves here: window.GOODSTOCK_TRANSLATIONS.nl = { 'Save item': 'Item opslaan', … }.
// A plural line is an object by plural category: { one: '{count} item', other: '{count} items' }.
window.GOODSTOCK_TRANSLATIONS = window.GOODSTOCK_TRANSLATIONS || {};

let currentLanguage = 'en';
let currentTranslations = {};
let currentPlurals = null;

// Marks text that is translated later, where it is shown (names of presets, categories, tabs).
const N_ = (text) => text;

function fillPlaceholders(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match));
}

function t(text, vars) {
  const entry = currentTranslations[text];
  return fillPlaceholders(typeof entry === 'string' && entry ? entry : text, vars);
}

// Counted text: tp(3, '{count} item', '{count} items'). The English plural is the key.
function tp(count, one, other, vars) {
  const entry = currentTranslations[other];
  let text = count === 1 ? one : other;
  if (typeof entry === 'string' && entry) text = entry;
  else if (entry && typeof entry === 'object') {
    let category = 'other';
    try { category = currentPlurals ? currentPlurals.select(count) : category; } catch { /* Fall back to "other". */ }
    text = entry[category] || entry.other || text;
  }
  return fillPlaceholders(text, Object.assign({ count }, vars));
}

const languageInfo = (code = currentLanguage) => LANGUAGES.find((language) => language.code === code) || LANGUAGES[0];
const languageLocale = () => languageInfo().locale;
const languageName = (code) => languageInfo(code).name;

function preferredLanguage() {
  let saved = '';
  try { saved = localStorage.getItem(LANGUAGE_KEY) || ''; } catch { /* Private mode. */ }
  if (LANGUAGES.some((language) => language.code === saved)) return saved;
  const wanted = [].concat(navigator.languages || [], navigator.language || []).map((code) => String(code).slice(0, 2).toLowerCase());
  return wanted.find((code) => LANGUAGES.some((language) => language.code === code)) || 'en';
}

// Language files are plain scripts, so they load the same way from the server, the offline cache and the Android app.
function loadLanguageFile(code) {
  if (code === 'en' || window.GOODSTOCK_TRANSLATIONS[code]) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = `lang/${code}.js`;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

async function setLanguage(code, { remember = false } = {}) {
  const language = languageInfo(code);
  await loadLanguageFile(language.code);
  currentLanguage = window.GOODSTOCK_TRANSLATIONS[language.code] || language.code === 'en' ? language.code : 'en';
  currentTranslations = currentLanguage === 'en' ? {} : window.GOODSTOCK_TRANSLATIONS[currentLanguage];
  try { currentPlurals = new Intl.PluralRules(languageLocale()); } catch { currentPlurals = null; }
  if (remember) { try { localStorage.setItem(LANGUAGE_KEY, currentLanguage); } catch { /* Kept for this visit only. */ } }
  document.documentElement.lang = currentLanguage;
  translatePage(document.body);
  return currentLanguage;
}

// The fixed parts of index.html. Plain text and the placeholder, title, aria-label, label and alt attributes are
// looked up by their English text. Elements with mixed markup carry data-i18n="key", and the key's translation
// replaces their inner HTML. The English original is remembered, so switching language again starts from it.
// Views drawn by app.js are skipped: they are rebuilt with t() on every render.
const originalText = new WeakMap();
const originalAttributes = new WeakMap();
const originalHtml = new WeakMap();
const TRANSLATED_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'label', 'alt'];
// Also skipped: parts of dialogs that app.js fills with recipe and item names, which must not be "translated".
const SKIP_TRANSLATION = '#view-container, #floating-timers, script, style, svg, code, datalist, #recipe-dialog-title, #recipe-dialog-description, #recipe-dialog-ingredients, #recipe-dialog-actions, #cook-ingredients, #steps-body, #steps-recipe-name, #steps-timer-panel, #putaway-item-name, #wipe-summary';

function translatePage(root) {
  if (!root) return;
  for (const element of root.querySelectorAll('[data-i18n]')) {
    if (!originalHtml.has(element)) originalHtml.set(element, element.innerHTML);
    const key = element.getAttribute('data-i18n');
    const translated = currentTranslations[key];
    element.innerHTML = typeof translated === 'string' && translated ? translated : originalHtml.get(element);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === 1) return node.matches(SKIP_TRANSLATION) || node.hasAttribute('data-i18n') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      if (!originalText.has(node)) originalText.set(node, node.nodeValue);
      const original = originalText.get(node);
      const trimmed = original.trim();
      const translated = t(trimmed);
      node.nodeValue = translated === trimmed ? original : original.replace(trimmed, translated);
      continue;
    }
    for (const name of TRANSLATED_ATTRIBUTES) {
      if (!node.hasAttribute(name)) continue;
      let originals = originalAttributes.get(node);
      if (!originals) { originals = {}; originalAttributes.set(node, originals); }
      if (!(name in originals)) originals[name] = node.getAttribute(name);
      node.setAttribute(name, t(originals[name]));
    }
  }
}

window.GoodstockI18n = { LANGUAGES, t, tp, setLanguage, preferredLanguage, languageLocale, languageName, translatePage };
