const fail = []; const log = [];
let confirms = 0;
window.confirm = () => { confirms++; return true; };
const click = (action, extra = {}) => {
  const button = document.createElement('button');
  button.dataset.action = action;
  Object.assign(button.dataset, extra);
  document.body.append(button);
  button.click();
  button.remove();
};
state.recipes = [{ id: 'r1', name: 'Soup', ingredients: ['1 onion'] }];
state.plan = [{ id: 'p1', date: dateKey(new Date()), recipeId: 'r1', cooked: false }];
state.inventory = [];
state.shopping = [{ id: 's1', name: 'Milk', quantity: 1, unit: 'l', checked: true }, { id: 's2', name: 'Bread', quantity: 1, unit: '', checked: false }];
render();
// Delete a recipe (and its planned meal), then undo.
deleteRecipe('r1');
const bar = () => ({ shown: !$('#undo-bar').hidden, text: $('#undo-bar span').textContent });
log.push(`after delete: ${state.recipes.length} recipes, ${state.plan.length} plans, bar ${JSON.stringify(bar())}`);
if (state.recipes.length || state.plan.length || !bar().shown) fail.push('delete did not happen straight away with an Undo bar');
click('undo');
if (state.recipes.length !== 1 || state.plan.length !== 1 || bar().shown) fail.push('undo did not bring the recipe and its meal back');
// Put all away, then undo.
await new Promise((r) => setTimeout(r, 50));
click('put-all-away');
log.push(`after put away: inventory ${state.inventory.map((i) => i.name)}, shopping ${state.shopping.map((i) => i.name)}, bar "${bar().text}"`);
if (state.inventory.length !== 1 || state.shopping.length !== 1) fail.push('put all away did not move the checked item');
click('undo');
if (state.inventory.length !== 0 || state.shopping.length !== 2) fail.push('undo did not reverse put all away');
// Clear the list, then undo.
click('clear-list');
if (state.shopping.length !== 0) fail.push('clear list did not clear');
click('undo');
if (state.shopping.length !== 2) fail.push('undo did not bring the list back');
// Remove a planned meal.
click('remove-plan', { id: 'p1' });
if (state.plan.length !== 0) fail.push('remove meal did not remove');
click('undo');
if (state.plan.length !== 1) fail.push('undo did not bring the meal back');
if (confirms) fail.push(`${confirms} confirm dialogs were still shown`);
return { fail, log };
