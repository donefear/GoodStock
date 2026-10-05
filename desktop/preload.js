// window.GoodstockNative for the desktop app: the same methods as the phone apps' bridges (android/…/NativeBridge.java,
// ios/Goodstock/NativeBridge.swift). Calls go to main.js; answers come back through window.__goodstockNativeCallback.
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('native-info');
const send = (method, ...args) => ipcRenderer.send('native', method, args.map((value) => (typeof value === 'boolean' ? value : String(value == null ? '' : value))));

contextBridge.exposeInMainWorld('GoodstockNative', {
  platform: 'desktop',
  setTimers: (json) => send('setTimers', json),
  setReminders: (json) => send('setReminders', json),
  notify: (title, text) => send('notify', title, text),
  notificationsAllowed: () => info.notificationsAllowed,
  requestNotifications: (id) => send('requestNotifications', id),
  keepScreenOn: (on) => send('keepScreenOn', Boolean(on)),
  vibrate: () => {},
  share: (text) => send('share', text),
  fetchPage: (id, url) => send('fetchPage', id, url),
  httpRequest: (id, url, headers) => send('httpRequest', id, url, headers || '{}'),
  httpSend: (id, method, url, headers, body) => send('httpSend', id, method, url, headers || '{}', body),
  saveFile: (id, name, content) => send('saveFile', id, name, content),
  // A computer has no barcode camera scanner; barcodes can still be typed in.
  canScanBarcodes: () => false,
  scanBarcode: (id) => send('unsupported', id),
  canAutoBackup: () => true,
  chooseBackupFolder: (id) => send('chooseBackupFolder', id),
  forgetBackupFolder: () => send('forgetBackupFolder'),
  writeBackup: (id, name, content) => send('writeBackup', id, name, content),
});
