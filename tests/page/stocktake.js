// Stocktake, one place at a time (0.29): still there, less, gone; the place's date is saved.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const wait = () => new Promise((resolve) => setTimeout(resolve, 30));
const click = async (selector) => { const node = document.querySelector(selector); if (!node) throw new Error(`missing ${selector}`); node.click(); await wait(); };
state.locations = ['Fridge', 'Freezer', 'Pantry'];
state.inventory = [
  { id: 'k1', name: 'Milk', quantity: 1, unit: 'l', location: 'Fridge', kind: 'Food' },
  { id: 'k2', name: 'Butter', quantity: 250, unit: 'g', location: 'Fridge', kind: 'Food' },
  { id: 'k3', name: 'Yoghurt', quantity: 2, unit: 'pcs', location: 'Fridge', kind: 'Food' },
  { id: 'k4', name: 'Peas', quantity: 400, unit: 'g', location: 'Freezer', kind: 'Food' },
];
const old = new Date(); old.setDate(old.getDate() - 35);
state.checks = [{ id: 'Freezer', date: dateKey(old) }];
state.log = [];
activeView = 'inventory';
render();
try {
  await click('[data-action="stocktake-pick"]');
  const places = Array.from(document.querySelectorAll('.stocktake-place')).map((node) => node.textContent.replace(/\s+/g, ' ').trim());
  log.push(...places);
  if (!places.some((text) => /^Fridge ?3 items · never checked/.test(text))) fail.push('Fridge should show 3 items, never checked');
  if (!places.some((text) => /^Freezer ?1 item · checked 5 weeks ago/.test(text))) fail.push('Freezer should say checked 5 weeks ago');

  await click('[data-action="stocktake-start"][data-location="Fridge"]');
  log.push(document.querySelector('.stocktake-panel h2').textContent);
  await click('[data-action="stocktake-ok"][data-id="k1"]');
  await click('[data-action="stocktake-gone"][data-id="k3"]');
  await click('[data-action="stocktake-wasted"][data-id="k3"]');
  if (state.inventory.some((item) => item.id === 'k3')) fail.push('Gone → Thrown away did not remove the yoghurt');
  if (!state.log.some((entry) => entry.name === 'Yoghurt' && entry.outcome === 'wasted')) fail.push('the yoghurt is not in the month overview as thrown away');
  // Less: the edit dialog; saving it counts as checked.
  await click('.stocktake-row [data-action="edit-item"][data-id="k2"]');
  const form = document.querySelector('#item-form');
  form.elements.quantity.value = '100';
  form.requestSubmit();
  await wait();
  log.push(document.querySelector('.stocktake-panel h2').textContent);
  if (state.inventory.find((item) => item.id === 'k2').quantity != 100) fail.push('Less did not change the butter');
  if (document.querySelector('.stocktake-panel h2').textContent !== 'All checked') fail.push('the fridge should be all checked');
  await click('[data-action="stocktake-done"]');
  const check = state.checks.find((entry) => entry.id === 'Fridge');
  if (!check || check.date !== dateKey(new Date())) fail.push('the fridge was not saved as checked today');
  if (document.querySelector('.stocktake-panel')) fail.push('Done did not close the stocktake');
  if (!MERGED_LISTS.includes('checks')) fail.push('checks are not merged between devices');
} catch (error) {
  fail.push(String(error.message || error));
}
stocktake = null;
state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
