// Using part of an item (v4.5.5): 150 g off a 1 kg bag of oats leaves 850 g, by hand ("Use some", tap the amount),
// when cooking (the cook dialog asks in grams), and from a recipe in cups (the converter's densities).
const fail = []; const log = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
const kitchenBefore = JSON.stringify(state);
const viewBefore = activeView;
const unitsBefore = (() => { try { return localStorage.getItem(UNITS_KEY); } catch { return null; } })();
localStorage.setItem(UNITS_KEY, 'metric');
const oats = () => state.inventory.find((item) => item.id === 'oats');
const reset = () => {
  state.inventory = [{ id: 'oats', name: 'Rolled oats', quantity: 1, unit: 'kg', location: state.locations[0], kind: 'Food' }];
  state.shopping = [];
  render();
};

// Shown in a friendly unit: 0.85 kg is 850 g, 1500 g is 1.5 kg.
if (amountText(0.85, 'kg') !== '850 g' || amountText(1500, 'g') !== '1.5 kg' || amountText(1, 'kg') !== '1 kg') fail.push(`amounts: ${amountText(0.85, 'kg')}, ${amountText(1500, 'g')}, ${amountText(1, 'kg')}`);

// 1. By hand: tap the amount, 150 g, see what is left, take it off.
activeView = 'inventory';
reset();
document.querySelector('[data-action="use-some"][data-id="oats"]').click();
await wait();
const form = $('#use-form');
if (!$('#use-dialog').open) fail.push('tapping the amount does not open Use some');
if (form.elements.unit.value !== 'g') fail.push(`Use some starts in ${form.elements.unit.value}, not g`);
form.elements.quantity.value = '150';
form.elements.quantity.dispatchEvent(new Event('input', { bubbles: true }));
log.push(`use some: ${$('#use-have').textContent} · ${$('#use-left').textContent}`);
if (!/850 g/.test($('#use-left').textContent)) fail.push(`the preview says "${$('#use-left').textContent}"`);
form.requestSubmit();
await wait();
if (oats().quantity !== 0.85) fail.push(`after using 150 g: ${oats().quantity} ${oats().unit}`);
if (!/850\s*g/.test(document.querySelector('.inventory-row .stepper-amount').textContent)) fail.push(`the row shows ${document.querySelector('.inventory-row .stepper-amount').textContent}`);
// Pieces can't come off a kilo bag.
document.querySelector('[data-action="use-some"][data-id="oats"]').click();
form.elements.quantity.value = '2';
form.elements.unit.value = 'pcs';
form.elements.unit.dispatchEvent(new Event('change', { bubbles: true }));
form.requestSubmit();
await wait();
if (oats().quantity !== 0.85) fail.push('pieces were taken off a kilo bag');
$('#use-dialog').close();

// 2. − and ＋ on a kilo bag step 0.1 kg, not a whole kilo.
reset();
document.querySelector('[data-action="adjust"][data-id="oats"][data-delta="-1"]').click();
if (oats().quantity !== 0.9) fail.push(`− on 1 kg gave ${oats().quantity} kg`);

// 3. Cooking a recipe with 150 g oats: the dialog asks for 150 g and leaves 850 g.
reset();
state.recipes = [{ id: 'porridge', name: 'Porridge', ingredients: ['150 g rolled oats'] }, { id: 'cups', name: 'Oat cookies', ingredients: ['1 cup rolled oats'] }];
state.plan = [{ id: 'cook1', date: dateKey(new Date()), recipeId: 'porridge', cooked: false }, { id: 'cook2', date: dateKey(new Date()), recipeId: 'cups', cooked: false }];
openCookDialog(state.plan.find((entry) => entry.id === 'cook1'));
await wait();
const amount = document.querySelector('#cook-ingredients input[name="amount-0"]');
log.push(`cook dialog: ${amount && amount.value} ${amount && amount.dataset.unit}`);
if (!amount || amount.value !== '150' || amount.dataset.unit !== 'g') fail.push(`the cook dialog asks for ${amount && amount.value} ${amount && amount.dataset.unit}`);
$('#cook-form').requestSubmit();
await wait();
if (oats().quantity !== 0.85) fail.push(`after cooking: ${oats().quantity} ${oats().unit}`);

// 4. A cup of oats (about 91 g with the converter's 0.38 g/ml) comes off the kilo bag too.
reset();
openCookDialog(state.plan.find((entry) => entry.id === 'cook2'));
await wait();
const cup = document.querySelector('#cook-ingredients input[name="amount-0"]');
log.push(`a cup of oats: ${cup && cup.value} ${cup && cup.dataset.unit}`);
if (!cup || cup.dataset.unit !== 'g' || Math.abs(Number(cup.value) - 91) > 2) fail.push(`a cup of oats asks for ${cup && cup.value} ${cup && cup.dataset.unit}`);
$('#cook-form').requestSubmit();
await wait();
if (Math.abs(oats().quantity - 0.909) > 0.002) fail.push(`after the cup: ${oats().quantity} kg`);

{
  if (unitsBefore === null) localStorage.removeItem(UNITS_KEY); else localStorage.setItem(UNITS_KEY, unitsBefore);
}
state = normalizeState(JSON.parse(kitchenBefore));
activeView = viewBefore;
render();
return { fail, log };
