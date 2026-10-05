// Goodstock for Windows, macOS and Linux: the web app in its own window, standalone like the phone apps. The web files
// are bundled (desktop/web, copied by prepare.mjs) and served at goodstock://app/, so the page keeps its data in its
// own storage on this computer. preload.js provides window.GoodstockNative; this file answers its calls.
const { app, BrowserWindow, Menu, Notification, ShareMenu, clipboard, dialog, ipcMain, net, powerSaveBlocker, protocol, shell } = require('electron');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { basename, extname, join, normalize, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const native = require('./native');

const WEB_ROOT = join(__dirname, 'web');
const APP_URL = 'goodstock://app/index.html';
const CONTENT_TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

protocol.registerSchemesAsPrivileged([{ scheme: 'goodstock', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setAppUserModelId('com.donefear.goodstock');

let win = null;
let screenBlocker = null;
const timers = new Map();
const reminders = new Map();

const settingsPath = () => join(app.getPath('userData'), 'desktop-settings.json');
async function loadSettings() {
  try { return JSON.parse(await readFile(settingsPath(), 'utf8')); } catch { return {}; }
}
async function saveSettings(settings) {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2));
}

async function serveWebFile(request) {
  const file = normalize(join(WEB_ROOT, decodeURIComponent(new URL(request.url).pathname)));
  if (!file.startsWith(WEB_ROOT + sep)) return new Response('Not found', { status: 404 });
  try {
    const response = await net.fetch(pathToFileURL(file).toString());
    return new Response(response.body, { headers: { 'content-type': CONTENT_TYPES[extname(file)] || 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function callback(id, ok, payload) {
  if (!win || win.isDestroyed()) return;
  const args = JSON.stringify([String(id), Boolean(ok), payload == null ? '' : String(payload)]);
  win.webContents.executeJavaScript(`window.__goodstockNativeCallback && window.__goodstockNativeCallback.apply(null, ${args})`).catch(() => {});
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function showNotification(title, text) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: String(title || 'Goodstock'), body: String(text || ''), silent: false });
  notification.on('click', showWindow);
  notification.show();
}

// Replaces one alarm list. Timers ring in the page itself while it is in front; a notification and a flashing
// taskbar button cover the window being in the background or minimised. Use-soon reminders always notify.
function scheduleAlarms(scheduled, json, timeKey, isTimer) {
  const upcoming = native.upcomingAlarms(json, timeKey);
  if (!upcoming) return;
  for (const handle of scheduled.values()) clearTimeout(handle);
  scheduled.clear();
  for (const alarm of upcoming) {
    scheduled.set(alarm.id, setTimeout(() => {
      scheduled.delete(alarm.id);
      if (isTimer && win && !win.isDestroyed() && win.isFocused()) return;
      showNotification(alarm.title, alarm.text);
      if (isTimer && win && !win.isDestroyed()) win.flashFrame(true);
    }, alarm.delay));
  }
}

async function request(id, options) {
  try {
    let headers = {};
    try { headers = JSON.parse(options.headers || '{}') || {}; } catch { /* No extra headers. */ }
    callback(id, true, JSON.stringify(await native.httpRequest({ ...options, headers })));
  } catch (error) {
    const reason = error && error.name === 'TimeoutError' ? 'The website took too long to answer.' : (error && error.message) || 'Request failed';
    callback(id, false, reason);
  }
}

// The shopping list: macOS has a share menu; on Windows and Linux the list is copied for pasting into a message.
function share(text) {
  if (process.platform === 'darwin' && win) {
    new ShareMenu({ texts: [text] }).popup({ window: win });
    return;
  }
  clipboard.writeText(text);
  const [first, ...rest] = String(text).split('\n');
  showNotification(`📋 ${first}`, rest.join('\n'));
}

async function saveFile(id, name, content) {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: join(app.getPath('documents'), native.safeFileName(name, 'goodstock-backup.json')),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return callback(id, false, 'cancelled');
  try {
    await writeFile(result.filePath, content, 'utf8');
    callback(id, true, 'saved');
  } catch {
    callback(id, false, 'The backup could not be written');
  }
}

async function chooseBackupFolder(id) {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  const folder = !result.canceled && result.filePaths[0];
  if (!folder) return callback(id, false, 'cancelled');
  await saveSettings({ ...(await loadSettings()), backupFolder: folder });
  callback(id, true, basename(folder) || folder);
}

async function writeBackup(id, name, content) {
  const { backupFolder } = await loadSettings();
  if (!backupFolder) return callback(id, false, 'No backup folder chosen');
  try {
    await native.writeBackup(backupFolder, name, content);
    callback(id, true, 'saved');
  } catch (error) {
    callback(id, false, (error && error.message) || 'The backup could not be written');
  }
}

const handlers = {
  setTimers: (json) => scheduleAlarms(timers, json, 'endsAt', true),
  setReminders: (json) => scheduleAlarms(reminders, json, 'at', false),
  notify: (title, text) => showNotification(title, text),
  requestNotifications: (id) => callback(id, true, Notification.isSupported() ? 'granted' : 'denied'),
  keepScreenOn: (on) => {
    if (on && screenBlocker === null) screenBlocker = powerSaveBlocker.start('prevent-display-sleep');
    if (!on && screenBlocker !== null) { powerSaveBlocker.stop(screenBlocker); screenBlocker = null; }
  },
  share,
  fetchPage: (id, url) => request(id, { url }),
  httpRequest: (id, url, headers) => request(id, { url, headers }),
  httpSend: (id, method, url, headers, body) => request(id, { method, url, headers, body }),
  saveFile,
  chooseBackupFolder,
  forgetBackupFolder: async () => { const { backupFolder, ...rest } = await loadSettings(); await saveSettings(rest); },
  writeBackup,
  unsupported: (id) => callback(id, false, 'unsupported'),
};

ipcMain.on('native-info', (event) => { event.returnValue = { notificationsAllowed: Notification.isSupported() }; });
ipcMain.on('native', (event, method, args) => {
  if (!win || event.sender !== win.webContents || !Object.prototype.hasOwnProperty.call(handlers, method)) return;
  Promise.resolve(handlers[method](...(Array.isArray(args) ? args : []))).catch(() => {});
});

// Links to recipe sites, Mealie, DeepL and YouTube open in the normal browser, never inside the app window.
function openOutside(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 500,
    show: false,
    title: 'Goodstock',
    icon: join(WEB_ROOT, 'app-icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => win.flashFrame(false));
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('goodstock://app/')) return;
    event.preventDefault();
    openOutside(url);
  });
  win.loadURL(APP_URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    protocol.handle('goodstock', serveWebFile);
    // macOS expects the usual app, edit and window menus (copy and paste go through the edit menu there).
    Menu.setApplicationMenu(process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
      : null);
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}
