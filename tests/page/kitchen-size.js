// Keep the kitchen file small (0.55): removals older than LOG_KEEP_DAYS fold into monthly totals instead of piling up;
// Settings → Your data shows the kitchen's size and how much of it is photos, and shrinks photos that are too big.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const daysAgo = (days) => shiftDateKey(dateKey(new Date()), -days);

// Old removals: two used and one thrown away (worth 2.50) in one month, long ago; one recent.
const oldDay = daysAgo(LOG_KEEP_DAYS + 30);
state.log = [
  { id: 'o1', name: 'Milk', date: oldDay, outcome: 'used' },
  { id: 'o2', name: 'Eggs', date: oldDay, outcome: 'used' },
  { id: 'o3', name: 'Cream', date: oldDay, outcome: 'wasted', value: 2.5 },
  { id: 'r1', name: 'Bread', date: daysAgo(3), outcome: 'wasted' },
];
state.logTotals = [];
state.inventory = [{ id: 'gone', name: 'Spinach', quantity: 1, unit: 'bag', location: state.locations[0], kind: 'Food' }];
removeInventoryItem('gone', 'used');
await wait();
const month = oldDay.slice(0, 7);
const total = state.logTotals.find((entry) => entry.id === month);
log.push(`totals ${JSON.stringify(state.logTotals)} · log ${state.log.map((entry) => entry.name)}`);
if (!total || total.used !== 2 || total.wasted !== 1 || total.value !== 2.5) fail.push(`old removals were not folded into ${month}: ${JSON.stringify(total)}`);
if (state.log.some((entry) => entry.date === oldDay)) fail.push('old removals stayed in the log');
if (!state.log.some((entry) => entry.name === 'Bread') || !state.log.some((entry) => entry.name === 'Spinach')) fail.push('recent removals should stay one by one');

// A big photo (a 1600 × 1200 picture as PNG, far above the size the app makes now).
const canvas = document.createElement('canvas');
canvas.width = 1600;
canvas.height = 1200;
const context = canvas.getContext('2d');
for (let index = 0; index < 4000; index++) { context.fillStyle = `hsl(${index % 360}, 70%, ${30 + (index % 40)}%)`; context.fillRect(Math.random() * 1600, Math.random() * 1200, 40, 40); }
const big = canvas.toDataURL('image/png');
state.recipes = [{ id: 'photo', name: 'Photo soup', ingredients: ['1 onion'], photo: big }];
document.querySelector('#settings-button').click();
showSettingsTab('data');
await wait();
const before = document.querySelector('#kitchen-size-text').textContent;
log.push(`${Math.round(big.length / 1000)} kB photo · ${before}`);
if (!/in all, of which .* photos/.test(before)) fail.push(`no kitchen size shown: ${before}`);
if (!/1 photo is larger than it needs to be/.test(before) || document.querySelector('#shrink-photos').hidden) fail.push('the large photo was not pointed out');
document.querySelector('[data-action="shrink-photos"]').click();
for (let tries = 0; tries < 30 && state.recipes[0].photo === big; tries++) await wait(100);
const after = state.recipes[0].photo;
log.push(`after: ${Math.round(after.length / 1000)} kB, ${after.slice(0, 23)}`);
if (!/^data:image\/jpeg/.test(after) || after.length > LARGE_PHOTO) fail.push('the photo was not shrunk to a small JPEG');
if (!document.querySelector('#shrink-photos').hidden) fail.push('the button stayed after shrinking');
document.querySelector('#settings-dialog').close();

state = JSON.parse(kitchenBefore);
render();
return { fail, log };
