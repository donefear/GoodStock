// Learning shelf life from what gets thrown away (0.30).
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const daysAgo = (n) => { const date = new Date(); date.setDate(date.getDate() - n); return dateKey(date); };
state.log = [];
state.shelfLife = [];
const throwAway = (name, location, kept) => {
  const id = makeId();
  state.inventory.push({ id, name, quantity: 1, unit: '', location, kind: 'Food', addedOn: daysAgo(kept) });
  removeInventoryItem(id, 'wasted');
};
const estimate = shelfLifeDaysFor('Carrots', 'Fridge', false);
log.push(`carrots in the fridge: estimate ${estimate} days`);
throwAway('Carrots', 'Fridge', Math.max(1, estimate - 3));
throwAway('Carrots', 'Fridge', Math.max(1, estimate - 2));
const entry = state.log[state.log.length - 1];
if (entry.kept !== Math.max(1, estimate - 2) || entry.storage !== 'fridge') fail.push(`removal did not record kept days and storage: ${JSON.stringify(entry)}`);
if (shelfLifeSuggestions().length) fail.push('suggested after only two times');
throwAway('carrot', 'Koelkast', Math.max(1, estimate - 4));
// Used up doesn't count, and neither does keeping something longer than its estimate.
const usedId = makeId();
state.inventory.push({ id: usedId, name: 'Carrots', quantity: 1, unit: '', location: 'Fridge', kind: 'Food', addedOn: daysAgo(1) });
removeInventoryItem(usedId, 'used');
for (let time = 0; time < 3; time++) throwAway('Rice', 'Pantry', shelfLifeDaysFor('Rice', 'Pantry', false) + 10);
const suggestions = shelfLifeSuggestions();
log.push(...suggestions.map((suggestion) => `${suggestion.name} ${suggestion.storage}: ${suggestion.days} (estimate ${suggestion.estimate}, ${suggestion.times} times)`));
if (suggestions.length !== 1 || suggestions[0].days !== Math.max(1, estimate - 3) || suggestions[0].times !== 3) fail.push('expected one suggestion for carrots: the median of three throw-aways');

activeView = 'inventory';
render();
const card = document.querySelector('.shelf-life-suggestions');
log.push(card ? card.textContent.replace(/\s+/g, ' ').trim() : '(no card)');
if (!card) fail.push('no "Learned from your kitchen" card');
else {
  card.querySelector('[data-action="shelf-life-use"]').click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const days = suggestedExpiration('Carrots', 'Fridge').days;
  log.push(`after Use: new carrots get ${days} days`);
  if (days !== Math.max(1, estimate - 3)) fail.push('accepted time not used for new carrots');
  if (shelfLifeDaysFor('Carrots', 'Freezer') !== shelfLifeDaysFor('Carrots', 'Freezer', false)) fail.push('the fridge time changed the freezer estimate');
  if (document.querySelector('.shelf-life-suggestions')) fail.push('card still shown after answering');
}

// New items know when they came in; an edit keeps the date.
openItemDialog();
const form = document.querySelector('#item-form');
form.elements.name.value = 'Leeks';
form.elements.quantity.value = '2';
form.requestSubmit();
await new Promise((resolve) => setTimeout(resolve, 30));
const leeks = state.inventory.find((item) => item.name === 'Leeks');
if (!leeks || leeks.addedOn !== dateKey(new Date())) fail.push(`a new item has no addedOn: ${leeks && leeks.addedOn}`);
if (!MERGED_LISTS.includes('shelfLife')) fail.push('learned times are not merged between devices');

state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
