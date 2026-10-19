// Desktop app (0.35): while hosting, the page sends the tray's words in its language, and "Start with the computer"
// is offered (Windows and macOS) and turned off again when hosting stops. The tray itself is Electron (main.js).
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const desktop = (withLogin) => `${phoneShim}
    GoodstockNative.platform = 'desktop';
    GoodstockNative.canHostKitchen = function () { return true; };
    GoodstockNative.startKitchenHost = function (id) { answer(id, true, JSON.stringify({ port: 8486, addresses: ['192.168.1.20'], pin: '123456', token: 'secret' })); };
    GoodstockNative.stopKitchenHost = function () { window.__stopped = true; };
    GoodstockNative.setTrayLabels = function (json) { window.__tray = JSON.parse(json); };
    ${withLogin ? "GoodstockNative.setStartAtLogin = function (on) { window.__login = (window.__login || []).concat([on]); };" : ''}`;

  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.evaluateOnNewDocument(desktop(true));
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  const started = await page.evaluate(async () => {
    await setLanguage('nl');
    await startHosting();
    document.querySelector('#settings-button').click();
    showSettingsTab('connections');
    fillHostSettings();
    const box = document.querySelector('#host-start-at-login');
    if (box) box.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { tray: window.__tray, box: Boolean(box), login: window.__login, saved: localStorage.getItem('goodstock-start-at-login-v1') };
  });
  log.push(JSON.stringify(started));
  if (!started.tray || !started.tray.quit || started.tray.quit === 'Stop sharing and quit') fail.push('tray words not sent in the app language (Dutch)');
  if (!started.box) fail.push('no "Start with the computer" option while hosting');
  if (!started.login || started.login[0] !== true || started.saved !== 'true') fail.push('ticking it did not turn starting with the computer on');
  const stopped = await page.evaluate(async () => {
    endHosting();
    await setLanguage('en');
    return { login: window.__login, saved: localStorage.getItem('goodstock-start-at-login-v1'), stopped: window.__stopped };
  });
  if (!stopped.stopped || stopped.login[stopped.login.length - 1] !== false || stopped.saved) fail.push('stopping hosting should turn starting with the computer off');
  await page.close();

  // Linux: no login item, so no option.
  const linux = await browser.newPage();
  await linux.evaluateOnNewDocument(desktop(false));
  await linux.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  const offered = await linux.evaluate(async () => {
    await startHosting();
    document.querySelector('#settings-button').click();
    fillHostSettings();
    return Boolean(document.querySelector('#host-start-at-login'));
  });
  if (offered) fail.push('"Start with the computer" offered without setStartAtLogin (Linux)');
  await linux.close();
  return { fail, log };
}
