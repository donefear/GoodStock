// Recipe ideas: history and stock pick what to look for, results are ranked and explained, known recipes are left out.
const fail = []; const log = [];
const meal = (id, name, parts, extra = {}) => {
  const full = { idMeal: id, strMeal: name, strArea: 'British', strCategory: 'Chicken', strInstructions: 'STEP 1\r\nHeat the oil. Fry for 10 minutes.\r\nServe.', strMealThumb: '' , ...extra };
  parts.forEach(([measure, ingredient], index) => { full[`strMeasure${index + 1}`] = measure; full[`strIngredient${index + 1}`] = ingredient; });
  return full;
};
const MEALS = {
  '1': meal('1', 'Chicken Curry', [['500g', 'Chicken'], ['1', 'Onion'], ['200g', 'Rice']]),
  '2': meal('2', 'Beef Stew', [['1 lb', 'Beef'], ['2', 'Carrots'], ['1 cup', 'Stock']]),
  '3': meal('3', 'Lemony greens pasta', [['250g', 'Pasta']]),
  '4': meal('4', 'Chicken Milk Soup', [['300g', 'Chicken'], ['500ml', 'Milk'], ['1', 'Onion'], ['1', 'Garlic']]),
};
const asked = [];
mealDb = async (path, params = {}) => {
  asked.push(`${path} ${params.i || ''}`);
  if (path === 'filter.php') {
    const byIngredient = { chicken: ['1', '4'], milk: ['4'], onion: ['1', '4', '3'], beef: ['2'] };
    return { meals: (byIngredient[params.i] || []).map((id) => ({ idMeal: id, strMeal: MEALS[id].strMeal })) };
  }
  if (path === 'lookup.php') return { meals: [MEALS[params.i]] };
  return { meals: null };
};
const today = dateKey(new Date());
const soon = (() => { const day = new Date(); day.setDate(day.getDate() + 1); return dateKey(day); })();
state.recipes = [
  { id: 'r1', name: 'Roast chicken', ingredients: ['1 chicken', '2 onions'] },
  { id: 'r2', name: 'Lemony greens pasta', ingredients: ['250 g pasta'] },
];
state.plan = [{ id: 'p1', date: today, recipeId: 'r1', cooked: true }, { id: 'p2', date: today, recipeId: 'r1', cooked: true }];
state.inventory = [{ id: 'i1', name: 'Melk', quantity: 1, unit: 'l', location: 'Fridge', kind: 'Food', expiresOn: soon }];
activeView = 'recipes';
await findIdeas();
log.push(`asked: ${asked.join(' | ')}`);
log.push(...ideas.results.map((idea) => `${idea.recipe.name} (${Math.round(idea.score * 10) / 10}): ${idea.reasons.join('; ')}`));
if (!asked.includes('filter.php chicken') || !asked.includes('filter.php milk')) fail.push('did not search for the favourite and the expiring ingredient');
if (ideas.results.some((idea) => idea.recipe.name === 'Lemony greens pasta')) fail.push('a recipe already in the box was suggested');
if (ideas.results[0]?.recipe.name !== 'Chicken Milk Soup') fail.push(`best match should be Chicken Milk Soup, got ${ideas.results[0]?.recipe.name}`);
const top = ideas.results[0];
if (!top.reasons.some((reason) => /often cook with chicken/.test(reason))) fail.push('missing the history reason');
if (!top.reasons.some((reason) => /expires soon/.test(reason))) fail.push('missing the expiring reason');
const stew = ideas.results.find((idea) => idea.recipe.name === 'Beef Stew');
if (stew) fail.push('beef was never cooked or stocked, so the stew should not be found');
// The page shows the cards; adding one makes it an own recipe with metric amounts.
if (document.querySelectorAll('.idea-card').length !== ideas.results.length) fail.push('cards not shown');
addIdea(top.meal.idMeal);
const added = state.recipes[0];
log.push(`added: ${added.name} · ${added.ingredients.join('; ')} · ${added.instructions.join(' / ')} · ${added.sourceUrl}`);
if (added.name !== 'Chicken Milk Soup' || added.source !== 'Imported' || !/themealdb\.com\/meal\/4/.test(added.sourceUrl)) fail.push('added recipe is wrong');
if (activeView !== 'recipe') fail.push('did not open the added recipe');
if (added.instructions.some((step) => /^STEP/i.test(step))) fail.push('"STEP 1" lines were kept as steps');
return { fail, log };
