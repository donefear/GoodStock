// The household PIN can't be guessed with a burst of parallel logins: the limit is checked after each body arrives,
// so at most five wrong PINs from one address count before everything is 429, the right PIN included.
export default async function run({ base }) {
  const fail = [];
  const log = [];
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if ((await post('/api/auth/pin', { pin: '4821' })).status !== 200) fail.push('could not set a PIN');

  const guesses = Array.from({ length: 300 }, (_, index) => String(1000 + index));
  const statuses = (await Promise.all(guesses.map((pin) => post('/api/auth/login', { pin })))).map((answer) => answer.status);
  const count = (status) => statuses.filter((value) => value === status).length;
  log.push(`300 parallel logins: ${count(401)} × 401, ${count(429)} × 429, ${count(200)} × 200`);
  if (count(401) > 5) fail.push(`${count(401)} wrong PINs were tried in one burst (at most 5)`);
  if (count(429) + count(401) !== 300) fail.push(`unexpected answers: ${[...new Set(statuses)].join(' ')}`);
  const right = await post('/api/auth/login', { pin: '4821' });
  if (right.status !== 429) fail.push(`after the burst the right PIN should wait too (${right.status})`);
  if ((await fetch(`${base}/api/state`)).status !== 401) fail.push('the kitchen is open without the PIN');
  return { fail, log };
}
