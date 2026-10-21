// Kitchen screen (0.46): today's meal, running timers, what to use soon and the shopping count in large type; it
// dims at night, comes back after a reload on this device, and "Back to the app" closes it.
const fail = [];
const log = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const today = dateKey(new Date());
const recipe = state.recipes[0];
state.plan.push({ id: 'kitchen-screen-meal', date: today, recipeId: recipe.id, cooked: false });
state.inventory.push({ id: 'kitchen-screen-milk', name: 'Milk', quantity: 1, unit: 'l', location: state.locations[0], kind: 'Food', expiresOn: today });
state.shopping.push({ id: 'kitchen-screen-bread', name: 'Bread', checked: false });
cookTimers.push({ id: 'kitchen-screen-timer', label: 'Pasta', name: 'Pasta', endsAt: Date.now() + 125000, done: false });

document.querySelector('[data-action="kitchen-screen"]').click();
await wait(50);
const screen = document.querySelector('#kitchen-screen');
const text = screen.textContent.replace(/\s+/g, ' ');
log.push(text.slice(0, 300));
if (screen.hidden) fail.push('the kitchen screen did not open');
if (!text.includes(recipe.name)) fail.push("today's meal is missing");
if (!screen.querySelector(`[data-action="kitchen-cook"][data-plan="kitchen-screen-meal"]`)) fail.push('no cook button for the meal');
if (!/Pasta\s*2:0\d/.test(text)) fail.push(`the running timer is missing: ${text}`);
if (!text.includes('Milk')) fail.push('the use-soon item is missing');
if (!/thing(s)? on the shopping list/.test(text)) fail.push('the shopping count is missing');
if (localStorage.getItem('goodstock-kitchen-screen') !== '1') fail.push('the kitchen screen is not remembered for this device');

// It follows the kitchen: a new shopping item shows after the next redraw.
state.shopping.push({ id: 'kitchen-screen-eggs', name: 'Eggs', checked: false });
render();
const count = state.shopping.filter((item) => !item.checked).length;
if (!screen.textContent.includes(String(count))) fail.push('the shopping count did not follow the kitchen');

// Night: dimmed until a tap.
const RealDate = Date;
const night = new RealDate();
night.setHours(23, 30, 0, 0);
window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [night.getTime()])); } static now() { return night.getTime(); } };
kitchenScreenAwakeUntil = 0;
renderKitchenScreen();
const dimmed = screen.classList.contains('night');
screen.querySelector('.kitchen-card').click();
const woke = !screen.classList.contains('night');
window.Date = RealDate;
if (!dimmed) fail.push('the screen did not dim at night');
if (!woke) fail.push('a tap did not brighten the dimmed screen');

document.querySelector('[data-action="close-kitchen-screen"]').click();
if (!screen.hidden) fail.push('"Back to the app" did not close it');
if (localStorage.getItem('goodstock-kitchen-screen')) fail.push('closing did not forget it');

cookTimers = cookTimers.filter((timer) => timer.id !== 'kitchen-screen-timer');
state.plan = state.plan.filter((entry) => entry.id !== 'kitchen-screen-meal');
state.inventory = state.inventory.filter((item) => item.id !== 'kitchen-screen-milk');
state.shopping = state.shopping.filter((item) => !item.id.startsWith('kitchen-screen'));
render();
return { fail, log };
