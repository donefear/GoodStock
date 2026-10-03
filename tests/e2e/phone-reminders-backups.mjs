// Phone apps: use-soon reminders scheduled ahead (4.3) and automatic weekly backups (4.9).
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.evaluateOnNewDocument(phoneShim);
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });

  const reminders = await page.evaluate(() => {
    const inDays = (n) => { const day = new Date(); day.setDate(day.getDate() + n); return dateKey(day); };
    state.inventory = [
      { id: 'a', name: 'Milk', quantity: 1, unit: 'l', location: 'Fridge', kind: 'Food', expiresOn: inDays(1) },
      { id: 'b', name: 'Cheese', quantity: 1, unit: '', location: 'Fridge', kind: 'Food', expiresOn: inDays(6) },
    ];
    localStorage.setItem('goodstock-expiry-reminders-v1', 'true');
    scheduleExpiryReminders();
    const on = window.__reminders;
    localStorage.removeItem('goodstock-expiry-reminders-v1');
    scheduleExpiryReminders();
    return { on, off: window.__reminders };
  });
  log.push(...reminders.on.map((reminder) => `${new Date(reminder.at).toISOString().slice(0, 16)} ${reminder.title}: ${reminder.text}`));
  if (!reminders.on.length || reminders.on.some((reminder) => new Date(reminder.at).getHours() !== 9)) fail.push('reminders not scheduled at 9:00');
  if (!/Cheese/.test(reminders.on[reminders.on.length - 1].text)) fail.push('later mornings should include items due by then');
  if (reminders.off.length) fail.push('turning reminders off did not cancel them');

  await page.evaluate(() => document.querySelector('#settings-button').click());
  await wait(300);
  if (await page.evaluate(() => document.querySelector('#auto-backup-zone').hidden)) fail.push('automatic backup hidden in the phone app');
  await page.evaluate(() => document.querySelector('#auto-backup-folder').click());
  await wait(400);
  let writes = await page.evaluate(() => window.__writes || []);
  if (writes.length !== 1 || !/^goodstock-auto-backup-\d{4}-\d{2}-\d{2}\.json$/.test(writes[0][0])) fail.push('first backup not written straight away');
  await page.evaluate(() => runAutoBackup());
  await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('goodstock-auto-backup-v1')); saved.last = new Date(Date.now() - 8 * 86400000).toISOString(); localStorage.setItem('goodstock-auto-backup-v1', JSON.stringify(saved)); return runAutoBackup(); });
  await wait(300);
  writes = await page.evaluate(() => window.__writes || []);
  if (writes.length !== 2) fail.push(`expected 2 backups after a week, got ${writes.length}`);
  await page.evaluate(() => document.querySelector('#auto-backup-off').click());
  if (!(await page.evaluate(() => window.__forgotFolder && !localStorage.getItem('goodstock-auto-backup-v1')))) fail.push('turning off did not forget the folder');
  return { fail, log };
}
