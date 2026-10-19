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
if (codes.length !== LANGUAGES.length - 1 || codes.includes('en')) fail.push('the choice should be every language except the recipe\'s own');
if (select && select.value !== 'nl') fail.push(`an English recipe in English should start at Dutch, not ${select.value}`);
await setLanguage('de');
openRecipePage(recipe.id);
const german = document.querySelector('#translation-target');
if (!german || german.value !== 'de') fail.push('in German the choice should start at German');
document.querySelector('[data-action="translation-discard"]').click();
if (document.querySelector('#translation-target')) fail.push('Close did not close the choice');
await setLanguage('en');
recipeTranslation = null;
return { fail, log };
