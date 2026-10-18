// Barcodes in Put away and scan to use up (0.11): the camera and Open Food Facts are replaced by stubs here.
// A scan on the Inventory page finds the item by its saved barcode, or else by the product's name (and then
// remembers the barcode); unknown products can be added with the barcode kept. Put away fills in the pack size.
const fail = []; const log = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
const products = { '8710000000011': { name: 'Milk', amount: 1, unit: 'l' }, '8710000000028': { name: 'Whole milk', amount: 1, unit: 'l' } };
let nextCode = '';
let lookups = 0;
readBarcode = async () => nextCode;
lookupBarcode = async (code) => { lookups += 1; return products[code] || null; };
canScanBarcodes = () => true;
state.inventory = [{ id: 'm1', name: 'Milk', quantity: 3, unit: '', location: state.locations[1], kind: 'Food' }, { id: 'r1', name: 'Rice', quantity: 500, unit: 'g', location: state.locations[0], kind: 'Food' }];
state.shopping = [];
state.log = [];
activeView = 'inventory';
render();

const scan = async (code) => { nextCode = code; document.querySelector('[data-action="scan-inventory"]').click(); await wait(); };
if (!document.querySelector('[data-action="scan-inventory"]')) fail.push('no Scan button on the Inventory page');

// Found by name: the barcode is remembered and "Use one" counts down.
await scan('8710000000011');
const milk = () => state.inventory.find((item) => item.id === 'm1');
if (!$('#scan-dialog').open || $('#scan-dialog-title').textContent !== 'Milk') fail.push(`scan did not show the milk: ${$('#scan-dialog-title').textContent}`);
if (milk().barcode !== '8710000000011') fail.push('the barcode was not remembered on the item');
document.querySelector('[data-action="scan-use-one"]').click();
await wait();
if (milk().quantity !== 2) fail.push(`use one: quantity ${milk().quantity}`);

// Found by the saved barcode without asking Open Food Facts again; then used up.
const before = lookups;
await scan('8710000000011');
if (lookups !== before) fail.push('looked the barcode up again instead of using the saved one');
document.querySelector('[data-action="scan-used"]').click();
await wait();
if (milk()) fail.push('used up did not remove the milk');
if (!state.log.some((entry) => entry.name === 'Milk' && entry.outcome === 'used')) fail.push('used up not in the month overview');

// Weighed items have no "Use one".
state.inventory[0].barcode = '8710000000035';
await scan('8710000000035');
if (document.querySelector('[data-action="scan-use-one"]')) fail.push('"Use one" offered for rice in grams');
$('#scan-dialog').close();

// Unknown product: add it, with the barcode kept.
await scan('8710000000042');
log.push(`unknown: ${$('#scan-dialog-title').textContent} · ${$('#scan-dialog-copy').textContent}`);
document.querySelector('[data-action="scan-add"]').click();
await wait();
const form = $('#item-form');
if (!$('#item-dialog').open || form.elements.barcode.value !== '8710000000042') fail.push('add from a scan did not keep the barcode');
form.elements.name.value = 'Oat drink';
form.requestSubmit();
await wait();
if (state.inventory.find((item) => item.name === 'Oat drink')?.barcode !== '8710000000042') fail.push('saved item has no barcode');

// Put away: the pack size from the scan, and the barcode on the new inventory item.
state.shopping = [{ id: 's1', name: 'Melk', quantity: 2, unit: '', checked: true }];
activeView = 'shopping';
render();
document.querySelector('[data-action="put-away"][data-id="s1"]').click();
await wait();
if ($('#putaway-scan-button').hidden) fail.push('no Scan barcode button in Put away');
nextCode = '8710000000028';
await scanPutaway();
const putaway = $('#putaway-form');
log.push(`put away: ${putaway.elements.quantity.value} ${putaway.elements.unit.value} · ${$('#putaway-barcode-status').textContent}`);
if (putaway.elements.quantity.value !== '1' || putaway.elements.unit.value !== 'l') fail.push('pack size not filled in');
putaway.requestSubmit();
await wait();
const stored = state.inventory.find((item) => item.name === 'Melk');
if (!stored || stored.barcode !== '8710000000028' || stored.quantity !== 1) fail.push(`put-away item: ${JSON.stringify(stored)}`);
state.log = [];
activeView = 'inventory';
persist();
return { fail, log };
