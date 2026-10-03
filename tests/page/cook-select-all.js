// Cook mode: "Select all" ticks every item of the get-ready list, then turns into "Clear all".
const fail = []; const log = [];
const recipe = { id: 'sa', name: 'Pancakes', ingredients: ['200 g flour', '2 eggs', '300 ml milk'], instructions: ['Whisk everything together.', 'Fry in a pan.'] };
state.recipes = [recipe]; state.plan = []; state.inventory = [];
await startCookSteps(recipe);
cookSession.index = cookSession.bites.findIndex((bite) => bite.type === 'gather');
renderCookStep();
const boxes = () => Array.from(document.querySelectorAll('#steps-body [data-steps-item]'));
const toggle = () => document.querySelector('#steps-body .steps-check-all');
log.push(`items: ${boxes().length}, button: ${toggle() && toggle().textContent}`);
if (!toggle()) fail.push('no select-all button on the ingredient list');
toggle().click();
await new Promise((resolve) => setTimeout(resolve, 50));
log.push(`after select: ${boxes().filter((box) => box.checked).length}/${boxes().length} checked, ${cookSession.checked.size} in session, button: ${toggle().textContent}`);
if (!boxes().every((box) => box.checked) || cookSession.checked.size !== boxes().length) fail.push('select all did not tick everything');
if (!/Clear all/.test(toggle().textContent)) fail.push('button did not switch to Clear all');
// Unticking one by hand brings back "Select all".
boxes()[0].click();
if (!/Select all/.test(toggle().textContent)) fail.push('button did not switch back after unticking one');
toggle().click();
await new Promise((resolve) => setTimeout(resolve, 50));
toggle().click();
await new Promise((resolve) => setTimeout(resolve, 50));
log.push(`after clear: ${boxes().filter((box) => box.checked).length} checked`);
if (boxes().some((box) => box.checked) || cookSession.checked.size !== 0) fail.push('clear all did not untick everything');
$('#steps-dialog').close();
return { fail, log };
