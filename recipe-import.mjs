// Reads a recipe out of a web page. Most recipe sites embed a schema.org "Recipe" as JSON-LD, which is far more
// reliable than scraping the visible page. Shared by the server (link import) and the Android app, which fetches
// pages itself because it has no server.
const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', eacute: 'é', egrave: 'è', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü' };

export function cleanWebText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, code) => {
      if (code[0] === '#') {
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : ' ';
      }
      return HTML_ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function findJsonLdRecipe(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJsonLdRecipe(item);
      if (found) return found;
    }
    return null;
  }
  const types = [].concat(node['@type'] || []).map((type) => String(type).toLowerCase());
  if (types.includes('recipe')) return node;
  return findJsonLdRecipe(node['@graph']) || findJsonLdRecipe(node.mainEntity) || null;
}

// Steps can be plain text, a list of HowToStep, or HowToSections with their own steps. Section names become
// short heading lines, which cook mode shows as labels.
function jsonLdInstructions(value) {
  if (!value) return [];
  if (typeof value === 'string') return value.split(/\n+|(?<=\.)\s+(?=[A-Z])/).map(cleanWebText).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(jsonLdInstructions);
  if (typeof value === 'object') {
    const types = [].concat(value['@type'] || []).map((type) => String(type).toLowerCase());
    if (types.includes('howtosection')) return [cleanWebText(value.name), ...jsonLdInstructions(value.itemListElement)].filter(Boolean);
    return [cleanWebText(value.text || value.name || '')].filter(Boolean);
  }
  return [];
}

// Some sites put only part of the method in their recipe data (dagelijksekost.vrt.be lists 2 of 12 steps), while
// the page itself shows every step as a number followed by a paragraph. This reads those numbered steps, keeping
// the nearest heading of each part ("De chocolademelk") as a section line. Returns the longest 1, 2, 3… run.
function numberedPageSteps(html) {
  const pattern = />\s*(\d{1,2})\s*<\/(?:span|div|strong|b|h[1-6])>[\s\S]{0,400}?<p[^>]*>([\s\S]*?)<\/p>/g;
  const runs = [];
  let run = null;
  for (const match of html.matchAll(pattern)) {
    const number = Number(match[1]);
    const text = cleanWebText(match[2]);
    if (!text || text.length < 12) continue;
    if (number === 1 || !run || number !== run.last + 1) {
      run = { last: 0, lines: [], heading: '' };
      runs.push(run);
      if (number !== 1) continue;
    }
    const before = html.slice(Math.max(0, match.index - 3000), match.index);
    const headings = [...before.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
    const heading = headings.length ? cleanWebText(headings[headings.length - 1][1]) : '';
    if (heading && heading !== run.heading && heading.length <= 40 && !/[.!?:]$/.test(heading)) {
      run.lines.push(heading);
      run.heading = heading;
    }
    run.lines.push(text);
    run.last = number;
  }
  return runs.reduce((best, current) => (current.last > best.last ? current : best), { last: 0, lines: [] });
}

// Returns { name, description, ingredients, instructions, sourceUrl }, or null when the page has no usable recipe.
export function extractRecipeFromHtml(html, sourceUrl = '') {
  const page = String(html || '').slice(0, 4_000_000);
  for (const [, body] of page.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(body.trim()); } catch { continue; }
    const recipe = findJsonLdRecipe(data);
    if (!recipe) continue;
    const ingredients = [].concat(recipe.recipeIngredient || recipe.ingredients || []).map(cleanWebText).filter(Boolean);
    let instructions = jsonLdInstructions(recipe.recipeInstructions);
    // Prefer the page's own numbered steps when they are clearly more complete than the recipe data.
    const pageSteps = numberedPageSteps(page);
    if (pageSteps.last >= 3 && pageSteps.last > instructions.filter((line) => /[.!?]$/.test(line)).length) instructions = pageSteps.lines;
    if (!ingredients.length && !instructions.length) continue;
    return {
      name: cleanWebText(recipe.name) || 'Imported recipe',
      description: cleanWebText(recipe.description).slice(0, 400),
      ingredients,
      instructions,
      sourceUrl,
    };
  }
  return null;
}

export const NO_RECIPE_MESSAGE = 'No recipe found on that page. Try copying the recipe text and pasting it instead.';

// The browser app loads this file as a module next to its classic scripts.
if (typeof window !== 'undefined') window.GoodstockRecipeImport = { extractRecipeFromHtml, NO_RECIPE_MESSAGE };
