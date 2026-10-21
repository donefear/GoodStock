// Two phone apps without a server share a kitchen through a shared folder: each writes its own file, a folder-sync
// app copies it to the other (done here by hand), and both settle on the same kitchen. The starting kitchens are not
// doubled, a delete on one phone and an edit on the other both arrive, and nothing is lost when both change at once.
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function openPhone() {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    page.on('pageerror', (error) => fail.push(`page: ${error.message}`));
    await page.evaluateOnNewDocument(phoneShim);
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
    return { context, page };
  }
  const ownFile = (page) => page.evaluate(() => `goodstock-sync-${folderSync().device}.json`);
  // The folder-sync app: copies one phone's own file into the other's folder.
  async function deliver(from, to) {
    const name = await ownFile(from);
    const file = await from.evaluate((n) => window.__folder[n], name);
    if (file) await to.evaluate((n, f) => { window.__folder[n] = f; }, name, file);
  }
  const sync = (page) => page.evaluate(() => syncFolderNow());
  const inventory = (page) => page.evaluate(() => state.inventory.map((item) => `${item.id}|${item.name}|${item.quantity}`).sort());
  const names = (page) => page.evaluate(() => state.inventory.map((item) => item.name));
  async function exchange(a, b) {
    await sync(a); await deliver(a, b);
    await sync(b); await deliver(b, a);
    await sync(a); await deliver(a, b);
    await sync(b);
  }

  const one = await openPhone();
  const two = await openPhone();
  const a = one.page;
  const b = two.page;
  try {
    if (!(await a.evaluate(() => !document.querySelector('#sync-folder-settings').hidden || (fillFolderSyncSettings(), !document.querySelector('#sync-folder-settings').hidden)))) fail.push('the shared folder setting is not shown in the phone app');
    await a.evaluate(() => { state.inventory.unshift({ id: makeId(), name: 'Phone A Milk', quantity: 1, unit: 'l', location: state.locations[0], kind: 'Food' }); persist(); });
    await a.evaluate(() => chooseSyncFolder());
    await wait(200);
    await b.evaluate(() => chooseSyncFolder());
    await wait(200);
    await exchange(a, b);

    const first = await names(b);
    log.push(`after linking: ${first.join(', ')}`);
    if (!first.includes('Phone A Milk')) fail.push('phone B did not get phone A\'s item');
    if (first.filter((name) => name === 'Eggs').length !== 1) fail.push(`the starting kitchens were doubled: ${first.join(', ')}`);
    if (JSON.stringify(await inventory(a)) !== JSON.stringify(await inventory(b))) fail.push('the two phones did not settle on the same kitchen');
    // Kept for later: phone A's file as it is now, with the potatoes still in it.
    const oldFileA = await a.evaluate((n) => window.__folder[n], await ownFile(a));

    // B deletes the potatoes and changes the eggs; A adds bread. All three arrive on both phones.
    await b.evaluate(() => {
      state.inventory = state.inventory.filter((item) => item.name !== 'Potatoes');
      state.inventory.find((item) => item.name === 'Eggs').quantity = 12;
      persist();
    });
    await a.evaluate(() => { state.inventory.unshift({ id: makeId(), name: 'Phone A Bread', quantity: 1, unit: '', location: state.locations[0], kind: 'Food' }); persist(); });
    await exchange(a, b);
    await exchange(b, a);
    for (const [label, page] of [['A', a], ['B', b]]) {
      const items = await page.evaluate(() => state.inventory.map((item) => ({ name: item.name, quantity: item.quantity })));
      if (items.some((item) => item.name === 'Potatoes')) fail.push(`phone ${label} still has the deleted potatoes`);
      if (!items.some((item) => item.name === 'Phone A Bread')) fail.push(`phone ${label} is missing the new bread`);
      const eggs = items.find((item) => item.name === 'Eggs');
      if (!eggs || eggs.quantity !== 12) fail.push(`phone ${label} eggs: ${JSON.stringify(eggs)}`);
    }
    if (JSON.stringify(await inventory(a)) !== JSON.stringify(await inventory(b))) fail.push('the phones differ after the changes');

    // Sync apps leave conflict copies of a file: OneDrive "goodstock-sync-<id>-LAPTOP.json", Syncthing
    // "….sync-conflict-….json", Dropbox "… (conflicted copy …).json", iCloud "… 2.json". An old copy of A's file must
    // not count as another device, nor bring back the potatoes deleted since.
    const nameA = await ownFile(a);
    const copies = [nameA.replace('.json', '-LAPTOP.json'), nameA.replace('.json', '.sync-conflict-20261018-101500-ABCDEFG.json'), nameA.replace('.json', ' (conflicted copy 2026-10-18).json'), nameA.replace('.json', ' 2.json')];
    await b.evaluate((names, file) => { for (const name of names) window.__folder[name] = { content: file.content, modified: Date.now() }; }, copies, oldFileA);
    await sync(b);
    const afterCopies = await names(b);
    if (afterCopies.includes('Potatoes')) fail.push('a conflict copy of an old file brought the deleted potatoes back');
    const devicesB = await b.evaluate(() => Object.keys(readFolderBases()).length);
    if (devicesB !== 1) fail.push(`conflict copies were counted as devices: ${devicesB} other devices`);
    await b.evaluate((names) => { for (const name of names) delete window.__folder[name]; }, copies);

    // Nothing changed: a sync writes nothing new.
    const before = await a.evaluate((n) => window.__folder[n].modified, await ownFile(a));
    await wait(20);
    await sync(a);
    if (await a.evaluate((n) => window.__folder[n].modified, await ownFile(a)) !== before) fail.push('an unchanged kitchen was written again');

    const status = await a.evaluate(() => `${document.querySelector('#sync-label').textContent} / ${document.querySelector('#sync-detail').textContent}`);
    log.push(`status: ${status}`);
    if (!/1/.test(status)) fail.push(`the sync status does not count the other phone: ${status}`);

    await a.evaluate(() => stopFolderSync());
    if (await a.evaluate(() => Boolean(folderSync()))) fail.push('still syncing after Stop');
    if (!(await names(a)).includes('Phone A Bread')) fail.push('phone lost its copy when it stopped syncing');
  } finally {
    await one.context.close();
    await two.context.close();
  }
  return { fail, log };
}
