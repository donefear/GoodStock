// "Opened today" shortens the expiry to the opened shelf life (milk 4 days, a can of tomatoes 4, rice: no button);
// freezer items get a "frozen on" date and their estimate counts from that day.
const fail = []; const log = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
const inDays = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return dateKey(date); };
const [pantry, fridge, freezer] = state.locations;
log.push(`locations: ${pantry}, ${fridge}, ${freezer}`);
state.inventory = [
  { id: 'o1', name: 'Milk', quantity: 1, unit: 'l', location: fridge, kind: 'Food', expiresOn: inDays(10), expirationSource: 'manual' },
  { id: 'o2', name: 'Rice', quantity: 1, unit: 'kg', location: pantry, kind: 'Food', expiresOn: inDays(300), expirationSource: 'estimated' },
  { id: 'o3', name: 'Canned tomatoes', quantity: 1, unit: 'can', location: pantry, kind: 'Food', expiresOn: inDays(2), expirationSource: 'manual' },
];
activeView = 'inventory';
render();
const form = $('#item-form');
const edit = async (id) => { document.querySelector(`[data-action="edit-item"][data-id="${id}"]`).click(); await wait(); };

await edit('o1');
if ($('#opened-row').hidden || $('#item-opened-button').hidden) fail.push('no Opened today button for milk');
$('#item-opened-button').click();
log.push(`milk after opening: ${form.elements.expiresOn.value} (${$('#item-opened-note').textContent})`);
if (form.elements.expiresOn.value !== inDays(4)) fail.push(`milk opened: expected ${inDays(4)}, got ${form.elements.expiresOn.value}`);
form.requestSubmit();
await wait();
const milk = state.inventory.find((item) => item.id === 'o1');
if (milk.openedOn !== dateKey(new Date()) || milk.expiresOn !== inDays(4)) fail.push(`opened milk not saved: ${JSON.stringify(milk)}`);
if (!document.querySelector('.inventory-row').textContent.match(/opened/i)) fail.push('the row does not say it was opened');

await edit('o2');
if (!$('#item-opened-button').hidden) fail.push('rice offers Opened today');
$('#item-dialog').close();
// A sooner date stays: tomatoes due in 2 days stay at 2 days after opening.
await edit('o3');
$('#item-opened-button').click();
if (form.elements.expiresOn.value !== inDays(2)) fail.push(`opening moved a sooner date: ${form.elements.expiresOn.value}`);
$('#item-dialog').close();

// New chicken in the freezer, frozen 100 days ago: chicken keeps 120 days there (category estimate or catalog).
openItemDialog();
form.elements.name.value = 'Chicken';
form.elements.location.value = freezer;
form.elements.location.dispatchEvent(new Event('change', { bubbles: true }));
await wait();
if ($('#frozen-field').hidden) fail.push('no Frozen on field for the freezer');
if (form.elements.frozenOn.value !== dateKey(new Date())) fail.push(`Frozen on does not start at today: ${form.elements.frozenOn.value}`);
const days = shelfLifeDaysFor('Chicken', freezer);
form.elements.frozenOn.value = inDays(-100);
form.elements.frozenOn.dispatchEvent(new Event('change', { bubbles: true }));
await wait();
log.push(`chicken: keeps ${days} days frozen, estimate ${form.elements.expiresOn.value}`);
if (form.elements.expiresOn.value !== inDays(days - 100)) fail.push(`freezer estimate does not count from the frozen date: ${form.elements.expiresOn.value}, expected ${inDays(days - 100)}`);
if (!$('#opened-row').hidden) fail.push('Opened today shows for a new item');
form.requestSubmit();
await wait();
const chicken = state.inventory.find((item) => item.name === 'Chicken');
if (!chicken || chicken.frozenOn !== inDays(-100)) fail.push(`frozen date not saved: ${JSON.stringify(chicken)}`);
if (!document.body.textContent.match(/frozen/i)) fail.push('the row does not show the frozen date');
// Moving it out of the freezer drops the frozen date.
await edit(chicken.id);
form.elements.location.value = fridge;
form.elements.location.dispatchEvent(new Event('change', { bubbles: true }));
if (!$('#frozen-field').hidden) fail.push('Frozen on still shows outside the freezer');
form.requestSubmit();
await wait();
if (state.inventory.find((item) => item.name === 'Chicken').frozenOn) fail.push('frozen date kept outside the freezer');
return { fail, log };
