// A summary for Home Assistant and dashboards (0.37): /api/summary, behind the household PIN like the rest.
export default async function run({ base }) {
  const fail = [];
  const log = [];
  const day = (offset) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
  const state = {
    inventory: [
      { id: 'a', name: 'Milk', quantity: 1, unit: 'l', location: 'Fridge', expiresOn: day(1) },
      { id: 'b', name: 'Yoghurt', quantity: 2, unit: '', location: 'Fridge', expiresOn: day(-1) },
      { id: 'c', name: 'Rice', quantity: 1, unit: 'kg', location: 'Pantry', expiresOn: day(200) },
      { id: 'd', name: 'Cream', quantity: 0, unit: '', location: 'Fridge', expiresOn: day(0) },
    ],
    recipes: [{ id: 'r1', name: 'Pea soup', ingredients: [] }, { id: 'r2', name: 'Curry', ingredients: [] }],
    plan: [{ id: 'p1', date: day(0), recipeId: 'r1', cooked: true }, { id: 'p2', date: day(1), recipeId: 'r2', cooked: false }, { id: 'p3', date: day(3), recipeId: 'r2' }],
    shopping: [{ id: 's1', name: 'Bread', quantity: 1, checked: false }, { id: 's2', name: 'Eggs', quantity: 6, checked: true }],
    locations: ['Fridge', 'Pantry'],
  };
  const saved = await fetch(`${base}/api/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, baseRevision: 0, client: 'test' }) });
  if (!saved.ok) fail.push(`could not save the test kitchen: ${saved.status}`);
  const summary = await (await fetch(`${base}/api/summary`)).json();
  log.push(JSON.stringify(summary));
  if (summary.useSoonCount !== 2 || summary.useSoon[0].name !== 'Yoghurt' || summary.useSoon[0].daysLeft !== -1 || summary.useSoon[1].name !== 'Milk') fail.push('use soon: yoghurt (past) then milk; not rice, not the used-up cream');
  if (summary.shoppingCount !== 1 || summary.shopping[0] !== 'Bread') fail.push('shopping: only what is not checked');
  if (summary.today.length !== 1 || summary.today[0].name !== 'Pea soup' || !summary.today[0].cooked) fail.push('today: pea soup, cooked');
  if (summary.tomorrow.length !== 1 || summary.tomorrow[0].name !== 'Curry') fail.push('tomorrow: curry');
  if (!(summary.revision > 0)) fail.push('no revision');

  // With a household PIN: closed without a token, open with the bearer token from /api/auth/login.
  const set = await fetch(`${base}/api/auth/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"pin":"8642"}' });
  if (!set.ok) fail.push('could not set a PIN');
  const closed = (await fetch(`${base}/api/summary`)).status;
  const { token } = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"pin":"8642"}' })).json();
  const open = await fetch(`${base}/api/summary`, { headers: { authorization: `Bearer ${token}` } });
  log.push(`with a PIN: ${closed} without a token, ${open.status} with one`);
  if (closed !== 401 || open.status !== 200) fail.push('the summary should need the PIN token');
  return { fail, log };
}
