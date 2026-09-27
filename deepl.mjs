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

// DeepL wants "EN-GB"/"EN-US" rather than "EN" as a target.
export function deeplRequestBody(texts, target, source = '') {
  const body = { text: texts, target_lang: target === 'en' ? 'EN-GB' : 'NL', preserve_formatting: true };
  if (source) body.source_lang = source.toUpperCase();
  return body;
}

// DeepL accepts at most 50 texts per request.
export function deeplChunks(texts, size = 50) {
  const chunks = [];
  for (let start = 0; start < texts.length; start += size) chunks.push(texts.slice(start, start + size));
  return chunks;
}

export function deeplErrorMessage(status) {
  if (status === 401 || status === 403) return 'DeepL did not accept the API key.';
  if (status === 456) return 'The DeepL character limit for this month is used up.';
  if (status === 429) return 'DeepL is busy. Try again in a moment.';
  if (status === 413) return 'That recipe is too long to translate in one go.';
  return `DeepL answered with HTTP ${status}.`;
}

export function deeplUsageText(usage) {
  if (!usage || !Number.isFinite(usage.character_limit)) return '';
  const format = (value) => Number(value).toLocaleString('en-US');
  return `${format(usage.character_count)} of ${format(usage.character_limit)} characters used this month`;
}

// The browser app loads this file as a module next to its classic scripts.
if (typeof window !== 'undefined') window.GoodstockDeepl = { deeplUrl, deeplHeaders, deeplRequestBody, deeplChunks, deeplErrorMessage, deeplUsageText };
