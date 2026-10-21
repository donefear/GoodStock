// The shopping list learns your shop (0.50): three trips that tick dairy first and vegetables last turn the groups
// around; "Check all" teaches nothing; "Forget the order" goes back to the general order; the order survives a merge.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const wait = () => new Promise((resolve) => setTimeout(resolve, 30));
localStorage.removeItem('goodstock-shop-trip');
delete state.shopOrder;
const list = () => [
  { id: 's1', name: 'Milk', checked: false },
  { id: 's2', name: 'Bread', checked: false },
  { id: 's3', name: 'Carrots', checked: false },
  { id: 's4', name: 'Apples', checked: false },
];
const groupsShown = () => shoppingGroups(state.shopping).map((group) => group.key);
activeView = 'shopping';

// The general order first: vegetables, fruit, bakery, dairy.
state.shopping = list();
log.push(`general: ${groupsShown()}`);
if (groupsShown().join() !== 'Vegetables,Fruit,Bakery,Dairy') fail.push(`general order is ${groupsShown()}`);

async function trip(order) {
  state.shopping = list();
  render();
  for (const name of order) {
    const item = state.shopping.find((entry) => entry.name === name);
    const box = document.querySelector(`input[data-action="check-shopping"][data-id="${item.id}"]`);
    box.click();
    await wait();
  }
}
// This shop: dairy at the entrance, then bread, fruit, vegetables at the back.
for (let index = 0; index < 3; index++) await trip(['Milk', 'Bread', 'Apples', 'Carrots']);
state.shopping = list();
log.push(`learned after ${state.shopOrder?.trips} trips: ${groupsShown()}`);
if (state.shopOrder?.trips !== 3) fail.push(`expected 3 trips, got ${state.shopOrder?.trips}`);
if (groupsShown().join() !== 'Dairy,Bakery,Fruit,Vegetables') fail.push(`learned order is ${groupsShown()}`);
render();
if (!/learned from 3 trips/.test(document.querySelector('.shop-order-note')?.textContent || '')) fail.push('no "learned from 3 trips" note');

// "Check all" is not a trip.
document.querySelector('[data-action="check-all"]')?.click();
await wait();
if (state.shopOrder.trips !== 3) fail.push('"Check all" counted as a trip');

// Another device that never learned keeps this device's order in a merge; a device that learned more wins.
const merged = mergeStates(JSON.parse(kitchenBefore), state, JSON.parse(kitchenBefore));
if (merged.shopOrder?.trips !== 3) fail.push('the learned order was lost in a merge');

// Forget.
state.shopping = list();
render();
document.querySelector('[data-action="reset-shop-order"]').click();
await wait();
if (state.shopOrder || groupsShown().join() !== 'Vegetables,Fruit,Bakery,Dairy') fail.push('"Forget the order" did not go back to the general order');

state = JSON.parse(kitchenBefore);
localStorage.removeItem('goodstock-shop-trip');
render();
return { fail, log };
