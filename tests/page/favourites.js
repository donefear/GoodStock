// Favourites and "cooked … times, last …" (0.16): a ★ on recipe cards and the recipe page, a Favourites filter on
// the Recipes page, and the count from meals marked cooked in the plan.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
state.recipes = [
  { id: 'f1', name: 'Soup', ingredients: ['1 onion'] },
  { id: 'f2', name: 'Pancakes', ingredients: ['2 eggs'] },
];
const daysAgo = (days) => { const date = new Date(); date.setDate(date.getDate() - days); return dateKey(date); };
state.plan = [
  { id: 'a', date: daysAgo(30), recipeId: 'f1', cooked: true },
  { id: 'b', date: daysAgo(12), recipeId: 'f1', cooked: true },
  { id: 'c', date: daysAgo(5), recipeId: 'f1', cooked: false },
  { id: 'd', date: daysAgo(-3), recipeId: 'f1', cooked: true },
];
activeView = 'recipes';
render();
if (document.querySelector('[data-action="favourites-filter"]')) fail.push('Favourites filter shown before there are favourites');

// Star the soup on its card.
document.querySelector('.recipe-card [data-action="toggle-favourite"][data-id="f1"]').click();
await wait();
if (!recipeById('f1').favourite) fail.push('star on the card did not make it a favourite');
const filter = document.querySelector('[data-action="favourites-filter"]');
if (!filter) fail.push('no Favourites filter');
filter?.click();
await wait();
const names = [...document.querySelectorAll('.recipe-card h3')].map((heading) => heading.textContent.trim());
log.push(`filtered: ${names}`);
if (names.length !== 1 || names[0] !== 'Soup') fail.push('filter does not show only favourites');
document.querySelector('[data-action="favourites-filter"]').click();
await wait();
if (document.querySelectorAll('.recipe-card').length !== 2) fail.push('filter does not switch off');

// The recipe page: cooked twice (the future and the uncooked meal don't count), last 12 days ago.
openRecipePage('f1');
const note = document.querySelector('.recipe-cooked-note')?.textContent;
log.push(`note: ${note}`);
if (note !== 'Cooked 2 times, last 12 days ago') fail.push(`cooked note: ${note}`);
const pageStar = document.querySelector('.recipe-page-links [data-action="toggle-favourite"]');
if (!pageStar || pageStar.getAttribute('aria-pressed') !== 'true') fail.push('recipe page does not show the star');
pageStar?.click();
await wait();
if (recipeById('f1').favourite) fail.push('star on the page did not remove the favourite');
openRecipePage('f2');
if (document.querySelector('.recipe-cooked-note')?.textContent !== 'Not cooked yet') fail.push('a new recipe does not say "Not cooked yet"');
favouritesOnly = false;
localStorage.removeItem(FAVOURITES_FILTER_KEY);
state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
