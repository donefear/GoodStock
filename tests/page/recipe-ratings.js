// Ratings and notes on recipes (0.56): stars on the recipe page and in "Cooked ✓", the rating on recipe cards and as
// a tie-break in the order, dated notes that merge one by one between devices, shown in cook mode, gone with the recipe.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
state.recipes = [
  { id: 'r1', name: 'Soup', ingredients: ['1 onion'], instructions: ['Chop the onion.', 'Cook it.'] },
  { id: 'r2', name: 'Stew', ingredients: ['1 onion'] },
];
state.recipeNotes = [];
state.plan = [];
activeView = 'recipes';
render();
if (document.querySelector('.recipe-card-rating')) fail.push('a card shows a rating before any recipe has one');

// Rate the soup 4 stars on its page; tapping 4 again clears it, then 3 stays.
openRecipePage('r1');
const star = (value) => document.querySelector(`.recipe-cooked-row [data-action="rate-recipe"][data-value="${value}"]`);
if (!star(4)) fail.push('no rating stars on the recipe page');
star(4)?.click();
await wait();
if (recipeById('r1').rating !== 4) fail.push(`rating after 4 stars: ${recipeById('r1').rating}`);
if (document.querySelectorAll('.recipe-cooked-row .rating-star.is-on').length !== 4) fail.push('page does not light up 4 stars');
star(4)?.click();
await wait();
if ('rating' in recipeById('r1')) fail.push('tapping the same star again does not clear the rating');
star(3)?.click();
await wait();

// Cards: the rating is shown, and between recipes that are equally ready the better rated one comes first.
activeView = 'recipes';
render();
const names = [...document.querySelectorAll('.recipe-card h3')].map((heading) => heading.textContent.trim());
log.push(`order: ${names}`);
if (names[0] !== 'Soup') fail.push('the rated recipe does not come first among equals');
if (!document.querySelector('.recipe-card-rating')?.textContent.includes('Rated 3 of 5')) fail.push('card does not show the rating');

// A note from the page form; empty notes are not added.
openRecipePage('r1');
const form = document.querySelector('#recipe-note-form');
form.elements.text.value = '   ';
form.requestSubmit();
await wait();
if (state.recipeNotes.length) fail.push('an empty note was saved');
document.querySelector('#recipe-note-form').elements.text.value = 'Less salt next time';
document.querySelector('#recipe-note-form').requestSubmit();
await wait();
const saved = state.recipeNotes[0];
if (!saved || saved.recipeId !== 'r1' || saved.text !== 'Less salt next time' || saved.date !== dateKey(new Date())) fail.push(`note saved as ${JSON.stringify(saved)}`);
if (!document.querySelector('.recipe-notes p')?.textContent.includes('Less salt')) fail.push('the page does not list the note');

// Two devices add a note to the same recipe at once: both are kept.
const base = JSON.parse(JSON.stringify(state));
const mine = JSON.parse(JSON.stringify(state));
const theirs = JSON.parse(JSON.stringify(state));
mine.recipeNotes.unshift({ id: 'n-mine', recipeId: 'r1', date: '2026-01-02', text: 'Mine' });
theirs.recipeNotes.unshift({ id: 'n-theirs', recipeId: 'r1', date: '2026-01-02', text: 'Theirs' });
const merged = mergeStates(base, mine, theirs).recipeNotes.map((note) => note.id);
log.push(`merged: ${merged}`);
if (!merged.includes('n-mine') || !merged.includes('n-theirs') || !merged.includes(saved?.id)) fail.push('notes from two devices did not both survive the merge');
if (!normalizeState({ recipes: [] }).recipeNotes || normalizeState({ recipes: [] }).recipeNotes.length) fail.push('an old kitchen without notes does not load with an empty list');

// Cook mode shows the notes on the first screen.
await startCookSteps(recipeById('r1'));
if (!document.querySelector('#steps-body .steps-notes')?.textContent.includes('Less salt')) fail.push('cook mode does not show the notes');
$('#steps-dialog').close();

// "Cooked ✓" takes a rating and a note.
state.plan = [{ id: 'p1', date: dateKey(new Date()), recipeId: 'r1', cooked: false }];
openCookDialog(state.plan[0]);
document.querySelector('#cook-rating [data-value="5"]').click();
await wait();
if (recipeById('r1').rating !== 5) fail.push('stars in the cooked dialog do not rate the recipe');
if (!document.querySelector('#cook-rating [data-value="5"]').classList.contains('is-on')) fail.push('the cooked dialog does not redraw its stars');
$('#cook-form').elements.note.value = 'Kids loved it';
$('#cook-form').requestSubmit();
await wait();
if (!state.plan[0].cooked) fail.push('the meal was not marked cooked');
if (!state.recipeNotes.some((note) => note.text === 'Kids loved it')) fail.push('the note from the cooked dialog was not saved');

// Deleting a note, then the recipe takes its notes with it.
deleteRecipeNote(saved?.id);
if (state.recipeNotes.some((note) => note.id === saved?.id)) fail.push('note not deleted');
deleteRecipe('r1');
if (state.recipeNotes.some((note) => note.recipeId === 'r1')) fail.push('notes of a deleted recipe stayed');

state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
