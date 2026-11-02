// Layout, round 2 (4.9): the kitchen tablet and phones.
// - Without flex gap (Chrome 81, html.no-flex-gap), neighbours in the main rows still keep a distance: simulated here
//   by switching the fallback on and taking every flex gap away.
// - The week strip shows all seven days without scrolling at tablet sizes, at every text size.
// - On a phone the running timers sit above the Undo bar instead of under it.
// - Phone touch targets (amount stepper, ••• button, rating stars) are at least 44px.
// - The printed shopping list keeps its amounts inside the page.
// - Russian gets the Cyrillic faces bundled under the DM Sans and Fraunces names (fonts/build-fonts.mjs).
const pause = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(browser, base, viewport, size, lang = 'en') {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.evaluate((l, s) => { localStorage.setItem('goodstock-language-v1', l); localStorage.setItem('goodstock-text-size-v2', s); }, lang, size);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#view-container .page-heading');
  await page.evaluate(() => {
    const day = (n) => { const date = new Date(); date.setDate(date.getDate() + n); return dateKey(date); };
    const [pantry, fridge] = state.locations;
    state.inventory = [
      { id: 'r2-milk', name: 'Whole milk', quantity: 1.5, unit: 'l', location: fridge, kind: 'Food', expiresOn: day(1), expirationSource: 'package' },
      { id: 'r2-rice', name: 'Basmati rice', quantity: 500, unit: 'g', location: pantry, kind: 'Food', minimum: 1000 },
    ];
    state.plan = [{ id: 'r2-plan', date: day(0), recipeId: state.recipes[0].id, cooked: false }];
    state.shopping = [{ id: 'r2-a', name: 'Butter', quantity: 250, unit: 'g', checked: false }, { id: 'r2-b', name: 'Milk', quantity: 1, unit: 'l', checked: false }];
    render();
  });
  return page;
}

const go = (page, view) => page.evaluate((v) => document.querySelector(`.nav-item[data-view="${v}"]`).click(), view).then(() => pause());

export default async function run({ browser, base }) {
  const fail = [];
  const log = [];

  // 1. No flex gap: neighbours on one line still keep at least 3px apart.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 1280 }, { width: 360, height: 740 }]) {
    const page = await open(browser, base, viewport, 'normal');
    const check = (rows) => page.evaluate((selectors) => {
      document.documentElement.classList.add('no-flex-gap');
      for (const element of document.querySelectorAll('body *')) {
        if (/flex/.test(getComputedStyle(element).display)) { element.style.setProperty('column-gap', '0', 'important'); element.style.setProperty('row-gap', '0', 'important'); }
      }
      const touching = [];
      for (const selector of selectors) {
        for (const container of document.querySelectorAll(selector)) {
          const boxes = [...container.children].map((child) => child.getBoundingClientRect()).filter((box) => box.width > 0 && box.height > 0);
          for (let i = 1; i < boxes.length; i += 1) {
            const [a, b] = [boxes[i - 1], boxes[i]];
            const sameLine = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 4;
            const apart = Math.max(b.left - a.right, a.left - b.right);
            if (sameLine && apart < 3) touching.push(`${selector} (${Math.round(apart)}px)`);
          }
        }
      }
      return [...new Set(touching)];
    }, rows);
    await go(page, 'inventory');
    const inventory = await check(['.stat', '.inventory-heading-actions', '.filter-controls', '.search-field', '.inventory-row', '.storage-zone-heading', '.expiry-item-info']);
    await go(page, 'week');
    const week = await check(['.week-heading-actions', '.week-navigation', '.planned-meal', '.planned-actions']);
    await go(page, 'shopping');
    const shopping = await check(['.shopping-row', '.shopping-heading-actions']);
    const touching = [...inventory, ...week, ...shopping];
    if (touching.length) fail.push(`${viewport.width}px without flex gap, touching: ${touching.join(', ')}`);
    await page.close();
  }

  // 2. All seven days fit the week strip on the tablet, either way round, at every text size.
  for (const viewport of [{ width: 800, height: 1280 }, { width: 1280, height: 800 }]) {
    for (const size of ['small', 'normal', 'large']) {
      const page = await open(browser, base, viewport, size, 'de');
      await go(page, 'week');
      const strip = await page.evaluate(() => { const s = document.querySelector('.week-strip'); const box = s.getBoundingClientRect(); const last = s.querySelector('.day-chip:last-child').getBoundingClientRect(); return { scroll: s.scrollWidth - s.clientWidth, inside: last.right <= box.right + 1 }; });
      if (strip.scroll > 1 || !strip.inside) fail.push(`${viewport.width}x${viewport.height} ${size}: the week strip scrolls (${strip.scroll}px)`);
      await page.close();
    }
  }

  // 3 and 4. Phone: timers above the Undo bar, touch targets of 44px, nothing too wide.
  for (const size of ['normal', 'large']) {
    const page = await open(browser, base, { width: 360, height: 740, isMobile: true, hasTouch: true }, size);
    await go(page, 'inventory');
    const phone = await page.evaluate(async () => {
      const zoom = parseFloat(document.documentElement.style.zoom) || 1;
      const width = (selector) => { const element = document.querySelector(selector); return element ? Math.round(element.getBoundingClientRect().width / zoom) : 0; };
      const sizes = { stepper: width('.inventory-row .quantity-stepper button'), edit: width('.inventory-row .row-edit') };
      startCustomTimer('Pasta', 600);
      withUndo('Removed Whole milk from the fridge', ['inventory'], () => {});
      await new Promise((resolve) => setTimeout(resolve, 200));
      const undo = document.querySelector('#undo-bar').getBoundingClientRect();
      const timer = document.querySelector('#floating-timers .timer-pill').getBoundingClientRect();
      return { ...sizes, overlap: timer.bottom > undo.top + 1, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    log.push(`phone ${size}: ${JSON.stringify(phone)}`);
    if (phone.overlap) fail.push(`phone ${size}: the running timer is under the Undo bar`);
    if (phone.stepper < 44 || phone.edit < 44) fail.push(`phone ${size}: stepper ${phone.stepper}px, ••• ${phone.edit}px wide (want 44)`);
    if (phone.overflow > 1) fail.push(`phone ${size}: the inventory is ${phone.overflow}px too wide`);
    await page.evaluate(() => { hideUndo(); for (const button of document.querySelectorAll('#floating-timers .timer-pill-stop')) button.click(); });
    await page.evaluate(() => openRecipePage(state.recipes[0].id));
    await pause();
    const star = await page.evaluate(() => { const element = document.querySelector('.rating-star'); const zoom = parseFloat(document.documentElement.style.zoom) || 1; return element ? Math.round(element.getBoundingClientRect().width / zoom) : 44; });
    if (star < 44) fail.push(`phone ${size}: rating stars are ${star}px wide`);
    await page.close();
  }

  // 5. Printing on an 800px tablet: the amounts stay inside the page.
  for (const size of ['normal', 'large']) {
    const page = await open(browser, base, { width: 800, height: 1280 }, size);
    await go(page, 'shopping');
    await page.emulateMediaType('print');
    const cut = await page.evaluate(() => {
      const right = document.documentElement.getBoundingClientRect().right;
      return [...document.querySelectorAll('.shopping-amount')].filter((element) => element.getClientRects().length && element.getBoundingClientRect().right > right - 4).map((element) => element.textContent);
    });
    if (cut.length) fail.push(`printed at 800px (${size}): amounts at the very edge: ${cut.join(', ')}`);
    await page.close();
  }

  // 6. Russian loads the Cyrillic faces.
  {
    const page = await open(browser, base, { width: 1280, height: 800 }, 'normal', 'ru');
    await page.evaluate(() => document.fonts.ready);
    const faces = await page.evaluate(() => [...document.fonts].filter((face) => /U\+0?400/i.test(face.unicodeRange) && face.status === 'loaded').map((face) => `${face.family.replace(/"/g, '')} ${face.weight}`));
    log.push(`Cyrillic faces loaded: ${faces.join(', ')}`);
    if (!faces.some((face) => face.startsWith('DM Sans')) || !faces.some((face) => face.startsWith('Fraunces'))) fail.push(`Russian: Cyrillic DM Sans/Fraunces faces not loaded (${faces.join(', ') || 'none'})`);
    await page.close();
  }
  return { fail, log };
}
