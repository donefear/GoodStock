// Every view, Settings and cook mode in every language, on a tablet and a phone: no script errors, no 404s, no
// sideways scrolling, navigation translated, and switching language live works.
const LANGS = ['en', 'nl', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ro', 'pl', 'tr'];
const VIEWS = ['inventory', 'week', 'shopping', 'recipes', 'tools'];
const SIZES = [{ width: 1280, height: 800, name: 'tablet' }, { width: 390, height: 844, name: 'phone' }];

export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  let englishNav = [];
  for (const [index, lang] of LANGS.entries()) {
    for (const size of SIZES) {
      const page = await browser.newPage();
      await page.setViewport(size);
      page.on('pageerror', (error) => fail.push(`${lang} ${size.name}: ${error.message}`));
      page.on('response', (response) => { if (response.status() >= 400 && !/\/api\/product\//.test(response.url())) fail.push(`${lang}: ${response.status()} ${response.url()}`); });
      await page.goto(base, { waitUntil: 'networkidle2' });
      await page.evaluate((code) => localStorage.setItem('goodstock-language-v1', code), lang);
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForSelector('#view-container .page-heading');
      if ((await page.evaluate(() => document.documentElement.lang)) !== lang) fail.push(`${lang}: html lang not set`);
      const nav = await page.evaluate(() => [...document.querySelectorAll('.nav-item')].map((button) => button.textContent.trim()));
      if (index === 0) englishNav = nav;
      else if (nav.every((text, i) => text === englishNav[i])) fail.push(`${lang}: navigation still English`);
      for (const view of VIEWS) {
        await page.evaluate((name) => document.querySelector(`.nav-item[data-view="${name}"]`).click(), view);
        if (view === 'tools') {
          for (const tab of ['convert', 'terms', 'timers']) await page.evaluate((name) => document.querySelector(`[data-action="tools-tab"][data-tab="${name}"]`).click(), tab);
        }
        const overflow = await page.evaluate(() => { window.scrollTo(100000, 0); const x = window.scrollX; window.scrollTo(0, 0); return x; });
        if (overflow > 1) fail.push(`${lang} ${size.name} ${view}: ${overflow}px wider than the screen`);
      }
      await page.evaluate(() => document.querySelector('.nav-item[data-view="recipes"]').click());
      await page.evaluate(() => document.querySelector('[data-action="view-recipe"]').click());
      await page.evaluate(() => document.querySelector('.recipe-page-actions [data-action="start-steps"]').click());
      await page.waitForSelector('#steps-dialog[open]');
      for (let step = 0; step < 4; step++) await page.evaluate(() => document.querySelector('.steps-next').click());
      if (size.name === 'tablet') log.push(`${lang}: ${await page.evaluate(() => document.querySelector('#steps-counter').textContent)}`);
      await page.evaluate(() => document.querySelector('#steps-dialog').close());
      await page.evaluate(() => document.querySelector('#settings-button').click());
      await page.waitForSelector('#settings-dialog[open]');
      if ((await page.evaluate(() => document.querySelector('#language-select').value)) !== lang) fail.push(`${lang}: language select wrong`);
      const other = index === 0 ? 'nl' : 'en';
      await page.select('#language-select', other);
      await page.waitForFunction((code) => document.documentElement.lang === code, { timeout: 5000 }, other).catch(() => fail.push(`${lang}: live language switch failed`));
      await page.close();
    }
  }
  return { fail, log };
}
