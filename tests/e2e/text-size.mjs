// Text size (4.8): Large and Extra large still fit the screen on a tablet and a phone.
export default async function run({ browser, base }) {
  const fail = [];
  for (const [lang, size] of [['en', 'xlarge'], ['de', 'xlarge'], ['de', 'large']]) {
    for (const viewport of [{ width: 1280, height: 800, name: 'tablet' }, { width: 390, height: 844, name: 'phone' }]) {
      const page = await browser.newPage();
      await page.setViewport(viewport);
      page.on('pageerror', (error) => fail.push(`${lang} ${size}: ${error.message}`));
      await page.goto(base, { waitUntil: 'networkidle2' });
      await page.evaluate((l, s) => { localStorage.setItem('goodstock-language-v1', l); localStorage.setItem('goodstock-text-size-v1', s); }, lang, size);
      await page.reload({ waitUntil: 'networkidle2' });
      for (const view of ['inventory', 'week', 'shopping', 'recipes', 'tools']) {
        await page.evaluate((v) => document.querySelector(`.nav-item[data-view="${v}"]`).click(), view);
        const overflow = await page.evaluate(() => { window.scrollTo(100000, 0); const x = window.scrollX; window.scrollTo(0, 0); return x; });
        if (overflow > 2) fail.push(`${lang} ${size} ${viewport.name} ${view}: ${overflow}px too wide`);
      }
      await page.evaluate(() => document.querySelector('#settings-button').click());
      await new Promise((resolve) => setTimeout(resolve, 300));
      const visible = await page.evaluate(() => { const box = document.querySelector('#settings-dialog .dialog-heading').getBoundingClientRect(); return box.top >= -2; });
      if (!visible) fail.push(`${lang} ${size} ${viewport.name}: settings dialog runs off the top`);
      await page.close();
    }
  }
  return { fail };
}
