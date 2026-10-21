// Allergens and diets (0.49): from catalog entries and allergen words in several languages; vegetarian and vegan;
// the line on cards and the recipe page; the filters on the Recipes page. Words that only look alike don't count.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const recipe = (id, ingredients) => ({ id, name: id, ingredients });
const check = (name, ingredients, allergens, diet) => {
  const r = recipe(name, ingredients);
  const got = recipeAllergens(r).join(',');
  const gotDiet = recipeDiet(r);
  log.push(`${name}: ${got || '-'} · ${gotDiet || 'meat/fish'}`);
  if (got !== allergens.join(',')) fail.push(`${name}: allergens ${got}, expected ${allergens.join(',')}`);
  if (gotDiet !== diet) fail.push(`${name}: diet ${gotDiet || '(none)'}, expected ${diet || '(none)'}`);
};
check('pancakes', ['200 g flour', '2 eggs', '300 ml milk'], ['gluten', 'milk', 'eggs'], 'vegetarian');
check('curry', ['400 ml coconut milk', '1 onion', '1 tsp ground nutmeg', '200 g rice'], [], 'vegan');
check('pesto pasta', ['300 g pasta', '50 g pine nuts', '40 g parmesan'], ['gluten', 'milk', 'nuts'], 'vegetarian');
check('garlic chicken', ['2 cloves minced garlic', '500 g chicken thighs', 'zest and rind of 1 lemon'], [], '');
check('dutch', ['250 g garnalen', '1 el mosterd', 'sesamzaad'], ['shellfish', 'sesame', 'mustard'], '');
check('german', ['200 g Lachs', '100 g Haselnüsse'], ['nuts', 'fish'], '');
check('french', ['farine de blé', 'beurre', 'amandes effilées'], ['gluten', 'milk', 'nuts'], 'vegetarian');
check('room temperature', ['butter at room temperature', '100 g sugar'], ['milk'], 'vegetarian');
check('honey toast', ['2 slices bread', '1 tbsp honey'], ['gluten'], 'vegetarian');
check('satay', ['3 tbsp peanut butter', '1 tbsp soy sauce', 'tofu'], ['gluten', 'peanuts', 'soy'], 'vegan');
check('japanese', ['豆腐', '醤油', 'ごま'], ['gluten', 'soy', 'sesame'], 'vegan'); // soy sauce is brewed with wheat

// Cards and the recipe page.
state.recipes = [recipe('Pancakes', ['200 g flour', '2 eggs']), recipe('Soup', ['1 onion', '1 l vegetable stock']), recipe('Steak', ['500 g beef'])];
activeView = 'recipes';
dietFilters = [];
render();
const card = [...document.querySelectorAll('.recipe-card')].find((element) => element.textContent.includes('Pancakes'));
if (!/Vegetarian/.test(card?.querySelector('.recipe-diet')?.textContent || '') || !/Contains: gluten, eggs/.test(card.textContent)) fail.push('the card has no "Vegetarian · Contains: gluten, eggs"');
openRecipePage('Pancakes');
if (!/Check the packaging/.test(document.querySelector('.recipe-diet')?.textContent || '')) fail.push('the recipe page does not say it is only a hint');

// Filters.
activeView = 'recipes';
render();
document.querySelector('[data-action="diet-filter"][data-filter="vegan"]').click();
const vegan = [...document.querySelectorAll('.recipe-card h3')].map((element) => element.textContent.trim());
document.querySelector('[data-action="diet-filter"][data-filter="vegan"]').click();
document.querySelector('[data-action="diet-filter"][data-filter="no-gluten"]').click();
const noGluten = [...document.querySelectorAll('.recipe-card h3')].map((element) => element.textContent.trim()).sort();
log.push(`vegan: ${vegan} · without gluten: ${noGluten}`);
if (vegan.join() !== 'Soup') fail.push(`vegan filter shows ${vegan}`);
if (noGluten.join() !== 'Soup,Steak') fail.push(`without-gluten filter shows ${noGluten}`);
if (!JSON.parse(localStorage.getItem('goodstock-diet-filter-v1')).includes('no-gluten')) fail.push('the filter is not remembered');
document.querySelector('[data-action="diet-filter"][data-filter="no-gluten"]').click();

state = JSON.parse(kitchenBefore);
render();
return { fail, log };
