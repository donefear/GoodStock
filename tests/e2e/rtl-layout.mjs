// Right-to-left layout (0.21): a language with dir: 'rtl' mirrors the page. Every view on a tablet and a phone has
// the menu on the right (desktop) or along the bottom (phone), nothing wider than the screen, arrows pointing the
// other way, and typed text (recipes) keeping its own direction. Switching back to English puts it all back.
export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  // A stand-in right-to-left language (no translations, so the text stays English).
  await page.evaluate(async () => {
    LANGUAGES.push({ code: 'xr', name: 'RTL test', locale: 'en-GB', dir: 'rtl' });
    window.GOODSTOCK_TRANSLATIONS.xr = {};
    await setLanguage('xr');
  });
  if (await page.evaluate(() => document.documentElement.dir) !== 'rtl') fail.push('an rtl language did not set dir="rtl"');
  for (const [width, height] of [[1280, 800], [400, 820]]) {
    await page.setViewport({ width, height });
    for (const view of ['inventory', 'week', 'shopping', 'recipes', 'tools', 'recipe']) {
      const result = await page.evaluate((name) => {
        state.shopping = [{ id: 's1', name: 'Milk', quantity: 1, unit: 'l', checked: false }];
        if (name === 'recipe') openRecipePage(state.recipes[0].id); else { activeView = name; render(); }
        const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
        const main = document.querySelector('#view-container').getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          sidebarRight: Math.round(window.innerWidth - sidebar.right), sidebarLeft: Math.round(sidebar.left),
          overlap: window.innerWidth > 720 ? Math.round(main.right - sidebar.left) : 0,
          arrows: (document.querySelector('#view-container').textContent.match(/→/g) || []).length,
        };
      }, view);
      const where = `${view} at ${width}px`;
      if (result.overflow > 1) fail.push(`${where}: ${result.overflow}px wider than the screen`);
      if (width > 720 && result.sidebarRight !== 0) fail.push(`${where}: menu not on the right (${JSON.stringify(result)})`);
      if (width <= 720 && (result.sidebarRight !== 0 || result.sidebarLeft !== 0)) fail.push(`${where}: bottom menu not full width`);
      if (result.overlap > 0) fail.push(`${where}: content runs under the menu by ${result.overlap}px`);
      if (result.arrows) fail.push(`${where}: ${result.arrows} arrows still point right`);
    }
  }
  // Typed text keeps its own direction: "1 onion" stays in that order in an English recipe.
  const bidi = await page.evaluate(() => { openRecipePage(state.recipes[0].id); return getComputedStyle(document.querySelector('.recipe-method-step p')).unicodeBidi; });
  if (bidi !== 'plaintext') fail.push(`recipe steps don't keep their own direction (${bidi})`);
  await page.evaluate(() => setLanguage('en'));
  const back = await page.evaluate(() => { activeView = 'week'; render(); return { dir: document.documentElement.dir, arrows: (document.querySelector('#view-container').textContent.match(/→/g) || []).length }; });
  log.push(`back in English: ${JSON.stringify(back)}`);
  if (back.dir !== 'ltr' || !back.arrows) fail.push('switching back to English did not put the layout back');
  await page.close();
  return { fail, log };
}
