// Settings is split into tabs (General, Connections, Your data); connections fold to one line with their status, and
// "Open Settings" next to a missing DeepL key or Mealie goes straight to that connection, unfolded.
export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 1000 });
  await page.goto(base, { waitUntil: 'networkidle2' });
  const visible = (selector) => page.evaluate((s) => { const element = document.querySelector(s); return Boolean(element && element.checkVisibility()); }, selector);

  await page.click('#settings-button');
  await page.waitForSelector('#settings-dialog[open]');
  if (!(await visible('#language-select'))) fail.push('General tab not shown first');
  if (await visible('#mealie-settings') || await visible('#backup-status') || await visible('#settings-mode')) fail.push('other tabs visible on General');

  await page.click('[data-action="settings-tab"][data-tab="connections"]');
  if (await visible('#language-select')) fail.push('General still visible on Connections');
  if (!(await visible('#mealie-note'))) fail.push('Mealie status not shown on its folded line');
  if (await visible('input[name="mealieUrl"]')) fail.push('Mealie fields shown before unfolding');
  await page.waitForFunction(() => !/Checking/.test(document.querySelector('#mealie-note').textContent));
  log.push(`Mealie line: ${await page.evaluate(() => document.querySelector('#mealie-note').textContent)}`);
  const folded = await page.evaluate(() => document.querySelector('#mealie-settings').getBoundingClientRect().height);
  if (folded > 90) fail.push(`folded Mealie takes ${folded}px`);
  await page.click('#mealie-settings > summary');
  if (!(await visible('input[name="mealieUrl"]'))) fail.push('Mealie fields not shown after unfolding');
  const selected = await page.evaluate(() => [...document.querySelectorAll('[data-action="settings-tab"]')].map((b) => `${b.dataset.tab}:${b.getAttribute('aria-selected')}`).join(' '));
  if (selected !== 'general:false connections:true data:false') fail.push(`tab state: ${selected}`);

  await page.click('[data-action="settings-tab"][data-tab="data"]');
  if (!(await visible('[data-action="backup-data"]')) || !(await visible('#settings-mode'))) fail.push('Your data tab misses backup or kitchen mode');

  // Reopening starts on General with everything folded again.
  await page.evaluate(() => document.querySelector('#settings-dialog').close());
  await page.click('#settings-button');
  if (!(await visible('#language-select')) || await page.evaluate(() => document.querySelector('#mealie-settings').open)) fail.push('reopening did not reset to General, folded');

  // "Open Settings" from the Mealie note on the Recipes page.
  await page.evaluate(() => { document.querySelector('#settings-dialog').close(); activeView = 'recipes'; render(); });
  await page.evaluate(() => document.querySelector('[data-action="open-settings"][data-open="mealie-settings"]').click());
  if (!(await page.evaluate(() => document.querySelector('#mealie-settings').open)) || !(await visible('input[name="mealieUrl"]'))) fail.push('Open Settings did not unfold Mealie');

  // Save settings still works from any tab (a half-typed PIN on a hidden tab must not block it).
  await page.evaluate(() => { const form = document.querySelector('#settings-form'); form.elements.newPin.value = '12'; form.elements.locations.value = 'Pantry, Fridge, Freezer, Cellar'; });
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('#settings-dialog').open, { timeout: 3000 }).catch(() => fail.push('Save settings blocked'));
  if (!(await page.evaluate(() => state.locations.includes('Cellar')))) fail.push('locations not saved');
  await page.close();
  return { fail, log };
}
