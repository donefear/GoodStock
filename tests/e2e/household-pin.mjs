// Household PIN (5.1): set, closed without a session, unlock, phone app with the PIN, remove, rate limit.
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const owner = await browser.newPage();
  owner.on('dialog', (dialog) => dialog.accept());
  await owner.goto(base, { waitUntil: 'networkidle2' });
  await owner.evaluate(() => document.querySelector('#settings-button').click());
  await wait(400);
  await owner.evaluate(() => { document.querySelector('#settings-form').elements.newPin.value = '2468'; return savePin(); });
  const closed = (await fetch(`${base}/api/state`)).status;
  const health = (await fetch(`${base}/api/health`)).status;
  log.push(`without a session: /api/state ${closed}, /api/health ${health}`);
  if (closed !== 401 || health !== 200) fail.push('API not closed without a session');
  await owner.reload({ waitUntil: 'networkidle2' });
  if (await owner.evaluate(() => document.querySelector('#pin-dialog').open)) fail.push('the device that set the PIN was asked for it');

  const guestContext = await browser.createBrowserContext();
  const guest = await guestContext.newPage();
  await guest.goto(base, { waitUntil: 'networkidle2' });
  await wait(500);
  if (!(await guest.evaluate(() => document.querySelector('#pin-dialog').open))) fail.push('a new device was not asked for the PIN');
  await guest.evaluate(() => unlockWithPin('1111'));
  if (!/not right/.test(await guest.evaluate(() => document.querySelector('#pin-error').textContent))) fail.push('wrong PIN not refused');
  await Promise.all([guest.waitForNavigation({ waitUntil: 'networkidle2' }), guest.evaluate(() => unlockWithPin('2468'))]);
  if ((await guest.evaluate(async () => (await fetch('/api/state')).status)) !== 200) fail.push('still locked after the right PIN');
  await guestContext.close();

  const phoneContext = await browser.createBrowserContext();
  const phone = await phoneContext.newPage();
  phone.on('dialog', (dialog) => dialog.accept());
  await phone.evaluateOnNewDocument(phoneShim);
  await phone.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  await phone.evaluate(() => document.querySelector('#settings-button').click());
  await wait(300);
  await phone.evaluate((address) => { document.querySelector('#settings-form').elements.homeServer.value = address; return connectHomeServer(); }, base.replace(/^http:\/\//, ''));
  await wait(500);
  if (!(await phone.evaluate(() => document.querySelector('#pin-dialog').open))) fail.push('phone was not asked for the PIN');
  await phone.evaluate(() => unlockWithPin('2468'));
  await wait(1500);
  const connected = await phone.evaluate(() => ({ shared: isShared(), token: Boolean(localStorage.getItem('goodstock-home-token-v1')) }));
  if (!connected.shared || !connected.token) fail.push('phone did not connect with the PIN');
  await phoneContext.close();

  await owner.evaluate(() => removePin());
  if ((await fetch(`${base}/api/state`)).status !== 200) fail.push('API still closed after removing the PIN');
  // Rate limit last: it blocks this address for a while.
  await owner.evaluate(() => { document.querySelector('#settings-form').elements.newPin.value = '2468'; return savePin(); });
  let status = 0;
  for (let attempt = 0; attempt < 6; attempt++) status = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"pin":"0000"}' })).status;
  if (status !== 429) fail.push(`6th wrong PIN answered ${status}, not 429`);
  return { fail, log };
}
