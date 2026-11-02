// Editing an item (r2): an estimate recalculated after a rename counts from the day it came in, fields the dialog
// doesn't show (leftovers…) stay, impossible dates from a file count as none, and amounts have an upper limit.
const fail = []; const log = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
const inDays = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return dateKey(date); };
const kitchenBefore = JSON.stringify(state);
const [pantry, fridge] = state.locations;
const form = $('#item-form');

// 1. Milk that came in 5 days ago, renamed to yoghurt: the new estimate counts from 5 days ago.
const yoghurtDays = shelfLifeDaysFor('Yoghurt', fridge);
state.inventory = [
  { id: 'm1', name: 'Milk', quantity: 1, unit: 'l', location: fridge, kind: 'Food', addedOn: inDays(-5), expiresOn: inDays(2), expirationSource: 'estimated' },
  { id: 'l1', name: 'Leftovers: Soup', quantity: 1, unit: '', location: fridge, kind: 'Food', addedOn: inDays(-1), expiresOn: inDays(2), expirationSource: 'estimated', leftovers: true, barcode: '123', openedOn: inDays(-1), unitPrice: 2, restockListed: true, minimum: 0.5, futureField: 'kept' },
];
activeView = 'inventory';
render();
openItemDialog(state.inventory[0]);
form.elements.name.value = 'Yoghurt';
form.elements.name.dispatchEvent(new Event('input', { bubbles: true }));
form.elements.name.dispatchEvent(new Event('change', { bubbles: true }));
await wait();
form.requestSubmit();
await wait();
const yoghurt = state.inventory.find((item) => item.id === 'm1');
log.push(`yoghurt keeps ${yoghurtDays} days; renamed milk expires ${yoghurt.expiresOn}`);
if (Number.isFinite(yoghurtDays) && yoghurt.expiresOn !== inDays(yoghurtDays - 5)) fail.push(`estimate counted from today: ${yoghurt.expiresOn}, expected ${inDays(yoghurtDays - 5)}`);
if (yoghurt.addedOn !== inDays(-5)) fail.push(`addedOn changed: ${yoghurt.addedOn}`);
// A new item still counts from today.
openItemDialog();
form.elements.name.value = 'Yoghurt';
form.elements.location.value = fridge;
form.elements.location.dispatchEvent(new Event('change', { bubbles: true }));
await wait();
if (Number.isFinite(yoghurtDays) && form.elements.expiresOn.value !== inDays(yoghurtDays)) fail.push(`new item estimate not from today: ${form.elements.expiresOn.value}`);
$('#item-dialog').close();

// 2. Leftovers edited (amount changed): leftovers, barcode, opened date, price, and unknown fields stay.
openItemDialog(state.inventory.find((item) => item.id === 'l1'));
form.elements.quantity.value = '2';
form.requestSubmit();
await wait();
const leftovers = state.inventory.find((item) => item.id === 'l1');
log.push(`edited leftovers: ${JSON.stringify(leftovers)}`);
if (leftovers.leftovers !== true) fail.push('leftovers flag lost on edit');
if (leftovers.futureField !== 'kept') fail.push('unknown field lost on edit');
if (leftovers.barcode !== '123' || leftovers.openedOn !== inDays(-1) || leftovers.addedOn !== inDays(-1)) fail.push('barcode, opened or added date lost');
if (!(leftovers.unitPrice > 0)) fail.push('unit price lost');
if (Number(leftovers.quantity) !== 2) fail.push(`amount not saved: ${leftovers.quantity}`);

// 3. Impossible dates from a file: none of them shows as a date, and the row says "No expiry date".
const cleaned = normalizeState({ inventory: [{ id: 'd1', name: 'Cream', quantity: 1, unit: 'l', location: fridge, kind: 'Food', openedOn: '2026-13-45', expiresOn: '2026-02-30', expirationSource: 'manual', frozenOn: '2026-00-10', addedOn: '2025-02-29' }], recipes: [] });
const cream = cleaned.inventory[0];
log.push(`cleaned: ${JSON.stringify(cream)}`);
if (cream.openedOn || cream.expiresOn || cream.frozenOn || cream.addedOn || cream.expirationSource) fail.push(`invalid dates kept: ${JSON.stringify(cream)}`);
if (dateFromKey('2026-02-30') || dateFromKey('2026-13-45') || !dateFromKey('2024-02-29')) fail.push('dateFromKey accepts impossible dates or rejects a leap day');
state.inventory = [{ id: 'd2', name: 'Cream', quantity: 1, unit: 'l', location: fridge, kind: 'Food', openedOn: '2026-13-45', expiresOn: '2026-02-30' }];
render();
const row = document.querySelector('.inventory-row').textContent;
log.push(`row with bad dates: ${row}`);
if (/opened/i.test(row)) fail.push('an impossible opened date shows');
if (!/No expiry date/.test(row)) fail.push('an impossible expiry date shows neither a date nor "No expiry date"');

// 4. Amounts: the fields stop at a million, and a huge amount from a file is cut to it.
if (form.elements.quantity.max !== '1000000' || form.elements.minimum.max !== '1000000') fail.push('no upper limit on the amount fields');
openItemDialog();
form.elements.name.value = 'Flour';
form.elements.quantity.value = '1e300';
if (form.elements.quantity.checkValidity()) fail.push('1e300 is a valid amount');
$('#item-dialog').close();
const huge = normalizeState({ inventory: [{ id: 'h', name: 'Salt', quantity: 1e300, unit: 'kg', location: pantry, kind: 'Food' }], recipes: [], shopping: [{ id: 's', name: 'Salt', quantity: 1e300, unit: 'g' }] });
log.push(`huge: ${huge.inventory[0].quantity}, ${huge.shopping[0].quantity}`);
if (huge.inventory[0].quantity > MAX_QUANTITY || huge.shopping[0].quantity > MAX_QUANTITY) fail.push('a huge amount from a file stays');

state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
