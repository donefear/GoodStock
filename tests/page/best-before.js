// "Use by" and "best before" (0.48): a package date can say it's a best-before date; past it, the item says "check
// it" in amber instead of "expired" in red. Use-by (the default) stays strict, and an estimate never gets a kind.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
const yesterday = shiftDateKey(dateKey(new Date()), -1);
state.inventory = [
  { id: 'pasta', name: 'Pasta', quantity: 1, unit: 'bag', location: state.locations[0], kind: 'Food', expiresOn: yesterday, expirationSource: 'manual', dateKind: 'best-before' },
  { id: 'chicken', name: 'Chicken', quantity: 1, unit: 'pcs', location: state.locations[0], kind: 'Food', expiresOn: yesterday, expirationSource: 'manual' },
];
activeView = 'inventory';
inventoryMode = 'list';
render();
const markup = (id) => inventoryExpiryMarkup(state.inventory.find((item) => item.id === id), 'span');
log.push(markup('pasta'), markup('chicken'));
if (!/check-it/.test(markup('pasta')) || !/check it/.test(markup('pasta'))) fail.push('a past best-before date should say "check it"');
if (!/expired/.test(markup('chicken')) || !/Expired 1 day ago/.test(markup('chicken'))) fail.push('a past use-by date should still be expired');
if (!/Best before in 2 days/.test(expirationLabel(shiftDateKey(dateKey(new Date()), 2), 'best-before'))) fail.push('a coming best-before date has the wrong text');
if (!/Best before today/.test(expirationLabel(dateKey(new Date()), 'best-before'))) fail.push('"best before today" is missing');

// The form: a package date saved as best before keeps it; switching back to use by drops it.
openItemDialog(state.inventory.find((item) => item.id === 'pasta'));
await wait();
const form = document.querySelector('#item-form');
if (form.elements.dateKind.value !== 'best-before') fail.push('the dialog did not show the saved kind of date');
form.elements.dateKind.value = '';
form.requestSubmit();
await wait();
if (state.inventory.find((item) => item.id === 'pasta').dateKind) fail.push('switching to use by did not drop best before');
openItemDialog(state.inventory.find((item) => item.id === 'pasta'));
await wait();
form.elements.dateKind.value = 'best-before';
form.requestSubmit();
await wait();
if (state.inventory.find((item) => item.id === 'pasta').dateKind !== 'best-before') fail.push('best before was not saved');

// An estimate is not a package date: no kind, even if the field says best before.
openItemDialog();
await wait();
form.elements.name.value = 'Milk';
form.elements.expiresOn.value = '';
form.elements.dateKind.value = 'best-before';
form.requestSubmit();
await wait();
const milk = state.inventory.find((item) => item.name === 'Milk');
log.push(JSON.stringify(milk));
if (milk && milk.dateKind) fail.push('an estimated date got a kind');

state = JSON.parse(kitchenBefore);
render();
return { fail, log };
