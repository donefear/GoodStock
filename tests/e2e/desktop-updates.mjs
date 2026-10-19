// Desktop app: the daily update check against GitHub releases (0.25), with GitHub's answer faked.
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const desktop = `${phoneShim}
    window.GoodstockNative.platform = 'desktop';
    window.__updateUrls = [];
    var phoneHttpRequest = window.GoodstockNative.httpRequest;
    window.GoodstockNative.httpRequest = function (id, url, headers) {
      if (url.indexOf('https://api.github.com/') !== 0) return phoneHttpRequest(id, url, headers);
      window.__updateUrls.push(url);
      var tag = sessionStorage.getItem('latest-tag') || 'v99.0.0';
      answer(id, true, JSON.stringify({ status: 200, url: url, body: JSON.stringify({ tag_name: tag }) }));
    };`;
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.evaluateOnNewDocument(desktop);
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  await wait(300);

  const versions = await page.evaluate(() => [isNewerVersion('3.3.0', '3.2.15'), isNewerVersion('3.2.15', '3.2.15'), isNewerVersion('3.2.9', '3.2.15'), isNewerVersion('4.0.0', '3.10.2'), appVersion()]);
  log.push(`app version ${versions[4]}`);
  if (versions.slice(0, 4).join() !== 'true,false,false,true') fail.push(`version comparison wrong: ${versions.slice(0, 4)}`);
  if (!/^\d+\.\d+\.\d+$/.test(versions[4])) fail.push('app version not read from the label');

  const first = await page.evaluate(() => ({ urls: window.__updateUrls, dot: document.querySelector('#settings-button').classList.contains('has-update') }));
  if (first.urls.length !== 1 || !/releases\/latest$/.test(first.urls[0])) fail.push(`expected one check on start, got ${JSON.stringify(first.urls)}`);
  if (!first.dot) fail.push('no dot on the Settings button for a newer version');

  await page.evaluate(() => { document.querySelector('#settings-button').click(); showSettingsTab('data'); });
  await wait(200);
  const shown = await page.evaluate(() => ({ hidden: document.querySelector('#updates-zone').hidden, text: document.querySelector('#updates-text').textContent, download: !document.querySelector('#updates-download').hidden }));
  log.push(shown.text);
  if (shown.hidden) fail.push('Updates hidden in the desktop app');
  if (!/v99\.0\.0/.test(shown.text) || !shown.download) fail.push('newer version not offered for download');

  await page.reload({ waitUntil: 'networkidle2' });
  await wait(300);
  if ((await page.evaluate(() => window.__updateUrls.length)) !== 0) fail.push('checked again within a day');

  const current = await page.evaluate(() => appVersion());
  await page.evaluate((tag) => { sessionStorage.setItem('latest-tag', tag); document.querySelector('#settings-button').click(); showSettingsTab('data'); }, `v${current}`);
  await page.evaluate(() => document.querySelector('[data-action="updates-check"]').click());
  await wait(300);
  const upToDate = await page.evaluate(() => ({ text: document.querySelector('#updates-text').textContent, download: !document.querySelector('#updates-download').hidden, dot: document.querySelector('#settings-button').classList.contains('has-update') }));
  log.push(upToDate.text);
  if (!/^Up to date/.test(upToDate.text) || upToDate.download || upToDate.dot) fail.push('Check now did not show "up to date"');

  await page.evaluate(() => document.querySelector('#updates-daily').click());
  if (await page.evaluate(() => updateSettings().daily)) fail.push('turning the daily check off was not saved');
  await page.close();

  // The browser and the phone apps don't show it.
  for (const shim of ['', phoneShim]) {
    const other = await browser.newPage();
    if (shim) await other.evaluateOnNewDocument(shim);
    await other.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
    await other.evaluate(() => document.querySelector('#settings-button').click());
    await wait(200);
    if (!(await other.evaluate(() => document.querySelector('#updates-zone').hidden))) fail.push(`Updates shown in the ${shim ? 'phone app' : 'browser'}`);
    await other.close();
  }
  return { fail, log };
}
