// Goodstock: recipe ideas from the web, based on what you cook (Recipes page → Ideas for you).
// The parts load in order as plain scripts (see index.html) and share one global scope.
//
// History (meals cooked or planned in the last 90 days, cooked ones counting double) and the kitchen (what is in
// stock, soonest expiry first) give the ingredients to look for. TheMealDB, a free recipe database that needs no
// key, finds recipes with them: through the server in the browser, straight from the phone in the apps. Results
// are ranked by how well they fit, recipes you already have are left out, and each says why it was picked. Their
// text is English; the recipe page's Translate button can change that.
const IDEAS_HISTORY_DAYS = 90;
const IDEAS_SHOWN = 6;
const IDEAS_LOOKUPS = 14;
let ideas = { loading: false, searched: false, error: '', results: [] };

async function mealDb(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  if (STANDALONE) {
    const answer = JSON.parse(await nativeCall('httpRequest', `https://www.themealdb.com/api/json/v1/1/${path}?${query}`, JSON.stringify({ accept: 'application/json' })));
    if (answer.status !== 200) throw new Error('unreachable');
    return JSON.parse(answer.body || '{}');
  }
  const response = await fetch(`/api/mealdb/${path}?${query}`);
  if (!response.ok) throw new Error('unreachable');
  return response.json();
}

// Catalog ingredients (by English name) in recent meals, most used first.
function cookingHistory() {
  const since = dateKey(new Date(Date.now() - IDEAS_HISTORY_DAYS * DAY_MS));
  const counts = new Map();
  let meals = 0;
  for (const plan of state.plan) {
    if (!plan.date || plan.date < since) continue;
    const recipe = recipeById(plan.recipeId);
    if (!recipe) continue;
    meals += 1;
    const weight = plan.cooked ? 2 : 1;
    for (const line of recipe.ingredients || []) {
      const record = ingredientRecord(line);
      if (record) counts.set(record.en, (counts.get(record.en) || 0) + weight);
    }
  }
  return { meals, counts, top: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name) };
}

// Catalog ingredients in stock (English name → item), soonest expiry first.
function stockedIngredients() {
  const stocked = new Map();
  const items = state.inventory
    .filter((item) => item.kind !== 'Household' && Number(item.quantity) > 0)
    .sort((a, b) => (a.expiresOn || '9999').localeCompare(b.expiresOn || '9999'));
  for (const item of items) {
    const record = ingredientRecord(item.name);
    if (record && !stocked.has(record.en)) stocked.set(record.en, item);
  }
  return stocked;
}

// An ingredient's name in the app's language, for the reasons shown on a card.
function localIngredientName(english) {
  const record = ingredientCatalog.find((entry) => entry.en === english);
  return (record && catalogNames(record, currentLanguage)[0]) || english;
}

function mealToRecipe(meal) {
  const ingredients = [];
  for (let index = 1; index <= 20; index++) {
    const name = String(meal[`strIngredient${index}`] || '').trim();
    if (!name) continue;
    const measure = String(meal[`strMeasure${index}`] || '').trim();
    ingredients.push(measure ? `${measure} ${name}` : name);
  }
  // Steps come as one text, sometimes with "STEP 1" lines; one sentence per step, like other imports.
  const lines = String(meal.strInstructions || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^(?:step\s*)?\d+[.):]?$/i.test(line));
  return metricRecipe({
    name: String(meal.strMeal || '').trim(),
    description: [meal.strArea, meal.strCategory].filter((part) => part && part !== 'Unknown').join(' · '),
    ingredients,
    instructions: tidyImportedSteps(lines),
    source: 'Imported',
    sourceUrl: meal.strSource || `https://www.themealdb.com/meal/${meal.idMeal}`,
    language: 'en',
  });
}

// Higher is better: ingredients from your history count most, then what you have (expiring soon a bit more), and
// every missing ingredient a little against.
function scoreIdea(recipe, history, stocked) {
  const soon = new Set([...stocked.values()].filter((item) => { const days = expiryDaysRemaining(item.expiresOn); return days !== null && days <= EXPIRY_WINDOW_DAYS; }).map((item) => ingredientRecord(item.name)?.en));
  let score = 0;
  const fromHistory = [];
  const fromStock = [];
  const expiring = [];
  for (const line of recipe.ingredients) {
    const english = ingredientRecord(line)?.en;
    if (!english) continue;
    const used = history.counts.get(english) || 0;
    if (used) { score += 2 + Math.min(used, 6) / 2; fromHistory.push(english); }
    if (stocked.has(english)) { score += 1.5; fromStock.push(english); }
    if (soon.has(english)) { score += 2; expiring.push(english); }
  }
  const missing = missingIngredients(recipe).length;
  score -= missing * 0.3;
  const reasons = [];
  const favourite = history.top.find((name) => fromHistory.includes(name));
  if (favourite) reasons.push(t('You often cook with {ingredient}', { ingredient: localIngredientName(favourite).toLowerCase() }));
  if (expiring.length) reasons.push(t('Uses {ingredient}, which expires soon', { ingredient: localIngredientName(expiring[0]).toLowerCase() }));
  if (fromStock.length) reasons.push(tp(new Set(fromStock).size, 'Uses {count} thing you have', 'Uses {count} things you have'));
  return { score, reasons, missing };
}

async function findIdeas() {
  if (ideas.loading) return;
  ideas = { ...ideas, loading: true, error: '' };
  render();
  try {
    const history = cookingHistory();
    const stocked = stockedIngredients();
    const known = new Set(state.recipes.map((recipe) => cleanIngredient(recipe.name)));
    const shownBefore = new Set(ideas.results.map((idea) => idea.meal.idMeal));
    // Look for recipes with your three favourite ingredients and the three that expire first.
    const wanted = [...new Set([...history.top.slice(0, 3), ...[...stocked.keys()].slice(0, 3)])];
    const candidates = new Map();
    for (const name of wanted) {
      const found = (await mealDb('filter.php', { i: name.toLowerCase().replace(/\s+/g, '_') }).catch(() => ({}))).meals || [];
      for (const meal of found) {
        const entry = candidates.get(meal.idMeal) || { meal, hits: 0 };
        entry.hits += 1;
        candidates.set(meal.idMeal, entry);
      }
    }
    // A new kitchen with no history or stock gets a few random ideas.
    if (!candidates.size) {
      for (let attempt = 0; attempt < IDEAS_SHOWN; attempt++) {
        const meal = ((await mealDb('random.php')).meals || [])[0];
        if (meal) candidates.set(meal.idMeal, { meal, hits: 0, full: meal });
      }
    }
    const shortlist = [...candidates.values()]
      .filter((entry) => !known.has(cleanIngredient(entry.meal.strMeal)))
      .sort((a, b) => (b.hits - a.hits) || (shownBefore.has(a.meal.idMeal) - shownBefore.has(b.meal.idMeal)) || (Math.random() - 0.5))
      .slice(0, IDEAS_LOOKUPS);
    const results = [];
    for (const entry of shortlist) {
      const meal = entry.full || ((await mealDb('lookup.php', { i: entry.meal.idMeal }).catch(() => ({}))).meals || [])[0];
      if (!meal) continue;
      const recipe = mealToRecipe(meal);
      if (!recipe.name || !recipe.ingredients.length) continue;
      const { score, reasons, missing } = scoreIdea(recipe, history, stocked);
      results.push({ meal, recipe, score: score - (shownBefore.has(meal.idMeal) ? 3 : 0), reasons: reasons.length ? reasons : [t('A new idea to try')], missing });
    }
    results.sort((a, b) => b.score - a.score);
    ideas = { loading: false, searched: true, error: '', results: results.slice(0, IDEAS_SHOWN), history: history.meals };
  } catch {
    ideas = { ...ideas, loading: false, searched: true, error: t('Could not reach the recipe collection. Check the internet connection and try again.') };
  }
  if (activeView === 'recipes') render();
}

function addIdea(id) {
  const idea = ideas.results.find((entry) => entry.meal.idMeal === id);
  if (!idea) return;
  const recipe = { ...idea.recipe, id: `my-${makeId()}` };
  state.recipes.unshift(recipe);
  idea.added = recipe.id;
  persist();
  openRecipePage(recipe.id);
}

function renderIdeas() {
  const button = `<button class="button button-outline" type="button" data-action="find-ideas" ${ideas.loading ? 'disabled' : ''}>${ideas.searched ? t('Find other ideas') : t('Find recipes for me')} <span aria-hidden="true">✨</span></button>`;
  let body = '';
  if (ideas.loading) body = `<p class="muted ideas-status">${t('Looking for recipes you might like…')}</p>`;
  else if (ideas.error) body = `<p class="muted ideas-status">${escapeHtml(ideas.error)}</p>`;
  else if (!ideas.searched) body = `<p class="muted ideas-status">${t('Ideas based on what you cook and what you have, from TheMealDB, a free recipe collection on the web.')}</p>`;
  else if (!ideas.results.length) body = `<p class="muted ideas-status">${t('No new ideas this time. Try again later.')}</p>`;
  else {
    body = `<div class="ideas-grid">${ideas.results.map((idea) => `<article class="idea-card">
        ${idea.meal.strMealThumb ? `<img class="idea-photo" src="${escapeHtml(idea.meal.strMealThumb)}/preview" alt="" loading="lazy" />` : ''}
        <div class="idea-body">
          <h3>${escapeHtml(idea.recipe.name)}</h3>
          ${idea.recipe.description ? `<span class="muted">${escapeHtml(idea.recipe.description)}</span>` : ''}
          <ul class="idea-reasons">${idea.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
          <span class="match-tag ${idea.missing ? 'has-missing' : ''}">${idea.missing ? tp(idea.missing, '{count} to pick up', '{count} to pick up') : t('Ready to make')}</span>
          <div class="idea-actions">${idea.added
            ? `<button class="button button-small button-outline" type="button" data-action="view-recipe" data-id="${escapeHtml(idea.added)}">${t('Open')}</button>`
            : `<button class="button button-small button-dark" type="button" data-action="add-idea" data-id="${escapeHtml(idea.meal.idMeal)}">${t('Add to my recipes')} <span aria-hidden="true">＋</span></button>`}
            <a class="text-button" href="${escapeHtml(idea.recipe.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('Original recipe')} ↗</a></div>
        </div>
      </article>`).join('')}</div>`;
  }
  return `<section class="ideas-panel"><div class="recipe-results-heading"><div><span class="eyebrow">${t('IDEAS FOR YOU')}</span><h2>${t('Recipes from the web')}</h2></div>${button}</div>${body}</section>`;
}
