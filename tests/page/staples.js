// Staples: "Keep at least" on an item puts it on the shopping list by itself when it drops below that amount, once,
// tagged "restock"; removing a staple lists it too; putting it away again keeps it a staple.
const fail = []; const log = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
// Cartons (pieces), so − takes off one at a time (litres step 0.1 since v4.5.5).
state.inventory = [{ id: 'm1', name: 'Milk', quantity: 3, unit: 'pcs', location: state.locations[1], kind: 'Food' }];
state.shopping = [];
activeView = 'inventory';
render();

// Set "Keep at least 2" in the edit dialog.
document.querySelector('[data-action="edit-item"][data-id="m1"]').click();
await wait();
const form = $('#item-form');
form.elements.minimum.value = '2';
form.requestSubmit();
await wait();
const milk = () => state.inventory.find((item) => item.id === 'm1');
if (milk().minimum !== 2) fail.push(`minimum not saved: ${JSON.stringify(milk())}`);
if (state.shopping.length) fail.push('listed while still above the minimum');
if (!document.querySelector('.inventory-row').textContent.includes('2 pcs')) fail.push('the row does not show the minimum');

// 3 → 2: not below yet. 2 → 1: listed once.
const minus = () => { document.querySelector('[data-action="adjust"][data-id="m1"][data-delta="-1"]').click(); };
minus();
if (state.shopping.length) fail.push('listed at exactly the minimum');
minus();
log.push(`after dropping to 1: ${JSON.stringify(state.shopping.map(({ name, quantity, unit, restock }) => ({ name, quantity, unit, restock })))}`);
if (state.shopping.length !== 1 || !state.shopping[0].restock || state.shopping[0].quantity !== 2) fail.push('not listed for restocking below the minimum');
// Removing it from the list by hand: it doesn't come back while it stays low.
state.shopping = [];
minus();
if (state.shopping.length) fail.push('listed again while it stayed low');
activeView = 'shopping';
state.shopping = [];
milk().quantity = 5; persist();
milk().quantity = 1; persist();
if (state.shopping.length !== 1) fail.push('not listed again after going back above the minimum and down again');
render();
if (!document.querySelector('.restock-tag')) fail.push('no restock tag on the shopping list');

// Put away: the milk goes back up and the next drop lists it again.
state.shopping[0].checked = true;
render();
document.querySelector('[data-action="put-all-away"]').click();
await wait();
log.push(`after putting away: milk ${milk().quantity} ${milk().unit}, listed ${Boolean(milk().restockListed)}`);
if (milk().quantity !== 3 || milk().restockListed) fail.push('putting away did not restock the milk');

// Removing a staple lists it, and putting that away makes a new staple item.
state.shopping = [];
removeInventoryItem('m1', 'used');
if (state.shopping.length !== 1 || state.shopping[0].keep !== 2) fail.push('removing a staple did not list it');
state.shopping[0].checked = true;
activeView = 'shopping';
render();
document.querySelector('[data-action="put-all-away"]').click();
await wait();
const again = state.inventory.find((item) => item.name === 'Milk');
if (!again || again.minimum !== 2) fail.push(`put-away milk is no longer a staple: ${JSON.stringify(again)}`);
activeView = 'inventory';
render();
return { fail, log };
