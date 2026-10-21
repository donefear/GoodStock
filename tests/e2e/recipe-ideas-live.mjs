// Recipe ideas against the real TheMealDB, through the server (needs internet; skipped without).
export default async function run({ browser, base }) {
  const fail = [];
  const log = [];
  const online = await fetch('https://www.themealdb.com/api/json/v1/1/filter.php?i=chicken', { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false);
  if (!online) return { fail, log, skip: 'no internet for TheMealDB' };
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    state.plan = [{ id: 'p1', date: dateKey(new Date()), recipeId: 'crispy-potatoes', cooked: true }];
    activeView = 'recipes';
    render();
  });
  await page.evaluate(() => document.querySelector('[data-action="find-ideas"]').click());
  await page.waitForFunction(() => !ideas.loading && ideas.searched, { timeout: 60000 });
  const result = await page.evaluate(() => ({ error: ideas.error, ideas: ideas.results.map((idea) => `${idea.recipe.name} — ${idea.reasons.join('; ')}`), cards: document.querySelectorAll('.idea-card').length }));
  log.push(...result.ideas);
  if (result.error) fail.push(result.error);
  if (!result.ideas.length || result.cards !== result.ideas.length) fail.push('no ideas shown');
  return { fail, log };
}
