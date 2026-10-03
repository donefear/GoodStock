// Mealie helpers shared by the server (which proxies Mealie for the browser) and the Android app (which talks to
// Mealie directly from the phone).

// Accept "mealie.example.com" as well as full URLs; without a scheme, redirects become relative and loop.
export function normalizeMealieUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  return trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

export function mapMealieRecipe(recipe) {
  const ingredientRows = recipe.recipeIngredient || recipe.ingredients || [];
  const ingredients = ingredientRows.map((row) => {
    if (typeof row === 'string') return row.trim();
    const name = row.food?.name || row.ingredient?.name || row.note || row.name || '';
    const amount = Number(row.quantity) > 0 ? String(Math.round(Number(row.quantity) * 1000) / 1000) : '';
    const unit = row.unit?.name || row.unit || '';
    return [amount, unit, name].filter(Boolean).join(' ').trim();
  }).filter(Boolean);
  const instructions = (recipe.recipeInstructions || [])
    .flatMap((step) => [step.title, typeof step === 'string' ? step : step.text])
    .map((text) => String(text || '').trim())
    .filter((text) => text && !/^could not detect instructions$/i.test(text));
  return {
    id: String(recipe.slug || recipe.id || recipe.name),
    slug: String(recipe.slug || recipe.id || ''),
    name: recipe.name || 'Untitled recipe',
    description: recipe.description || '',
    image: recipe.image || recipe.recipeImage || '',
    ingredients,
    instructions,
    source: 'Mealie',
  };
}

// Search results come as a plain list or wrapped in a page object, depending on the Mealie version.
export function mealieRows(payload) {
  return Array.isArray(payload) ? payload : payload?.items || payload?.recipes || [];
}

export function mealieRecipePageUrl(baseUrl, groupSlug, slug) {
  return `${baseUrl}/g/${encodeURIComponent(groupSlug || 'home')}/r/${encodeURIComponent(slug)}`;
}

// The English sentence as a template with its values, so the app can show it in the user's language.
export function mealieErrorTemplate(status, url) {
  if (status === 401 || status === 403) return { text: 'Mealie did not accept the API key.' };
  if (status === 404) return { text: 'Found a website at {url}, but not the Mealie API. Check the address.', vars: { url } };
  return { text: 'Mealie answered with HTTP {status}.', vars: { status } };
}

export function fillMessage({ text, vars }) {
  return text.replace(/\{(\w+)\}/g, (match, name) => (vars && name in vars ? String(vars[name]) : match));
}

export function mealieErrorMessage(status, url) {
  return fillMessage(mealieErrorTemplate(status, url));
}

// The browser app loads this file as a module next to its classic scripts.
if (typeof window !== 'undefined') window.GoodstockMealie = { normalizeMealieUrl, mapMealieRecipe, mealieRows, mealieRecipePageUrl, mealieErrorMessage, mealieErrorTemplate };
