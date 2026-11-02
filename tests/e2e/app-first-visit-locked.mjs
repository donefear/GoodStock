// A new device that meets a household PIN (or no server) keeps its sample kitchen to itself: after unlocking, the
// server's kitchen is what it shows, and nothing of the sample was added to it.
export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const owner = await browser.newPage();
  owner.on('dialog', (dialog) => dialog.accept());
  await owner.goto(base, { waitUntil: 'networkidle2' });
  // The shared kitchen: two items and one recipe, then a PIN.
  await owner.evaluate(async () => {
    state.inventory = [{ id: 'k1', name: 'Rice', quantity: 1, unit: 'kg', location: state.locations[0], kind: 'Food' }, { id: 'k2', name: 'Milk', quantity: 1, unit: 'l', location: state.locations[0], kind: 'Food' }];
    state.recipes = [{ id: 'kr', name: 'Rice pudding', ingredients: ['100 g rice', '500 ml milk'], instructions: [] }];
    persist();
    for (let tries = 0; tries < 50 && localStorage.getItem(PENDING_KEY); tries++) await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('#settings-form').elements.newPin.value = '2468';
    await savePin();
  });
  const serverKitchen = async () => (await owner.evaluate(async () => { const body = await (await fetch('/api/state', { cache: 'no-store' })).json(); return { inventory: body.inventory.length, recipes: body.recipes.length }; }));
  const startCounts = await serverKitchen();
  log.push(`server kitchen: ${JSON.stringify(startCounts)}`);

  const context = await browser.createBrowserContext();
  try {
    const guest = await context.newPage();
    await guest.goto(base, { waitUntil: 'networkidle2' });
    await wait(500);
    const locked = await guest.evaluate(() => ({ pin: document.querySelector('#pin-dialog').open, pending: Boolean(localStorage.getItem(PENDING_KEY)) }));
    log.push(`locked: ${JSON.stringify(locked)}`);
    if (!locked.pin) fail.push('the new device was not asked for the PIN');
    if (locked.pending) fail.push('the sample kitchen was queued for the server while locked');
    // A reload while still locked doesn't queue it either.
    await guest.reload({ waitUntil: 'networkidle2' });
    await wait(500);
    if (await guest.evaluate(() => Boolean(localStorage.getItem(PENDING_KEY)))) fail.push('the sample kitchen was queued after a reload while locked');
    await Promise.all([guest.waitForNavigation({ waitUntil: 'networkidle2' }), guest.evaluate(() => unlockWithPin('2468'))]);
    await wait(1500);
    const shown = await guest.evaluate(() => ({ inventory: state.inventory.map((item) => item.name), recipes: state.recipes.length }));
    log.push(`after unlocking: ${JSON.stringify(shown)}`);
    if (shown.inventory.join() !== 'Rice,Milk' || shown.recipes !== 1) fail.push(`after unlocking the device shows ${JSON.stringify(shown)}, not the shared kitchen`);
    const endCounts = await serverKitchen();
    log.push(`server kitchen after: ${JSON.stringify(endCounts)}`);
    if (JSON.stringify(endCounts) !== JSON.stringify(startCounts)) fail.push(`the server kitchen changed from ${JSON.stringify(startCounts)} to ${JSON.stringify(endCounts)}`);
  } finally {
    await context.close();
    await owner.evaluate(() => removePin()).catch(() => {});
    await owner.close();
  }
  return { fail, log };
}
