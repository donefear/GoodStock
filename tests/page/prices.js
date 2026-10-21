// What waste costs (0.51): a price on an item is kept per unit and remembered for the product; the next time the field
// fills itself in, also when putting shopping away; thrown-away food logs what it was worth and "This month" adds it
// up; the shopping list shows a rough total for the items with a known price.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const wait = () => new Promise((resolve) => setTimeout(resolve, 40));
localStorage.setItem('goodstock-currency', 'EUR');
state.inventory = [];
state.prices = [];
state.log = [];
state.shopping = [];
activeView = 'inventory';
render();

// 1. Cheese, 400 g for 6.00.
openItemDialog();
await wait();
const form = document.querySelector('#item-form');
form.elements.name.value = 'Cheese';
form.elements.quantity.value = '400';
form.elements.unit.value = 'g';
form.elements.price.value = '6';
form.elements.price.dispatchEvent(new Event('input', { bubbles: true }));
form.requestSubmit();
await wait();
const cheese = state.inventory.find((item) => item.name === 'Cheese');
log.push(`cheese ${JSON.stringify(cheese)} · prices ${JSON.stringify(state.prices)}`);
if (cheese?.unitPrice !== 0.015) fail.push(`unit price should be 0.015 per g, is ${cheese?.unitPrice}`);
if (!state.prices.some((entry) => entry.unit === 'g' && entry.unitPrice === 0.015)) fail.push('the price was not remembered for the product');

// 2. The next cheese fills in by itself, for its own amount (1 kg = 15.00).
openItemDialog();
await wait();
form.elements.name.value = 'Cheese';
form.elements.quantity.value = '1';
form.elements.unit.value = 'kg';
form.elements.unit.dispatchEvent(new Event('input', { bubbles: true }));
if (form.elements.price.value !== '15') fail.push(`the price did not fill in for 1 kg: ${form.elements.price.value}`);
document.querySelector('#item-dialog').close();

// 3. Thrown away: worth what was left.
cheese.quantity = 200;
removeInventoryItem(cheese.id, 'wasted');
await wait();
const entry = state.log.find((item) => item.name === 'Cheese');
if (entry?.value !== 3) fail.push(`200 g thrown away should be worth 3.00, logged ${entry?.value}`);
activeView = 'inventory';
render();
const month = document.querySelector('.month-overview')?.textContent || '';
log.push(month);
if (!/worth about €3\.00|worth about €3/.test(month.replace(/\s/g, ' '))) fail.push(`"This month" does not show the cost: ${month}`);

// 4. The shopping list total, and the put-away price.
state.shopping = [{ id: 'c1', name: 'Cheese', quantity: 500, unit: 'g', checked: false }, { id: 'c2', name: 'Batteries', quantity: 4, unit: '', checked: false }];
activeView = 'shopping';
render();
const total = document.querySelector('.shopping-total')?.textContent || '';
log.push(total);
if (!/About €7\.50 for 1 item with a known price/.test(total)) fail.push(`shopping total: "${total}"`);
state.shopping[0].checked = true;
openPutawayDialog(state.shopping[0]);
await wait();
const putaway = document.querySelector('#putaway-form');
if (putaway && putaway.elements.price.value !== '7.5') fail.push(`put away should fill in 7.5, has ${putaway.elements.price.value}`);
if (putaway) {
  putaway.elements.price.value = '8';
  putaway.requestSubmit();
  await wait();
  const stored = state.inventory.find((item) => item.name === 'Cheese');
  if (stored?.unitPrice !== 0.016) fail.push(`put away at 8.00 for 500 g should set 0.016 per g, set ${stored?.unitPrice}`);
}

state = JSON.parse(kitchenBefore);
localStorage.removeItem('goodstock-currency');
render();
return { fail, log };
