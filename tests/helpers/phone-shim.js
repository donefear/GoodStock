// Stand-in for window.GoodstockNative (the phone apps' bridge), for tests. Web requests are real fetches, so a phone
// "connected" to the test server really talks to it. Other features record what the page asked for in window.__calls.
window.__calls = [];
function answer(id, ok, payload) { setTimeout(function () { window.__goodstockNativeCallback(id, ok, payload); }, 5); }
function http(id, method, url, headers, body) {
  fetch(url, { method: method, headers: JSON.parse(headers || '{}'), body: body || undefined })
    .then(function (r) { return r.text().then(function (text) { answer(id, true, JSON.stringify({ status: r.status, url: url, body: text })); }); })
    .catch(function (e) { answer(id, false, String(e)); });
}
window.GoodstockNative = {
  platform: 'test',
  setTimers: function (json) { window.__calls.push(['setTimers', json]); },
  setReminders: function (json) { window.__reminders = JSON.parse(json); },
  notify: function (title, text) { window.__calls.push(['notify', title, text]); },
  notificationsAllowed: function () { return true; },
  requestNotifications: function (id) { answer(id, true, 'granted'); },
  keepScreenOn: function (on) { window.__calls.push(['keepScreenOn', on]); },
  vibrate: function () {},
  share: function (text) { window.__calls.push(['share', text]); },
  print: function () { window.__calls.push(['print']); },
  fetchPage: function (id, url) { http(id, 'GET', url, '{}', ''); },
  fetchImage: function (id, url) { window.__images = (window.__images || []).concat([url]); if (/fail/.test(url)) answer(id, false, 'That photo could not be loaded.'); else answer(id, true, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='); },
  httpRequest: function (id, url, headers) { http(id, 'GET', url, headers, ''); },
  httpSend: function (id, method, url, headers, body) { http(id, method, url, headers, body); },
  saveFile: function (id, name, content) { window.__calls.push(['saveFile', name, content.length]); answer(id, true, 'saved'); },
  canScanBarcodes: function () { return true; },
  scanBarcode: function (id) { answer(id, true, window.__nextBarcode || '3017620422003'); },
  canSpeak: function () { return false; },
  canAutoBackup: function () { return true; },
  chooseBackupFolder: function (id) { answer(id, true, 'Goodstock backups'); },
  forgetBackupFolder: function () { window.__forgotFolder = true; },
  writeBackup: function (id, name, content) { (window.__writes = window.__writes || []).push([name, JSON.parse(content).state.inventory.length]); answer(id, true, 'saved'); },
  // The shared folder lives in window.__folder ({ name: { content, modified } }); a test copies files between
  // phones the way a folder-sync app would.
  canSyncFolder: function () { return true; },
  chooseSyncFolder: function (id) { window.__folder = window.__folder || {}; answer(id, true, 'Kitchen sync'); },
  forgetSyncFolder: function () { window.__folder = null; },
  listSyncFolder: function (id) {
    var folder = window.__folder || {};
    answer(id, true, JSON.stringify(Object.keys(folder).map(function (name) { return { name: name, modified: folder[name].modified, size: folder[name].content.length }; })));
  },
  readSyncFile: function (id, name) { var file = (window.__folder || {})[name]; if (file) answer(id, true, file.content); else answer(id, false, 'File not found'); },
  writeSyncFile: function (id, name, content) { window.__folder[name] = { content: content, modified: Date.now() }; answer(id, true, 'saved'); }
};
