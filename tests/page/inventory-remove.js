// Inventory: "Remove item" in the edit dialog, and "Clear inventory" in Settings → Your data, both with Undo.
const fail = []; const log = [];
let confirms = 0; let answer = true;
window.confirm = () => { confirms++; return answer; };
window.alert = () => {};
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
state.recipes = [{ id: 'r1', name: 'Soup', ingredients: ['1 onion'] }];
state.inventory = [
  { id: 'i1', name: 'Rice', quantity: 1, unit: 'kg', location: state.locations[0], kind: 'Food' },
  { id: 'i2', name: 'Soap', quantity: 2, unit: '', location: state.locations[0], kind: 'Household' },
];
activeView = 'inventory';
render();
// Adding a new item has no Remove button; editing one does.
openItemDialog();
if (!$('#item-remove').hidden) fail.push('Remove item shows while adding a new item');
$('#item-dialog').close();
document.querySelector('[data-action="edit-item"][data-id="i1"]').click();
await wait();
if ($('#item-remove').hidden) fail.push('Remove item is missing when editing an item');
$('#item-remove').click();
await wait();
// Remove first asks why (v3.2); "Just remove" removes without counting it in the month overview.
if ($('#item-remove-choice').hidden) fail.push('Remove item did not ask why it is gone');
if (state.inventory.length !== 2) fail.push('Remove item removed before the answer');
document.querySelector('[data-action="remove-plain"]').click();
await wait();
if (state.log.length) fail.push('Just remove was logged');
log.push(`after remove: ${state.inventory.map((item) => item.name)}, dialog open ${$('#item-dialog').open}, bar "${$('#undo-bar span').textContent}"`);
if (state.inventory.length !== 1 || state.inventory[0].id !== 'i2') fail.push('Remove item did not remove just that item');
if ($('#item-dialog').open) fail.push('item dialog stayed open after removing');
if ($('#undo-bar').hidden) fail.push('no Undo bar after removing an item');
document.querySelector('#undo-bar [data-action="undo"]').click();
if (state.inventory.length !== 2) fail.push('Undo did not bring the removed item back');
// Clear inventory: cancelling the confirm keeps everything.
$('#settings-button').click();
await wait();
answer = false;
document.querySelector('[data-action="clear-inventory"]').click();
if (state.inventory.length !== 2 || !$('#settings-dialog').open) fail.push('cancelled clear still changed something');
answer = true;
document.querySelector('[data-action="clear-inventory"]').click();
await wait();
log.push(`after clear: ${state.inventory.length} items, ${state.recipes.length} recipes, settings open ${$('#settings-dialog').open}, bar "${$('#undo-bar span').textContent}"`);
if (state.inventory.length) fail.push('Clear inventory left items behind');
if (state.recipes.length !== 1) fail.push('Clear inventory touched the recipes');
if ($('#settings-dialog').open) fail.push('Settings stayed open after clearing');
document.querySelector('#undo-bar [data-action="undo"]').click();
if (state.inventory.length !== 2) fail.push('Undo did not bring the inventory back');
if (confirms !== 2) fail.push(`expected 2 confirms, saw ${confirms}`);
return { fail, log };
