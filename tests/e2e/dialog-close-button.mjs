// Long dialogs keep their title and × at the top while you scroll down (phone size, light and dark, big text).
export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  const cases = [
    { name: 'settings', open: () => document.querySelector('#settings-button').click(), dialog: '#settings-dialog' },
    { name: 'recipe editor', open: () => openRecipeEditor(), dialog: '#recipe-edit-dialog' },
    { name: 'DeepL help', open: () => document.querySelector('#deepl-help-dialog').showModal(), dialog: '#deepl-help-dialog' },
  ];
  for (const setup of [{ theme: 'light', size: 'normal' }, { theme: 'dark', size: 'normal' }, { theme: 'light', size: 'xlarge' }]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 700 });
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.evaluate(({ theme, size }) => { localStorage.setItem('goodstock-theme-v1', theme); localStorage.setItem('goodstock-text-size-v1', size); }, setup);
    await page.reload({ waitUntil: 'networkidle2' });
    for (const { name, open, dialog } of cases) {
      await page.evaluate(open);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const result = await page.evaluate((selector) => {
        const box = document.querySelector(selector);
        box.scrollTop = box.scrollHeight;
        const close = box.querySelector('.dialog-heading .close-button');
        const rect = close.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const dialogRect = box.getBoundingClientRect();
        return { scrolled: box.scrollTop, closeVisible: hit === close, insideTop: rect.top >= dialogRect.top - 1 };
      }, dialog);
      log.push(`${setup.theme}/${setup.size} ${name}: scrolled ${result.scrolled}px, × ${result.closeVisible ? 'visible' : 'HIDDEN'}`);
      if (!result.scrolled) fail.push(`${name}: dialog did not scroll (test needs a long dialog)`);
      if (!result.closeVisible || !result.insideTop) fail.push(`${setup.theme}/${setup.size} ${name}: × not reachable after scrolling down`);
      await page.evaluate((selector) => {
        const box = document.querySelector(selector);
        box.querySelector('.dialog-heading .close-button').click();
      }, dialog);
      if (await page.evaluate((selector) => document.querySelector(selector).open, dialog)) fail.push(`${name}: × did not close the dialog`);
    }
    await page.close();
  }
  return { fail, log };
}
