// Recipe import: recipe data in less common shapes (full schema.org type addresses, steps in an ItemList, objects as
// ingredients), the import and photo proxies refusing this machine and the home network, and the calendar feed
// listing a planned meal's ingredients at its planned servings.
import { extractRecipeFromHtml } from '../../recipe-import.mjs';

export default async function run({ base }) {
  const fail = [];
  const log = [];
  const page = (data) => `<html><script type="application/ld+json">${JSON.stringify(data)}</script></html>`;

  const listed = extractRecipeFromHtml(page({
    '@context': 'https://schema.org', '@type': 'https://schema.org/Recipe', name: 'Stew',
    recipeIngredient: ['1 onion', { '@type': 'PropertyValue', name: 'carrots', value: '2' }, { text: '1 tsp salt' }, {}],
    recipeInstructions: { '@type': 'ItemList', itemListElement: [{ '@type': 'HowToStep', text: 'Chop the onion.' }, { '@type': 'HowToStep', itemListElement: [{ '@type': 'HowToDirection', text: 'Stew it all.' }] }] },
  }));
  log.push(JSON.stringify(listed));
  if (!listed) fail.push('a recipe typed https://schema.org/Recipe was not found');
  else {
    if (listed.instructions.join('|') !== 'Chop the onion.|Stew it all.') fail.push(`steps in an ItemList: ${JSON.stringify(listed.instructions)}`);
    if (listed.ingredients.join('|') !== '1 onion|2 carrots|1 tsp salt') fail.push(`object ingredients: ${JSON.stringify(listed.ingredients)}`);
  }
  if (!extractRecipeFromHtml(page({ '@type': ['http://schema.org/Recipe'], name: 'Pie', recipeIngredient: ['1 egg'] }))) fail.push('http://schema.org/Recipe was not found');

  // The server fetches only public addresses (its own port on this machine is allowed: the app's own files).
  for (const target of ['http://10.0.0.1/', 'http://192.168.1.1/recipe', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:9/', 'http://127.0.0.1:9/', 'http://0.0.0.0:9/', 'http://localhost:9/']) {
    for (const route of ['/api/recipes/import', '/api/photo']) {
      const answer = await fetch(`${base}${route}?url=${encodeURIComponent(target)}`);
      if (answer.status !== 400) fail.push(`${route} for ${target}: ${answer.status} (should be refused)`);
    }
  }
  const own = await fetch(`${base}/api/photo?url=${encodeURIComponent(`${base}/icon-192.png`)}`);
  if (own.status !== 200) fail.push(`the app's own photo could not be fetched (${own.status})`);

  // Calendar: a meal planned at twice the recipe.
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const state = { inventory: [], recipes: [{ id: 'r1', name: 'Soup', ingredients: ['2–3 cloves garlic', '½ cup cream', '1,5 l stock', 'salt'] }], plan: [{ id: 'p1', date, recipeId: 'r1', scale: 2 }] };
  await fetch(`${base}/api/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) });
  const { token } = await fetch(`${base}/api/calendar`, { method: 'POST' }).then((answer) => answer.json());
  const feed = (await fetch(`${base}/api/plan.ics?token=${token}`).then((answer) => answer.text())).replace(/\r\n /g, '');
  const description = (/DESCRIPTION:(.*)/.exec(feed) || [])[1] || '';
  log.push(description);
  if (description !== '4–6 cloves garlic\\n1 cup cream\\n3 l stock\\nsalt') fail.push(`calendar ingredients not scaled: ${description}`);
  return { fail, log };
}
