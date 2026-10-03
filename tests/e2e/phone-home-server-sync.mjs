// A phone app connects to the home server, and both stay in step (4.1).
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const names = (page) => page.evaluate(() => state.inventory.map((item) => item.name));
  const add = (page, name) => page.evaluate((n) => { state.inventory.unshift({ id: makeId(), name: n, quantity: 1, unit: '', location: state.locations[0], kind: 'Food' }); persist(); }, name);
  const serverNames = async () => (await (await fetch(`${base}/api/state`)).json()).inventory.map((item) => item.name);

  const server = await browser.newPage();
  await server.goto(base, { waitUntil: 'networkidle2' });
  await add(server, 'Server Milk');
  await wait(800);

  const context = await browser.createBrowserContext();
  const phone = await context.newPage();
  phone.on('dialog', (dialog) => dialog.accept());
  phone.on('pageerror', (error) => fail.push(`phone: ${error.message}`));
  await phone.evaluateOnNewDocument(phoneShim);
  await phone.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  if (!(await phone.evaluate(() => STANDALONE && !isShared()))) fail.push('phone should start on its own');
  await add(phone, 'Phone Bread');
  await phone.evaluate(() => document.querySelector('#settings-button').click());
  await wait(300);
  await phone.evaluate((address) => { document.querySelector('#settings-form').elements.homeServer.value = address; return connectHomeServer(); }, base.replace(/^http:\/\//, ''));
  await wait(1200);
  let phoneItems = await names(phone);
  log.push(`after connect: ${phoneItems.join(', ')}`);
  if (!phoneItems.includes('Server Milk') || !phoneItems.includes('Phone Bread')) fail.push('phone did not get both kitchens');
  if (phoneItems.filter((name) => name === 'Eggs').length > 1) fail.push('sample items were doubled');
  if (!(await serverNames()).includes('Phone Bread')) fail.push('server did not get the phone item');
  await add(phone, 'Phone Eggs');
  await wait(1200);
  if (!(await serverNames()).includes('Phone Eggs')) fail.push('phone change did not reach the server');
  await add(server, 'Server Rice');
  await wait(800);
  await phone.evaluate(() => checkRemoteRevision());
  await wait(1200);
  phoneItems = await names(phone);
  if (!phoneItems.includes('Server Rice')) fail.push('server change did not reach the phone');
  await phone.evaluate(() => disconnectHomeServer());
  if (await phone.evaluate(() => isShared())) fail.push('still shared after disconnecting');
  if (!(await names(phone)).includes('Server Rice')) fail.push('phone lost its copy on disconnect');
  await context.close();
  return { fail, log };
}
