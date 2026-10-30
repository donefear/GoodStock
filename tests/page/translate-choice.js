const fail = []; const log = [];
// Cooking terms: the name in the app's language; English only as a second name outside English, never Dutch.
for (const code of ['en', 'de', 'nl']) {
  await setLanguage(code);
  toolsTab = 'terms'; termsQuery = 'blan'; activeView = 'tools'; render();
  const heading = document.querySelector('#terms-list .term-card h3');
  const second = heading && heading.querySelector('span');
  log.push(`${code}: ${heading ? heading.textContent : '(none)'}`);
  if (code === 'en' && second) fail.push(`en: a second name "${second.textContent}" next to the term`);
  if (code !== 'en' && (!second || second.textContent !== 'Blanch')) fail.push(`${code}: English name missing next to the term`);
  if (code === 'de' && !/blanchieren/i.test(heading.textContent)) fail.push('de: term not in German');
}
await setLanguage('en');

// Recipes: a plain "Translate" button, then a choice of every other language.
const recipe = state.recipes.find((entry) => recipeLanguage(entry) === 'en');
recipeTranslation = null;
openRecipePage(recipe.id);
const button = document.querySelector('[data-action="translate-choose"]');
if (!button || !/^Translate\b/.test(button.textContent) || /Dutch|Nederlands/.test(button.textContent)) fail.push(`button reads "${button && button.textContent}"`);
button.click();
await new Promise((resolve) => setTimeout(resolve, 50));
const select = document.querySelector('#translation-target');
const codes = select ? Array.from(select.options).map((option) => option.value) : [];
log.push(`choices: ${codes.join(' ')} (selected ${select && select.value})`);
if (codes.filter(Boolean).length !== LANGUAGES.length - 1 - NOT_DEEPL_TARGETS.length || codes.includes('en') || codes.includes('tl')) fail.push('the choice should be every DeepL language except the recipe\'s own');
if (select && select.value !== '') fail.push(`an English recipe in an English app (browser en-US) should ask, not start at ${select.value}`);
if (codes.length && !document.querySelector('#translation-target option[disabled]')) fail.push('no "Choose a language" option');
await setLanguage('de');
openRecipePage(recipe.id);
const german = document.querySelector('#translation-target');
if (!german || german.value !== 'de') fail.push('in German the choice should start at German');
document.querySelector('[data-action="translation-discard"]').click();
if (document.querySelector('#translation-target')) fail.push('Close did not close the choice');
await setLanguage('nl');
const dutch = { name: 'Pannenkoeken', ingredients: ['250 g bloem', '2 eieren', '500 ml melk'], instructions: ['Meng de bloem met de eieren en de melk.', 'Bak de pannenkoeken in een hete pan.'] };
if (recipeTranslationTarget(dutch) !== 'en') fail.push(`a Dutch recipe in a Dutch app should start at English, not ${recipeTranslationTarget(dutch)}`);
await setLanguage('en');
recipeTranslation = null;

// Ingredient suggestions: English and the app's language only, no Dutch names in an English or German app.
for (const code of ['en', 'de']) {
  await setLanguage(code);
  fillIngredientOptions();
  const values = Array.from(document.querySelectorAll('#ingredient-options option')).map((option) => option.value);
  const has = (name) => values.some((value) => value.toLowerCase() === name);
  if (has('bloem') || has('eieren')) fail.push(`${code}: Dutch names among the suggestions`);
  if (!has('flour')) fail.push(`${code}: English name missing from the suggestions`);
  if (code === 'de' && !has('mehl')) fail.push('de: German name missing from the suggestions');
}
await setLanguage('en');
return { fail, log };
