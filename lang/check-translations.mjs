// Translation check for Goodstock. Collects every English text the app shows and compares each language file in
// lang/ against it: missing lines, lines no longer used, placeholders that do not match, plural forms.
//
//   node lang/check-translations.mjs          report per language (exit code 1 when something is missing)
//   node lang/check-translations.mjs --keys   print the English texts as JSON, the starting point for a new language
//
// Where texts come from: t('…'), tp(n, '…', '…') and N_('…') in app.js; the kitchen tools, converter units and
// cooking terms in kitchen-tools.js and kitchen-reference.js; and the fixed text in index.html (see translatePage in
// i18n.js), where elements with data-i18n="key" keep their inner HTML as one text.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const unquote = (literal) => vm.runInNewContext(literal);
const STRING = String.raw`('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")`;

function collectKeys() {
  const keys = new Map(); // key → English text, or { one, other } for counted text
  const app = read('app.js');
  for (const match of app.matchAll(new RegExp(String.raw`\b(?:t|N_)\(\s*${STRING}`, 'g'))) keys.set(unquote(match[1]), unquote(match[1]));
  for (const match of app.matchAll(new RegExp(String.raw`\btp\([^,]+,\s*${STRING},\s*${STRING}`, 'g'))) {
    keys.set(unquote(match[2]), { one: unquote(match[1]), other: unquote(match[2]) });
  }

  const data = {};
  vm.runInNewContext(`${read('kitchen-tools.js')}\n${read('kitchen-reference.js')}\nOut.tools = KITCHEN_TOOLS; Out.units = CONVERTER_UNITS; Out.ingredients = CONVERTER_INGREDIENTS; Out.terms = COOKING_TERMS;`, { Out: data, window: {} });
  for (const tool of data.tools) { keys.set(tool.name, tool.name); keys.set(tool.description, tool.description); }
  for (const unit of data.units) keys.set(unit.label, unit.label);
  for (const item of data.ingredients) keys.set(item.label, item.label);
  for (const term of data.terms) { keys.set(`term: ${term.en}`, `term: ${term.en}`); keys.set(term.what, term.what); }

  for (const [key, value] of collectHtmlKeys(read('index.html'))) if (!IGNORED_HTML_TEXT.some((pattern) => pattern.test(key))) keys.set(key, value);
  return keys;
}

// Fixed text in index.html that is not translated: icons and numbers, the brand, the version label, and
// placeholders that app.js replaces straight away.
const IGNORED_HTML_TEXT = [/^[^\p{L}]*$/u, /^goodstock$/, /Goodstock v\d/, /^STEP 1$/, /^https:\/\/…$/, /^Recipe$/];

// A small reader for index.html, mirroring translatePage in i18n.js.
const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr', 'source', 'use', 'path', 'circle', 'rect']);
const SKIP_TAGS = new Set(['script', 'style', 'svg', 'code', 'datalist']);
const SKIP_IDS = new Set(['view-container', 'floating-timers', 'recipe-dialog-title', 'recipe-dialog-description', 'recipe-dialog-ingredients', 'recipe-dialog-actions', 'cook-ingredients', 'steps-body', 'steps-recipe-name', 'steps-timer-panel', 'putaway-item-name', 'wipe-summary']);
const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'label', 'alt'];
const decode = (text) => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#10;/g, '\n');

function collectHtmlKeys(html) {
  const keys = new Map();
  const body = html.slice(html.indexOf('<body'));
  const stack = [];
  const tag = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|<!--[\s\S]*?-->/g;
  let last = 0;
  let match;
  while ((match = tag.exec(body))) {
    const skipping = stack.some((entry) => entry.skip);
    const text = body.slice(last, match.index);
    if (!skipping && text.trim()) keys.set(decode(text.trim()), decode(text.trim()));
    last = tag.lastIndex;
    if (!match[2]) continue;
    const [, closing, name, attributes, selfClosing] = match;
    const lower = name.toLowerCase();
    if (closing) {
      const index = stack.map((entry) => entry.name).lastIndexOf(lower);
      if (index >= 0) {
        const entry = stack[index];
        if (entry.i18n && !stack.slice(0, index).some((outer) => outer.skip)) keys.set(entry.i18n, body.slice(entry.start, match.index).trim());
        stack.length = index;
      }
      continue;
    }
    const attribute = (attr) => new RegExp(String.raw`(?:^|\s)${attr}="([^"]*)"`).exec(attributes)?.[1];
    const i18n = attribute('data-i18n');
    const skip = SKIP_TAGS.has(lower) || SKIP_IDS.has(attribute('id')) || Boolean(i18n);
    if (!skipping && !skip) {
      for (const attr of ATTRIBUTES) {
        const value = attribute(attr);
        if (value && value.trim()) keys.set(decode(value), decode(value));
      }
    }
    if (!selfClosing && !VOID.has(lower)) stack.push({ name: lower, skip, i18n, start: tag.lastIndex });
  }
  return keys;
}

function loadLanguage(code) {
  const window = { GOODSTOCK_TRANSLATIONS: {} };
  vm.runInNewContext(read(`lang/${code}.js`), { window });
  return window.GOODSTOCK_TRANSLATIONS[code] || {};
}

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
const tags = (text) => [...String(text).matchAll(/<\/?([a-z]+)/gi)].map((match) => match[1].toLowerCase()).sort().join(',');
const PLURAL_CATEGORIES = { ru: ['one', 'few', 'many', 'other'], zh: ['other'], ja: ['other'] };

const keys = collectKeys();
if (process.argv.includes('--keys')) {
  process.stdout.write(`${JSON.stringify(Object.fromEntries(keys), null, 2)}\n`);
  process.exit(0);
}

let problems = 0;
const languages = readdirSync(join(root, 'lang')).filter((file) => /^[a-z]{2}\.js$/.test(file)).map((file) => file.slice(0, 2));
for (const code of languages) {
  const table = loadLanguage(code);
  const missing = [];
  const wrong = [];
  for (const [key, english] of keys) {
    const entry = table[key];
    if (entry === undefined || entry === '') { missing.push(key); continue; }
    const forms = typeof english === 'object'
      ? (typeof entry === 'string' ? { other: entry } : entry)
      : { other: entry };
    if (typeof english === 'object' && typeof entry === 'object') {
      for (const category of PLURAL_CATEGORIES[code] || ['one', 'other']) if (!forms[category]) wrong.push(`${key}: no "${category}" form`);
    }
    const expected = typeof english === 'object' ? placeholders(english.other) : placeholders(english);
    for (const [category, text] of Object.entries(forms)) {
      if (typeof text !== 'string') { wrong.push(`${key}: "${category}" is not text`); continue; }
      // Counted text may leave out {count} in a form ("one" in some languages says it in words).
      const found = placeholders(text);
      if (found !== expected && !(typeof english === 'object' && found === expected.split(',').filter((name) => name !== 'count').join(','))) wrong.push(`${key}: placeholders {${found}} instead of {${expected}}`);
      if (tags(text) !== tags(typeof english === 'object' ? english.other : english)) wrong.push(`${key}: HTML tags differ`);
      if (/["<>]/.test(text.replace(/<\/?[a-z]+[^>]*>/gi, '')) && !/["<>]/.test(String(english.other || english).replace(/<\/?[a-z]+[^>]*>/gi, ''))) wrong.push(`${key}: contains " < or >, which breaks HTML attributes`);
    }
  }
  const unused = Object.keys(table).filter((key) => !keys.has(key));
  problems += missing.length + wrong.length;
  console.log(`${code}: ${keys.size - missing.length}/${keys.size} translated${missing.length ? `, ${missing.length} missing` : ''}${wrong.length ? `, ${wrong.length} to fix` : ''}${unused.length ? `, ${unused.length} unused` : ''}`);
  for (const key of missing.slice(0, 20)) console.log(`  missing: ${key}`);
  if (missing.length > 20) console.log(`  … and ${missing.length - 20} more`);
  for (const line of wrong) console.log(`  fix: ${line}`);
  for (const key of unused) console.log(`  unused: ${key}`);
}
process.exit(problems ? 1 : 0);
