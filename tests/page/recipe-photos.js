// Recipe photos (0.13): a picked photo is shrunk and saved with the recipe, shown on its card and page, and can be
// removed; an imported recipe's photo comes through the server once; Mealie recipes get their photo's address.
const fail = []; const log = [];
const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const size = (src) => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve([image.naturalWidth, image.naturalHeight]); image.onerror = () => resolve([0, 0]); image.src = src; });

// A big picture, as if picked from the phone's gallery.
const canvas = document.createElement('canvas');
canvas.width = 1600; canvas.height = 800;
canvas.getContext('2d').fillRect(0, 0, 1600, 800);
const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
state.recipes = [];
activeView = 'recipes';
render();
openRecipeEditor();
await pickRecipePhoto(blob);
const form = $('#recipe-edit-form');
const photo = form.elements.photo.value;
const [width, height] = await size(photo);
log.push(`shrunk to ${width}×${height}, ${Math.round(photo.length / 1024)} KB`);
if (!/^data:image\/jpeg;base64,/.test(photo) || width !== 480 || height !== 240) fail.push(`photo not shrunk to 480 px: ${width}×${height}`);
if ($('#recipe-photo-preview').hidden || $('#recipe-photo-remove').hidden) fail.push('no preview or Remove photo button');
form.elements.name.value = 'Photo soup';
form.requestSubmit();
await wait();
const saved = state.recipes.find((recipe) => recipe.name === 'Photo soup');
if (saved?.photo !== photo) fail.push('photo not saved with the recipe');
if (!document.querySelector('.recipe-card.has-photo img.recipe-card-photo')) fail.push('no photo on the recipe card');
openRecipePage(saved.id);
if (!document.querySelector('img.recipe-page-photo')) fail.push('no photo on the recipe page');

// Removing it.
openRecipeEditor(saved);
if ($('#recipe-photo-preview').hidden) fail.push('editing does not show the saved photo');
document.querySelector('[data-action="recipe-photo-remove"]').click();
form.requestSubmit();
await wait();
if ('photo' in recipeById(saved.id)) fail.push('photo not removed');

// Only images and web addresses are ever put into the page.
if (safePhoto('javascript:alert(1)') || safePhoto('https://x/"onerror="alert(1)') || safePhoto('data:text/html;base64,AAAA')) fail.push('unsafe photo value accepted');

// An imported recipe's photo: found in the page's recipe data, then fetched through the server and shrunk.
const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Pie', recipeIngredient: ['1 egg'], recipeInstructions: 'Bake it.', image: { '@type': 'ImageObject', url: '/icon-512.png' } })}</script>`;
const imported = window.GoodstockRecipeImport.extractRecipeFromHtml(html, `${location.origin}/recipes/pie`);
if (imported?.image !== `${location.origin}/icon-512.png`) fail.push(`image not read from the recipe data: ${imported?.image}`);
const fetched = await importedPhoto(imported.image);
const [fetchedWidth] = await size(fetched);
if (!/^data:image\/jpeg/.test(fetched) || fetchedWidth !== 480) fail.push(`imported photo not fetched and shrunk (${fetchedWidth})`);
const refused = await fetch(`/api/photo?url=${encodeURIComponent(`${location.origin}/index.html`)}`);
if (refused.ok) fail.push('the photo proxy passed on a page that is not an image');

// Mealie: the photo's address on the Mealie server.
const mealie = window.GoodstockMealie.mapMealieRecipe({ id: 'abc-123', slug: 'pie', name: 'Pie', image: 'x1' }, 'http://mealie.local:9000');
if (mealie.photo !== 'http://mealie.local:9000/api/media/recipes/abc-123/images/min-original.webp') fail.push(`Mealie photo address: ${mealie.photo}`);
state.recipes = [];
activeView = 'inventory';
persist();
return { fail, log };
