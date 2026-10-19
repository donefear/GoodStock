// Share one recipe (0.34): as text that Import reads back, and as a .goodstock-recipe file.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const recipe = { id: 'my-share', name: 'Grandma’s apple cake', description: 'The Sunday one.', ingredients: ['250 g flour', '3 apples', '2 eggs'], instructions: ['Heat the oven to 180°C.', 'Batter', 'Mix the flour and the eggs.', 'Bake for 45 minutes.'], servings: 8, photo, source: 'My recipes' };
state.recipes = [recipe];

// The text reads back with the same ingredients and steps, in every language.
for (const language of LANGUAGES) {
  await setLanguage(language.code);
  const parsed = parseRecipeText(recipeShareText(recipe));
  if (parsed.name !== recipe.name || parsed.ingredients.join('|') !== recipe.ingredients.join('|') || parsed.instructions.length !== recipe.instructions.length) {
    fail.push(`${language.code}: text did not read back (${parsed.ingredients.length} ingredients, ${parsed.instructions.length} steps)`);
  }
}
await setLanguage('en');
log.push(recipeShareText(recipe).split('\n').join(' / '));

// The file keeps everything, and only Goodstock recipe files are accepted.
const back = readRecipeFile(recipeFileContent(recipe));
if (!back || back.photo !== photo || back.servings !== 8 || back.instructions.join('|') !== recipe.instructions.join('|')) fail.push('the recipe file did not keep the photo, servings and steps');
if (readRecipeFile('{"app":"goodstock","state":{}}') || readRecipeFile('not json')) fail.push('a backup or plain text was taken for a recipe file');
if (recipeFileName(recipe) !== 'Grandma’s apple cake.goodstock-recipe') fail.push(`file name ${recipeFileName(recipe)}`);

// The recipe page: Share opens the panel; the browser downloads the file when it can't share files.
openRecipePage(recipe.id);
document.querySelector('[data-action="share-recipe"]').click();
await wait();
if (!document.querySelector('.share-panel')) fail.push('Share did not open the share panel');
const originalShare = navigator.canShare;
navigator.canShare = () => false;
document.querySelector('[data-action="share-recipe-file"]').click();
await wait();
navigator.canShare = originalShare;
const status = document.querySelector('.share-panel [role="status"]');
log.push(status ? status.textContent : '(no status)');
if (!status || !/Downloaded/.test(status.textContent)) fail.push('the file was not downloaded');

// Import: opening the file fills in the editor.
openRecipeEditor();
const input = document.querySelector('#recipe-file');
const transfer = new DataTransfer();
transfer.items.add(new File([recipeFileContent(recipe)], recipeFileName(recipe), { type: '' }));
input.files = transfer.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
await wait();
const form = document.querySelector('#recipe-edit-form');
log.push(document.querySelector('#recipe-import-status').textContent);
if (form.elements.name.value !== recipe.name || form.elements.ingredients.value.split('\n').length !== 3 || form.elements.photo.value !== photo) fail.push('opening the recipe file did not fill in the editor');
document.querySelector('#recipe-edit-dialog') && document.querySelector('#recipe-edit-dialog').open && document.querySelector('#recipe-edit-dialog').close();

recipeSharing = null;
state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
