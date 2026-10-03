// DeepL translation helpers shared by the server (which calls DeepL for the browser, since DeepL blocks direct
// browser calls) and the Android app (which calls DeepL from the phone).

// Free-plan keys end in ":fx" and use a separate host.
export function deeplUrl(key, path) {
  const host = String(key || '').trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  return `${host}/v2${path}`;
}

export function deeplHeaders(key) {
  return { authorization: `DeepL-Auth-Key ${String(key || '').trim()}`, 'content-type': 'application/json', accept: 'application/json' };
}

// The app's languages (see i18n.js). DeepL wants a regional variant for some targets ("EN-GB" rather than "EN");
// as a source it takes the plain code.
export const TRANSLATION_LANGUAGES = ['en', 'nl', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ro', 'pl', 'tr'];
const DEEPL_TARGETS = { en: 'EN-GB', pt: 'PT-BR', zh: 'ZH-HANS' };

export function deeplRequestBody(texts, target, source = '') {
  const code = TRANSLATION_LANGUAGES.includes(target) ? target : 'en';
  const body = { text: texts, target_lang: DEEPL_TARGETS[code] || code.toUpperCase(), preserve_formatting: true };
  if (source && source !== code) body.source_lang = source.toUpperCase();
  return body;
}

// DeepL accepts at most 50 texts per request.
export function deeplChunks(texts, size = 50) {
  const chunks = [];
  for (let start = 0; start < texts.length; start += size) chunks.push(texts.slice(start, start + size));
  return chunks;
}

// The English sentence as a template with its values, so the app can show it in the user's language.
export function deeplErrorTemplate(status) {
  if (status === 401 || status === 403) return { text: 'DeepL did not accept the API key.' };
  if (status === 456) return { text: 'The DeepL character limit for this month is used up.' };
  if (status === 429) return { text: 'DeepL is busy. Try again in a moment.' };
  if (status === 413) return { text: 'That recipe is too long to translate in one go.' };
  return { text: 'DeepL answered with HTTP {status}.', vars: { status } };
}

export function deeplErrorMessage(status) {
  const { text, vars } = deeplErrorTemplate(status);
  return vars ? text.replace('{status}', String(vars.status)) : text;
}

export function deeplUsageText(usage) {
  if (!usage || !Number.isFinite(usage.character_limit)) return '';
  const format = (value) => Number(value).toLocaleString('en-US');
  return `${format(usage.character_count)} of ${format(usage.character_limit)} characters used this month`;
}

// The browser app loads this file as a module next to its classic scripts.
if (typeof window !== 'undefined') window.GoodstockDeepl = { TRANSLATION_LANGUAGES, deeplUrl, deeplHeaders, deeplRequestBody, deeplChunks, deeplErrorMessage, deeplErrorTemplate, deeplUsageText };
