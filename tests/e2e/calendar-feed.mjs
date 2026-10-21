// The meal plan as a calendar feed (0.53): Settings → Connections makes a secret link to /api/plan.ics. The link works
// without the household PIN, a wrong or old token gets nothing, the events are all-day meals with their ingredients,
// and "Stop the link" turns it off.
export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // A meal for tomorrow with a comma, a semicolon and a long name, to check escaping and line folding.
  await page.evaluate(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    state.recipes.push({ id: 'cal-1', name: 'Soup; tomatoes, beans and a very long name that needs folding in the calendar file', ingredients: ['1 onion', '2 cans tomatoes'] });
    state.plan.push({ id: 'cal-plan', date: dateKey(tomorrow), recipeId: 'cal-1', cooked: false });
    persist();
  });
  await wait(600);

  if ((await fetch(`${base}/api/plan.ics?token=nothing`)).status !== 404) fail.push('a feed without a link should not exist');
  await page.evaluate(() => { document.querySelector('#settings-button').click(); showSettingsTab('connections'); });
  await wait(200);
  if ((await page.$eval('#calendar-note', (element) => element.textContent)) !== 'Off') fail.push('the calendar link should start off');
  await page.evaluate(() => document.querySelector('[data-action="calendar-make"]').click());
  await wait(300);
  const link = await page.$eval('#calendar-link', (element) => element.value);
  log.push(link.replace(/token=.*/, 'token=…'));
  if (!/\/api\/plan\.ics\?token=[\w-]{20,}$/.test(link)) fail.push(`no calendar link shown: ${link}`);

  // Calendar apps can't log in: set a household PIN and fetch without one.
  await page.evaluate(() => fetch('api/auth/pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '4321' }) }));
  const feed = await fetch(link);
  const text = await feed.text();
  log.push(`${feed.status} ${feed.headers.get('content-type')}`);
  if (feed.status !== 200 || !/text\/calendar/.test(feed.headers.get('content-type'))) fail.push(`the feed did not answer with a calendar: ${feed.status}`);
  if (!/^BEGIN:VCALENDAR\r\n/.test(text) || !/END:VCALENDAR\r\n$/.test(text)) fail.push('not an iCalendar file');
  const unfolded = text.replace(/\r\n /g, '');
  if (!/SUMMARY:Soup\\; tomatoes\\, beans and a very long name that needs folding in the calendar file/.test(unfolded)) fail.push('the summary is not escaped and folded right');
  if (!/DTSTART;VALUE=DATE:\d{8}/.test(text) || !/DESCRIPTION:1 onion\\n2 cans tomatoes/.test(unfolded)) fail.push('the event has no all-day date or ingredients');
  if (text.split('\r\n').some((line) => Buffer.byteLength(line) > 75)) fail.push('a line is longer than 75 bytes');
  if ((await fetch(`${base}/api/state`)).status !== 401) fail.push('the PIN should still guard the rest');

  // A new link replaces the old one; stopping turns it off.
  const pinCookie = await page.evaluate(() => fetch('api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '4321' }) }).then((response) => response.ok));
  if (!pinCookie) fail.push('could not log in with the PIN');
  await page.evaluate(() => document.querySelector('[data-action="calendar-make"]').click());
  await wait(300);
  const second = await page.$eval('#calendar-link', (element) => element.value);
  if ((await fetch(link)).status !== 404) fail.push('the old link still works after a new one was made');
  if ((await fetch(second)).status !== 200) fail.push('the new link does not work');
  await page.evaluate(() => document.querySelector('[data-action="calendar-stop"]').click());
  await wait(300);
  if ((await fetch(second)).status !== 404) fail.push('"Stop the link" did not stop it');
  await page.evaluate(() => fetch('api/auth/pin', { method: 'DELETE' }));
  await page.close();
  return { fail, log };
}
