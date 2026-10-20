// Android 4.4 (0.41): its WebView can't open a file picker, so the bridge picks the file (canPickFile, pickFile).
// Restore, "Open a recipe file" and a recipe photo all go through it, and nothing opens the browser's own picker.
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.evaluateOnNewDocument(phoneShim);
  await page.evaluateOnNewDocument(() => {
    window.__picks = [];
    window.GoodstockNative.canPickFile = () => true;
    window.GoodstockNative.pickFile = (id, accept) => {
      window.__picks.push(accept);
      const file = window.__nextFile;
      setTimeout(() => (file ? window.__goodstockNativeCallback(id, true, JSON.stringify(file)) : window.__goodstockNativeCallback(id, false, 'cancelled')), 5);
    };
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  const fileChooser = [];
  page.on('filechooser', () => fileChooser.push(true));
  // UTF-8 text as the bridge sends it: base64 of the bytes.
  const asFile = (name, type, text) => ({ name, type, data: Buffer.from(text, 'utf8').toString('base64') });

  // Restore a backup with an accented name.
  const backup = await page.evaluate(() => JSON.stringify({ state: { ...state, inventory: [{ id: 'picked', name: 'Crème fraîche', quantity: 1, unit: 'pcs', location: state.locations[0], kind: 'Food' }] } }));
  await page.evaluate((file) => { window.__nextFile = file; }, asFile('kitchen.json', 'application/json', backup));
  await page.evaluate(() => { document.querySelector('#settings-button').click(); showSettingsTab('data'); document.querySelector('[data-action="restore-data"]').click(); });
  await page.waitForFunction(() => state.inventory.some((item) => item.id === 'picked'), { timeout: 5000 }).catch(() => fail.push('restore through the bridge did not replace the kitchen'));
  log.push(`restored: ${await page.evaluate(() => state.inventory.map((item) => item.name).join(', '))}`);
  if (!(await page.evaluate(() => state.inventory.some((item) => item.name === 'Crème fraîche')))) fail.push('accented text was not read as UTF-8');

  // Open a recipe file: the label's click goes to the bridge.
  const recipeFile = await page.evaluate(() => recipeFileContent({ ...state.recipes[0], id: 'x', name: 'Picked soup' }));
  await page.evaluate((file) => { window.__nextFile = file; }, asFile('Picked soup.goodstock-recipe', '', recipeFile));
  await page.evaluate(() => { document.querySelector('#settings-dialog').close(); openRecipeEditor(); });
  await page.evaluate(() => document.querySelector('.recipe-file-button').click());
  await page.waitForFunction(() => document.querySelector('#recipe-edit-form [name="name"]')?.value === 'Picked soup', { timeout: 5000 }).catch(() => fail.push('the recipe file picked through the bridge did not fill the editor'));

  // A photo: a 1×1 PNG becomes the editor's small JPEG.
  await page.evaluate(() => {
    window.__nextFile = { name: 'photo.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' };
    document.querySelector('[data-action="recipe-photo-pick"]').click();
  });
  await page.waitForFunction(() => /^data:image\/jpeg/.test(document.querySelector('#recipe-edit-form [name="photo"]')?.value || ''), { timeout: 5000 }).catch(() => fail.push('the photo picked through the bridge was not used'));

  // Cancelled: nothing happens, no error.
  await page.evaluate(() => { window.__nextFile = null; document.querySelector('[data-action="recipe-photo-pick"]').click(); });
  await new Promise((resolve) => setTimeout(resolve, 100));

  const picks = await page.evaluate(() => window.__picks);
  log.push(`asked for: ${JSON.stringify(picks)}`);
  if (picks.length !== 4 || picks[2] !== 'image/*') fail.push(`expected four picks, the third for image/*: ${JSON.stringify(picks)}`);
  if (fileChooser.length) fail.push('the browser file chooser opened as well');
  await page.close();
  return { fail, log };
}
