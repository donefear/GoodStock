// "Recipe ideas" from Use soon (0.28): the Recipes page searched for the item, and web recipes with it.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const soon = new Date(); soon.setDate(soon.getDate() + 1);
state.inventory = [{ id: 'u1', name: 'Spinazie', quantity: 200, unit: 'g', location: 'Fridge', kind: 'Food', expiresOn: dateKey(soon) }];
state.recipes = [
  { id: 'r1', name: 'Green pasta', ingredients: ['200 g spinach', '250 g pasta'] },
  { id: 'r2', name: 'Pancakes', ingredients: ['250 g flour'] },
];
ideas = { loading: false, searched: false, error: '', results: [] };
const asked = [];
const realFetch = window.fetch;
window.fetch = async (url, options) => {
  const address = String(url);
  if (!address.startsWith('/api/mealdb/')) return realFetch(url, options);
  asked.push(address);
  const meal = { idMeal: '1', strMeal: 'Spinach soup', strCategory: 'Soup', strInstructions: 'Cook the spinach. Blend.', strIngredient1: 'Spinach', strMeasure1: '300g', strIngredient2: 'Onion', strMeasure2: '1', strSource: 'https://example.com/soup' };
  const body = address.startsWith('/api/mealdb/filter.php') ? { meals: [{ idMeal: '1', strMeal: 'Spinach soup' }] } : { meals: [meal] };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
};
try {
  activeView = 'inventory';
  render();
  const button = document.querySelector('[data-action="use-it-up"][data-id="u1"]');
  if (!button) fail.push('no "Recipe ideas" button on the Use soon row');
  else {
    button.click();
    for (let wait = 0; wait < 40 && (ideas.loading || !ideas.searched); wait++) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  log.push(`asked: ${asked.join(' ')}`);
  log.push(`page: ${activeView}, search "${recipeQuery}", focus ${ideas.focus}`);
  if (activeView !== 'recipes' || recipeQuery !== 'Spinazie') fail.push('Recipes page not searched for the item');
  if (!asked.some((address) => /filter\.php\?i=spinach$/.test(address))) fail.push('web recipes not looked up by the English catalog name (spinach)');
  const cards = Array.from(document.querySelectorAll('.recipe-card h3')).map((heading) => heading.textContent.trim());
  log.push(`own recipes: ${cards.join(', ')}`);
  if (!cards.some((name) => /Green pasta/.test(name)) || cards.some((name) => /Pancakes/.test(name))) fail.push('own recipes should be only the ones with spinach');
  const heading = document.querySelector('.ideas-panel h2');
  log.push(`ideas: ${heading && heading.textContent} · ${Array.from(document.querySelectorAll('.idea-card h3')).map((node) => node.textContent).join(', ')}`);
  if (!heading || !/spinach/i.test(heading.textContent)) fail.push('ideas heading does not name the ingredient');
  if (!document.querySelector('[data-action="find-ideas-all"]')) fail.push('no way back to all ideas');
} finally {
  window.fetch = realFetch;
  ideas = { loading: false, searched: false, error: '', results: [] };
  recipeQuery = '';
  state = normalizeState(JSON.parse(kitchenBefore));
  activeView = 'inventory';
  persist();
}
return { fail, log };
