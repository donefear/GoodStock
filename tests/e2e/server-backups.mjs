// Server backups (0.18): a copy before the first save of the day and a safety copy before a save that removes most
// of the kitchen, listed in Settings → Your data and restored from there.
export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  const revision = () => fetch(`${base}/api/state/revision`).then((response) => response.json()).then((body) => body.revision);
  const save = async (change) => {
    const before = await revision();
    await page.evaluate(change);
    for (let tries = 0; tries < 50 && (await revision()) === before; tries++) await new Promise((resolve) => setTimeout(resolve, 100));
  };

  // A kitchen with eight items, saved twice (the first save has nothing to back up yet).
  await save(`state.inventory = Array.from({ length: 8 }, (_, index) => ({ id: 'b' + index, name: 'Item ' + index, quantity: 1, unit: '', location: state.locations[0], kind: 'Food' })); persist();`);
  await save(`state.inventory[0].quantity = 2; persist();`);
  let { backups } = await fetch(`${base}/api/backups`).then((response) => response.json());
  log.push(`after two saves: ${JSON.stringify(backups)}`);
  if (backups.length !== 1 || !/^state-\d{4}-\d{2}-\d{2}\.json$/.test(backups[0].name)) fail.push('no daily backup after a save');

  // Removing almost everything at once makes a safety copy first.
  await save(`state.inventory = []; state.recipes = []; persist();`);
  ({ backups } = await fetch(`${base}/api/backups`).then((response) => response.json()));
  const safety = backups.find((backup) => backup.safety);
  log.push(`after the wipe: ${JSON.stringify(backups.map(({ name, inventory, recipes }) => ({ name, inventory, recipes })))}`);
  if (!safety || safety.inventory !== 8) fail.push('no safety copy before removing most of the kitchen');

  // Names are checked: no paths out of the backups folder.
  const outside = await fetch(`${base}/api/backups/..%2Fstate.json`);
  if (outside.status !== 400 && outside.status !== 404) fail.push(`a path outside the backups was answered (${outside.status})`);

  // Settings → Your data lists them, and Restore brings the kitchen back.
  await page.evaluate(() => document.querySelector('#settings-button').click());
  await page.waitForFunction(() => document.querySelectorAll('#server-backups [data-action="restore-server-backup"]').length >= 2, { timeout: 5000 }).catch(() => fail.push('backups not listed in Settings'));
  const shown = await page.evaluate(() => ({ hidden: document.querySelector('#server-backups-zone').hidden, rows: [...document.querySelectorAll('#server-backups li')].map((row) => row.textContent.trim()) }));
  log.push(`listed: ${JSON.stringify(shown)}`);
  if (shown.hidden) fail.push('server backups hidden in the server version');
  await save(`document.querySelector('#server-backups [data-action="restore-server-backup"][data-name="${safety?.name}"]').click();`);
  const restored = await fetch(`${base}/api/state`).then((response) => response.json());
  if (restored.inventory.length !== 8) fail.push(`restore did not bring back the items (${restored.inventory.length})`);
  await page.close();
  return { fail, log };
}
