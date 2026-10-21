// Goodstock, part 2 of 6: the shared kitchen: phone apps on a home server, the household PIN, and syncing with
// the server (revisions, merging, live events and polling).
// The parts load in order as plain scripts (see index.html) and share one global scope.

// The phone apps can share the kitchen with a Goodstock server at home (Settings → Home server). Their requests then
// go through the phone (the native bridge), which is not limited by CORS or by plain http, like Mealie and DeepL.
const HOME_SERVER_KEY = 'goodstock-home-server-v1';

function homeServer() {
  if (!STANDALONE) return '';
  try { return localStorage.getItem(HOME_SERVER_KEY) || ''; } catch { return ''; }
}

// Household PIN. When the server answers "PIN required", the unlock dialog opens. Browsers then get a session
// cookie and reload; a phone app keeps the token it gets and sends it with every request to the home server.
const HOME_TOKEN_KEY = 'goodstock-home-token-v1';
const homeToken = () => { try { return localStorage.getItem(HOME_TOKEN_KEY) || ''; } catch { return ''; } };
let pinPrompted = false;
let pendingHomeServer = '';
const plainFetch = window.fetch.bind(window);

function askForPin(address = '') {
  if (address) pendingHomeServer = address;
  if (pinPrompted) return;
  pinPrompted = true;
  const form = $('#pin-form');
  form.reset();
  $('#pin-error').textContent = '';
  $('#pin-dialog').showModal();
  form.elements.pin.focus();
}

// Every kitchen API call in the browser goes through fetch; a "PIN required" answer opens the dialog.
if (!STANDALONE) {
  window.fetch = async (input, init) => {
    const response = await plainFetch(input, init);
    const address = String((input && input.url) || input);
    if (response.status === 401 && /\/api\//.test(address) && !/\/api\/auth\//.test(address)) {
      response.clone().json().then((body) => { if (body && body.code === 'pin') askForPin(); }).catch(() => {});
    }
    return response;
  };
}

async function unlockWithPin(pin) {
  const error = $('#pin-error');
  error.textContent = '';
  let status = 0;
  let body = {};
  try {
    if (STANDALONE) {
      const answer = JSON.parse(await nativeCall('httpSend', 'POST', `${pendingHomeServer || homeServer()}/api/auth/login`, JSON.stringify({ 'content-type': 'application/json', accept: 'application/json' }), JSON.stringify({ pin })));
      status = answer.status;
      body = JSON.parse(answer.body || '{}');
    } else {
      const response = await plainFetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
      status = response.status;
      body = await response.json().catch(() => ({}));
    }
  } catch {
    error.textContent = t('Could not reach the app server.');
    return;
  }
  if (status !== 200) {
    error.textContent = status === 429 ? t('Too many wrong PINs. Try again in a few minutes.') : t('That PIN is not right.');
    return;
  }
  if (!STANDALONE) { location.reload(); return; }
  localStorage.setItem(HOME_TOKEN_KEY, body.token || '');
  $('#pin-dialog').close();
  pinPrompted = false;
  if (pendingHomeServer && !homeServer()) {
    const address = pendingHomeServer;
    pendingHomeServer = '';
    $('#settings-form').elements.homeServer.value = address;
    await connectHomeServer();
    return;
  }
  pendingHomeServer = '';
  checkRemoteRevision();
  pushPendingState();
}

// Settings → Household PIN (server version).
async function fillPinSettings() {
  if (STANDALONE) return;
  const note = $('#pin-note');
  try {
    const status = await (await plainFetch('/api/auth/status', { cache: 'no-store' })).json();
    note.textContent = status.required ? t('PIN is on. Each new device asks for it once.') : t('No PIN. Anyone on your home network can open this kitchen.');
    note.className = `settings-note${status.required ? ' is-connected' : ''}`;
    $('#pin-save').textContent = status.required ? t('Change PIN') : t('Set PIN');
    $('#pin-remove').hidden = !status.required;
  } catch {
    note.textContent = t('PIN settings are unavailable while offline.');
  }
}

async function savePin() {
  const input = $('#settings-form').elements.newPin;
  const pin = input.value;
  const note = $('#pin-note');
  if (pin.length < 4) { note.textContent = t('Use a PIN of 4 to 32 characters.'); note.className = 'settings-note is-error'; input.focus(); return; }
  const response = await plainFetch('/api/auth/pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) }).catch(() => null);
  input.value = '';
  if (!response || !response.ok) { note.textContent = t('Could not save the PIN.'); note.className = 'settings-note is-error'; return; }
  await fillPinSettings();
  note.textContent = t('PIN saved. Other devices ask for it once.');
}

async function removePin() {
  if (!window.confirm(t('Remove the household PIN? Anyone on your home network can then open this kitchen.'))) return;
  await plainFetch('/api/auth/pin', { method: 'DELETE' }).catch(() => null);
  await fillPinSettings();
}

// True when this device takes part in a shared kitchen: the server version always, a phone app once connected.
const isShared = () => !STANDALONE || Boolean(homeServer());

async function kitchenRequest(path, { method = 'GET', body = null } = {}) {
  if (!STANDALONE) {
    const response = await fetch(path, {
      method, cache: 'no-store',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, ok: response.ok, json: () => response.json() };
  }
  const token = homeToken();
  const headers = JSON.stringify({ 'content-type': 'application/json', accept: 'application/json', 'x-goodstock-client': CLIENT_ID, ...(token ? { authorization: `Bearer ${token}` } : {}) });
  const answer = JSON.parse(body
    ? await nativeCall('httpSend', method, `${homeServer()}${path}`, headers, JSON.stringify(body))
    : await nativeCall('httpRequest', `${homeServer()}${path}`, headers));
  if (answer.status === 401 && /"code"\s*:\s*"pin"/.test(answer.body || '')) askForPin();
  return { status: answer.status, ok: answer.status >= 200 && answer.status < 300, json: async () => JSON.parse(answer.body || 'null') };
}

function updateSyncStatus(mode, detail) {
  const dot = $('#sync-dot');
  const label = $('#sync-label');
  const text = $('#sync-detail');
  if (!isShared() && folderSync()) {
    const settings = folderSync();
    dot.className = `sync-dot ${settings.error ? 'pending' : 'online'}`;
    label.textContent = t('Shared folder');
    text.textContent = detail || (settings.error
      ? t('Folder not reachable · will try again')
      : tp(Object.keys(readFolderBases()).length, 'In step with {count} other device', 'In step with {count} other devices'));
    return;
  }
  if (!isShared()) {
    dot.className = 'sync-dot online';
    label.textContent = t('Saved on this phone');
    text.textContent = t('Back up in Settings');
    return;
  }
  dot.className = `sync-dot ${mode}`;
  label.textContent = mode === 'offline' ? t('Working offline') : mode === 'pending' ? t('Changes queued') : t('Shared kitchen, in sync');
  const live = STANDALONE
    ? (hosting()
      ? tp(liveSync.devices, 'Hosting · {count} other device connected', 'Hosting · {count} other devices connected')
      : t('Home server · {address}', { address: homeServer().replace(/^https?:\/\//, '') }))
    : liveSync.connected
      ? (liveSync.devices > 1 ? tp(liveSync.devices, 'Live · {count} device connected', 'Live · {count} devices connected') : t('Live · only this device right now'))
      : t('Synced with the server');
  text.textContent = detail || (mode === 'offline' ? t('Will sync when reconnected') : live);
}

// Sends this device's changes, saying which server revision they build on. If another device saved first, the
// server answers 409 with its kitchen; merge into it and send again. Failures retry after a pause.
async function pushPendingState() {
  if (!isShared() || syncing || !navigator.onLine) return;
  const pending = localStorage.getItem(PENDING_KEY);
  if (!pending) return;
  syncing = true;
  clearTimeout(retryTimer);
  updateSyncStatus('pending', t('Sending changes'));
  let again = false;
  try {
    const response = await kitchenRequest('/api/state', {
      method: 'POST',
      body: { state: JSON.parse(pending), baseRevision: readSyncBase()?.revision || 0, client: CLIENT_ID },
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 409 && result.state) {
      applyRemoteKitchen({ revision: result.revision, state: result.state });
      again = true;
    } else if (!response.ok) {
      throw new Error('Save failed');
    } else {
      writeSyncBase({ revision: result.revision, state: JSON.parse(pending) });
      if (localStorage.getItem(PENDING_KEY) === pending) localStorage.removeItem(PENDING_KEY);
      else again = true;
      showSyncStatus();
    }
  } catch {
    updateSyncStatus('pending', t('Will retry in a moment'));
    retryTimer = setTimeout(pushPendingState, 5000);
  } finally {
    syncing = false;
    if (again && navigator.onLine) queueMicrotask(pushPendingState);
    if (pullAfterSync) { pullAfterSync = false; pullRemoteKitchen(); }
  }
}

function persist() {
  restockStaples();
  const snapshot = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, snapshot);
  if (isShared()) localStorage.setItem(PENDING_KEY, snapshot);
  render();
  checkExpiryReminders();
  pushPendingState();
  syncFolderSoon();
}

// Shared kitchen sync (the server version, and phone apps connected to a home server).
// The server keeps one kitchen with a revision number. This page remembers the last revision it saw ("base"), sends
// its changes with that revision, and when someone else saved first it merges item by item and sends again. A live
// event stream tells it about other devices' saves straight away, so every open page stays in step.
const SYNC_BASE_KEY = 'goodstock-synced-v1';
const CLIENT_ID = makeId();
const liveSync = { connected: false, devices: 0 };
let pullAfterSync = false;
let retryTimer = null;
let renderDeferred = false;

function readSyncBase() {
  try { return JSON.parse(localStorage.getItem(SYNC_BASE_KEY) || 'null'); } catch { return null; }
}

function writeSyncBase(base) {
  try { localStorage.setItem(SYNC_BASE_KEY, JSON.stringify(base)); } catch { /* Merging then treats everything as changed. */ }
}

async function fetchRemoteKitchen() {
  const response = await kitchenRequest('/api/state');
  if (!response.ok) throw new Error('Kitchen unavailable');
  const body = await response.json();
  if (!body) return { revision: 0, state: null };
  const { _revision: revision, ...remoteState } = body;
  return { revision: Number(revision) || 0, state: remoteState };
}

// A short fingerprint of a text, so a merge base can be kept as one small stamp per item instead of a full copy.
function stamp(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

const MERGED_LISTS = ['inventory', 'recipes', 'plan', 'shopping', 'timerPresets', 'log', 'checks', 'shelfLife', 'prices'];
const itemStamp = (item) => stamp(String(JSON.stringify(item)));

// A kitchen as fingerprints ({ inventory: { id: stamp }, …, locations: stamp }): all that mergeStates needs of a base.
function fingerprintState(value) {
  const prints = { locations: itemStamp(value?.locations), shopOrder: itemStamp(value?.shopOrder) };
  for (const key of MERGED_LISTS) {
    prints[key] = {};
    for (const item of value?.[key] || []) if (item && item.id != null) prints[key][String(item.id)] = itemStamp(item);
  }
  return prints;
}

// Three-way merge of lists of items with an id: changes made here since the last sync win over the server's copy,
// everything else takes the server's version. A delete does not beat an edit made elsewhere. The base is the list
// itself, or its fingerprints ({ id: stamp }, see fingerprintState).
function mergeById(base = [], local = [], remote = []) {
  const idOf = (item) => (item && item.id != null ? String(item.id) : null);
  const print = Array.isArray(base) ? (item) => JSON.stringify(item) : itemStamp;
  const baseById = Array.isArray(base) ? new Map(base.map((item) => [idOf(item), print(item)])) : new Map(Object.entries(base || {}));
  const localById = new Map(local.map((item) => [idOf(item), item]));
  const remoteById = new Map(remote.map((item) => [idOf(item), item]));
  const changed = (item, id) => (item ? !baseById.has(id) || print(item) !== baseById.get(id) : baseById.has(id));
  const pick = (id) => {
    const mine = localById.get(id);
    const theirs = remoteById.get(id);
    const mineChanged = changed(mine, id);
    const theirsChanged = changed(theirs, id);
    if (mineChanged && !theirsChanged) return mine;
    if (theirsChanged && !mineChanged) return theirs;
    if (mineChanged && theirsChanged) return mine || theirs;
    return theirs || mine;
  };
  // Items new on this device go first (new things are added at the top), then the server's order.
  const newHere = local.filter((item) => idOf(item) && !remoteById.has(idOf(item)) && !baseById.has(idOf(item)));
  const rest = remote.map((item) => pick(idOf(item))).filter(Boolean);
  const deletedElsewhereButEditedHere = local.filter((item) => {
    const id = idOf(item);
    return id && !remoteById.has(id) && baseById.has(id) && changed(item, id);
  });
  return [...newHere, ...rest, ...deletedElsewhereButEditedHere];
}

function mergeStates(base, local, remote) {
  const merged = { ...remote };
  for (const key of MERGED_LISTS) {
    merged[key] = mergeById(base?.[key] || [], local?.[key] || [], remote?.[key] || []);
  }
  const localChangedLocations = typeof base?.locations === 'string'
    ? itemStamp(local?.locations) !== base.locations
    : JSON.stringify(local?.locations) !== JSON.stringify(base?.locations);
  merged.locations = localChangedLocations ? local.locations : remote.locations;
  // The learned shop order (0.50): one whole value, like the locations; a change made here since the last sync wins.
  const localChangedShopOrder = typeof base?.shopOrder === 'string'
    ? itemStamp(local?.shopOrder) !== base.shopOrder
    : JSON.stringify(local?.shopOrder) !== JSON.stringify(base?.shopOrder);
  const shopOrder = localChangedShopOrder ? local?.shopOrder : remote?.shopOrder;
  if (shopOrder) merged.shopOrder = shopOrder; else delete merged.shopOrder;
  return merged;
}

// Redraw after a sync, but not while someone is typing in the page; wait until they leave the field.
function renderWhenIdle() {
  const active = document.activeElement;
  if (active && active.closest && active.closest('#view-container') && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
    if (!renderDeferred) {
      renderDeferred = true;
      active.addEventListener('blur', () => { renderDeferred = false; render(); }, { once: true });
    }
    return;
  }
  render();
}

function applyRemoteKitchen(remote) {
  const hasLocalChanges = Boolean(localStorage.getItem(PENDING_KEY));
  state = normalizeState(hasLocalChanges ? mergeStates(readSyncBase()?.state, state, remote.state) : remote.state);
  writeSyncBase(remote);
  const snapshot = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, snapshot);
  if (hasLocalChanges) localStorage.setItem(PENDING_KEY, snapshot);
  renderWhenIdle();
}

async function pullRemoteKitchen() {
  if (!isShared() || !navigator.onLine) return;
  if (syncing) { pullAfterSync = true; return; }
  try {
    const remote = await fetchRemoteKitchen();
    if (!remote.state || remote.revision <= (readSyncBase()?.revision || 0)) return;
    applyRemoteKitchen(remote);
    if (localStorage.getItem(PENDING_KEY)) pushPendingState();
  } catch { /* The next event or check tries again. */ }
}

function currentSyncMode() {
  if (!navigator.onLine) return 'offline';
  return localStorage.getItem(PENDING_KEY) ? 'pending' : 'online';
}

const showSyncStatus = () => updateSyncStatus(currentSyncMode());

// Phone apps cannot keep an event stream open through the bridge, so they ask for the revision every 15 seconds
// while open, and again when they come back to the front.
let phonePollId = null;

function startPhonePolling() {
  clearInterval(phonePollId);
  phonePollId = null;
  if (!STANDALONE || !homeServer()) return;
  phonePollId = setInterval(checkRemoteRevision, 15_000);
}

async function checkRemoteRevision() {
  if (!isShared() || !navigator.onLine || document.visibilityState !== 'visible') return;
  try {
    const { revision, devices } = await (await kitchenRequest('/api/state/revision')).json();
    if (hosting()) liveSync.devices = Number(devices) || 0;
    if (revision > (readSyncBase()?.revision || 0)) pullRemoteKitchen();
    if (STANDALONE) showSyncStatus();
  } catch {
    if (STANDALONE) updateSyncStatus('offline', t('Home server not reachable · will try again'));
  }
}

// Settings → Home server. Connecting tests the address, then folds this phone's kitchen into the server's one
// (items from both are kept) and keeps the two in step from then on. Disconnecting keeps the phone's copy.
function setHomeServerNote(text, kind = '') {
  const note = $('#home-server-note');
  note.textContent = text;
  note.className = `settings-note${kind ? ` is-${kind}` : ''}`;
}

function fillHomeServerSettings() {
  if (!STANDALONE) return;
  // A device that hosts the kitchen is its own home server (127.0.0.1); the Host section shows that instead.
  $('#home-server-settings').hidden = Boolean(hosting());
  const address = homeServer();
  $('#settings-form').elements.homeServer.value = address;
  $('#home-server-disconnect').hidden = !address;
  setHomeServerNote(address ? t('Connected to {address}. This phone shares that kitchen.', { address }) : t('Not connected. This phone keeps its own kitchen.'), address ? 'connected' : '');
}

async function connectHomeServer() {
  if (folderSync()) { setHomeServerNote(t('This device syncs through a shared folder. Stop that first.'), 'error'); return; }
  let address = $('#settings-form').elements.homeServer.value.trim().replace(/\/+$/, '');
  if (!address) { setHomeServerNote(t('Enter the address you open Goodstock on at home.'), 'error'); return; }
  if (!/^https?:\/\//i.test(address)) address = `http://${address}`;
  setHomeServerNote(t('Testing the connection…'));
  let revision = null;
  try {
    const token = homeToken();
    const answer = JSON.parse(await nativeCall('httpRequest', `${address}/api/state/revision`, JSON.stringify({ accept: 'application/json', 'x-goodstock-client': CLIENT_ID, ...(token ? { authorization: `Bearer ${token}` } : {}) })));
    if (answer.status === 401 && /"code"\s*:\s*"pin"/.test(answer.body || '')) {
      setHomeServerNote(t('This home server has a PIN.'));
      askForPin(address);
      return;
    }
    if (answer.status === 200) revision = JSON.parse(answer.body || '{}').revision;
  } catch { /* Answered below. */ }
  if (!Number.isFinite(revision)) {
    setHomeServerNote(t('No Goodstock server answered at {address}. Check the address and that the phone is on your home network.', { address }), 'error');
    return;
  }
  if (!window.confirm(t('Share the kitchen on {address}? Items from this phone are added to it, and from then on both stay in step.', { address }))) {
    setHomeServerNote(t('Not connected. This phone keeps its own kitchen.'));
    return;
  }
  localStorage.setItem(HOME_SERVER_KEY, address);
  // No common history yet: everything on this phone counts as new and is added to the server's kitchen, except
  // what the server already has (the same item in the same place, the same shopping-list line).
  localStorage.removeItem(SYNC_BASE_KEY);
  try {
    const remote = await fetchRemoteKitchen();
    if (remote.state) {
      const sameItem = (item) => `${cleanIngredient(item.name)}|${item.location}|${item.kind}`;
      const serverItems = new Set((remote.state.inventory || []).map(sameItem));
      const serverShopping = new Set((remote.state.shopping || []).map((item) => cleanIngredient(item.name)));
      state.inventory = state.inventory.filter((item) => !serverItems.has(sameItem(item)));
      state.shopping = state.shopping.filter((item) => !serverShopping.has(cleanIngredient(item.name)));
      localStorage.setItem(PENDING_KEY, JSON.stringify(state));
      applyRemoteKitchen(remote);
    } else {
      localStorage.setItem(PENDING_KEY, JSON.stringify(state));
    }
  } catch {
    localStorage.setItem(PENDING_KEY, JSON.stringify(state));
  }
  await pushPendingState();
  startPhonePolling();
  fillHomeServerSettings();
  fillSettingsMode();
  render();
}

function disconnectHomeServer() {
  if (!window.confirm(t('Stop sharing with the home server? This phone keeps its copy of the kitchen.'))) return;
  localStorage.removeItem(HOME_SERVER_KEY);
  localStorage.removeItem(HOME_TOKEN_KEY);
  localStorage.removeItem(PENDING_KEY);
  localStorage.removeItem(SYNC_BASE_KEY);
  startPhonePolling();
  fillHomeServerSettings();
  fillSettingsMode();
  render();
}

function connectLiveSync() {
  if (STANDALONE) { startPhonePolling(); startFolderSync(); return; }
  if (typeof EventSource === 'undefined') return;
  const source = new EventSource(`/api/events?client=${encodeURIComponent(CLIENT_ID)}`);
  source.addEventListener('open', () => { liveSync.connected = true; showSyncStatus(); });
  source.addEventListener('error', () => { liveSync.connected = false; showSyncStatus(); });
  source.addEventListener('presence', (event) => {
    try { liveSync.devices = JSON.parse(event.data).devices || 0; } catch { liveSync.devices = 0; }
    showSyncStatus();
  });
  source.addEventListener('state', (event) => {
    let data = {};
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.origin === CLIENT_ID) return;
    if (data.revision > (readSyncBase()?.revision || 0)) pullRemoteKitchen();
  });
  // Backup for networks that block event streams: look for a newer revision every 30 seconds.
  setInterval(() => { if (!liveSync.connected) checkRemoteRevision(); }, 30_000);
}

// Shared folder (phone and desktop apps, no server): every device writes its kitchen to goodstock-sync-<device>.json
// in a folder the household already keeps in step (iCloud Drive, Syncthing, Dropbox, a Google Drive folder on a
// computer…) and merges the other devices' files into its own, item by item like the server sync. Each device only
// ever writes its own file, so two devices saving at once never overwrite each other. For each other device this
// one remembers fingerprints of that device's kitchen as last merged: the base of the three-way merge.
const FOLDER_SYNC_KEY = 'goodstock-folder-sync-v1';
const FOLDER_BASES_KEY = 'goodstock-folder-bases-v1';
const FOLDER_FILE = /^goodstock-sync-([\w-]{4,64})\.json$/;
const FOLDER_SYNC_EVERY = 30_000;
let folderSyncRunning = false;
let folderSyncAgain = false;
let folderSyncTimer = null;
let folderSyncInterval = null;

const canSyncFolder = () => STANDALONE && Boolean(nativeApp.canSyncFolder && nativeApp.canSyncFolder());

function folderSync() {
  if (!canSyncFolder()) return null;
  try { return JSON.parse(localStorage.getItem(FOLDER_SYNC_KEY) || 'null'); } catch { return null; }
}

function writeFolderSync(settings) {
  try { localStorage.setItem(FOLDER_SYNC_KEY, JSON.stringify(settings)); } catch { /* Tried again next time. */ }
}

function readFolderBases() {
  try { return JSON.parse(localStorage.getItem(FOLDER_BASES_KEY) || '{}') || {}; } catch { return {}; }
}

// Two devices meeting for the first time may both have the same thing under different ids (the starting kitchen,
// or milk bought before they were linked). The one with the smaller id is kept on both sides, so both devices make
// the same choice and settle on one copy.
function dropTwinsOnFirstMeeting(local, remote) {
  const keys = {
    inventory: (item) => `${cleanIngredient(item.name)}|${item.location}|${item.kind}`,
    shopping: (item) => cleanIngredient(item.name),
  };
  const mine = { ...local };
  const theirs = { ...remote };
  for (const list of Object.keys(keys)) {
    const keyOf = keys[list];
    const localByKey = new Map((local[list] || []).map((item) => [keyOf(item), item]));
    const remoteByKey = new Map((remote[list] || []).map((item) => [keyOf(item), item]));
    const keep = (other) => (item) => {
      const twin = other.get(keyOf(item));
      return !twin || String(twin.id) === String(item.id) || String(item.id) < String(twin.id);
    };
    mine[list] = (local[list] || []).filter(keep(remoteByKey));
    theirs[list] = (remote[list] || []).filter(keep(localByKey));
  }
  return [mine, theirs];
}

function syncFolderSoon() {
  if (!folderSync()) return;
  clearTimeout(folderSyncTimer);
  folderSyncTimer = setTimeout(syncFolderNow, 1500);
}

function startFolderSync() {
  clearInterval(folderSyncInterval);
  folderSyncInterval = null;
  if (!folderSync()) return;
  folderSyncInterval = setInterval(() => { if (document.visibilityState === 'visible') syncFolderNow(); }, FOLDER_SYNC_EVERY);
  syncFolderNow();
}

// Reads the other devices' files that changed since last time and merges them in, then writes this device's file
// when its kitchen changed.
async function syncFolderNow() {
  const settings = folderSync();
  if (!settings) return;
  if (folderSyncRunning) { folderSyncAgain = true; return; }
  folderSyncRunning = true;
  try {
    const files = JSON.parse(await nativeCall('listSyncFolder') || '[]');
    const bases = readFolderBases();
    let merged = false;
    for (const file of files) {
      const match = FOLDER_FILE.exec(file.name || '');
      if (!match || match[1] === settings.device) continue;
      const device = match[1];
      const known = bases[device];
      if (known && known.modified === file.modified && known.size === file.size) continue;
      let parsed = null;
      try { parsed = JSON.parse(await nativeCall('readSyncFile', file.name)); } catch { continue; }
      if (!parsed || parsed.app !== 'goodstock' || !parsed.state || !Array.isArray(parsed.state.inventory)) continue;
      // A copy the sync app made of a device's file (OneDrive names a conflict "goodstock-sync-<id>-PCNAME.json")
      // still names the original device inside. Reading it as a new device would bring back what was deleted since.
      if (String(parsed.device || '') !== device) continue;
      const remote = normalizeState(parsed.state);
      const print = stamp(JSON.stringify(remote));
      if (!known || known.stamp !== print) {
        const [mine, theirs] = known ? [state, remote] : dropTwinsOnFirstMeeting(state, remote);
        state = normalizeState(mergeStates(known ? known.base : null, mine, theirs));
        merged = true;
      }
      bases[device] = { modified: file.modified, size: file.size, stamp: print, base: fingerprintState(remote), platform: String(parsed.platform || '') };
    }
    try { localStorage.setItem(FOLDER_BASES_KEY, JSON.stringify(bases)); } catch { /* Merged again next time. */ }
    const snapshot = JSON.stringify(state);
    if (merged) {
      localStorage.setItem(STORAGE_KEY, snapshot);
      renderWhenIdle();
    }
    const written = stamp(snapshot);
    if (written !== settings.written) {
      const content = JSON.stringify({ app: 'goodstock', syncVersion: 1, device: settings.device, platform: nativeApp.platform || '', savedAt: new Date().toISOString(), state });
      await nativeCall('writeSyncFile', `goodstock-sync-${settings.device}.json`, content);
    }
    if (folderSync()) writeFolderSync({ ...settings, written, last: new Date().toISOString(), error: '' });
  } catch (error) {
    if (folderSync()) writeFolderSync({ ...settings, error: String((error && error.message) || 'failed') });
  } finally {
    folderSyncRunning = false;
    showSyncStatus();
    if ($('#settings-dialog').open) fillFolderSyncSettings();
    if (folderSyncAgain) { folderSyncAgain = false; syncFolderSoon(); }
  }
}

function setFolderSyncNote(text, kind = '') {
  const note = $('#sync-folder-note');
  note.textContent = text;
  note.className = `settings-note${kind ? ` is-${kind}` : ''}`;
}

function fillFolderSyncSettings() {
  const section = $('#sync-folder-settings');
  section.hidden = !canSyncFolder();
  if (section.hidden) return;
  const settings = folderSync();
  $('#sync-folder-choose').textContent = settings ? t('Change folder') : t('Choose folder');
  $('#sync-folder-now').hidden = !settings;
  $('#sync-folder-off').hidden = !settings;
  if (!settings) { setFolderSyncNote(t('Off. This device keeps its own kitchen.')); return; }
  const others = Object.keys(readFolderBases()).length;
  if (settings.error) setFolderSyncNote(t('“{folder}” could not be read. Goodstock tries again in a moment.', { folder: settings.folder }), 'error');
  else if (!settings.last) setFolderSyncNote(t('Syncing with “{folder}”…', { folder: settings.folder }));
  else {
    const time = formatDate(new Date(settings.last), { hour: '2-digit', minute: '2-digit' });
    setFolderSyncNote(tp(others, '“{folder}” · {count} other device · synced {time}', '“{folder}” · {count} other devices · synced {time}', { folder: settings.folder, time }), 'connected');
  }
}

async function chooseSyncFolder() {
  if (isShared()) { setFolderSyncNote(t('This device already shares a kitchen through a home server. Disconnect it first.'), 'error'); return; }
  let folder;
  try {
    folder = await nativeCall('chooseSyncFolder');
  } catch (error) {
    if (!error || error.message !== 'cancelled') setFolderSyncNote(t('That folder cannot be used. Choose another one.'), 'error');
    return;
  }
  const previous = folderSync();
  // Another folder holds other devices' files: meet those afresh.
  localStorage.removeItem(FOLDER_BASES_KEY);
  writeFolderSync({ folder, device: (previous && previous.device) || makeId().replace(/[^\w-]/g, '').slice(0, 36), written: '', last: null, error: '' });
  fillFolderSyncSettings();
  fillSettingsMode();
  startFolderSync();
}

function stopFolderSync() {
  if (!window.confirm(t('Stop syncing through the shared folder? This device keeps its copy of the kitchen.'))) return;
  try { nativeApp.forgetSyncFolder(); } catch { /* Nothing kept. */ }
  localStorage.removeItem(FOLDER_SYNC_KEY);
  localStorage.removeItem(FOLDER_BASES_KEY);
  startFolderSync();
  fillFolderSyncSettings();
  fillSettingsMode();
  showSyncStatus();
}

// Hosting (Android and desktop apps): this device runs a small home server on the Wi-Fi with the same kitchen API
// as the Goodstock server, so other phones connect to it under Home server with its address and PIN. The host
// itself connects to its own server (127.0.0.1) and syncs exactly like the others. The kitchen is shared while
// Goodstock runs on the host; the others keep their copy and catch up when it is back.
const HOST_KEY = 'goodstock-host-v1';
const canHostKitchen = () => STANDALONE && Boolean(nativeApp.canHostKitchen && nativeApp.canHostKitchen());

function hosting() {
  if (!STANDALONE) return null;
  try { return JSON.parse(localStorage.getItem(HOST_KEY) || 'null'); } catch { return null; }
}

// Starts the host, or resumes it after a restart. The native side keeps the port, PIN and kitchen between starts.
async function startHosting(resume = false) {
  // Android keeps hosting in the background with a lasting notification; these are its two lines.
  const info = JSON.parse(await nativeCall('startKitchenHost', t('Sharing your kitchen'), t('Other devices on this Wi-Fi stay in step while this runs. Stop it in Settings → Connections.')));
  localStorage.setItem(HOST_KEY, JSON.stringify({ port: info.port, addresses: info.addresses || [], pin: info.pin }));
  localStorage.setItem(HOME_TOKEN_KEY, info.token);
  localStorage.setItem(HOME_SERVER_KEY, `http://127.0.0.1:${info.port}`);
  sendTrayLabels();
  if (resume) return;
  localStorage.removeItem(SYNC_BASE_KEY);
  localStorage.setItem(PENDING_KEY, JSON.stringify(state));
}

// Desktop app (0.35): closing the window while hosting keeps Goodstock in the system tray, so the others keep their
// home server, and it can start with the computer, in the background. The tray's words come from here, in the app's
// language. Starting with the computer only matters while hosting, so stopping hosting turns it off.
const START_AT_LOGIN_KEY = 'goodstock-start-at-login-v1';
const canStartAtLogin = () => STANDALONE && typeof nativeApp.setStartAtLogin === 'function';

function sendTrayLabels() {
  if (!STANDALONE || typeof nativeApp.setTrayLabels !== 'function') return;
  nativeApp.setTrayLabels(JSON.stringify({
    tooltip: t('Goodstock is still sharing your kitchen'),
    open: t('Open Goodstock'),
    quit: t('Stop sharing and quit'),
    title: t('Still sharing your kitchen'),
    note: t('Goodstock keeps running in the tray, so the other devices stay in step. Quit it from the tray icon.'),
  }));
}

function setStartAtLogin(on) {
  if (!canStartAtLogin()) return;
  try { if (on) localStorage.setItem(START_AT_LOGIN_KEY, 'true'); else localStorage.removeItem(START_AT_LOGIN_KEY); } catch { /* Shown unticked next time. */ }
  nativeApp.setStartAtLogin(on);
}

function setHostNote(text, kind = '') {
  const note = $('#host-note');
  note.textContent = text;
  note.className = `settings-note${kind ? ` is-${kind}` : ''}`;
}

async function beginHosting() {
  if (homeServer()) { setHostNote(t('This device already shares a kitchen through a home server. Disconnect it first.'), 'error'); return; }
  if (folderSync()) { setHostNote(t('This device syncs through a shared folder. Stop that first.'), 'error'); return; }
  try {
    await startHosting();
  } catch {
    setHostNote(t('Hosting could not start on this device.'), 'error');
    return;
  }
  await pushPendingState();
  startPhonePolling();
  fillHostSettings();
  fillHomeServerSettings();
  fillFolderSyncSettings();
  fillSettingsMode();
  render();
}

function endHosting() {
  if (!window.confirm(t('Stop hosting? The other devices keep their copy but no longer stay in step with this one.'))) return;
  try { nativeApp.stopKitchenHost(); } catch { /* Already stopped. */ }
  setStartAtLogin(false);
  for (const key of [HOST_KEY, HOME_SERVER_KEY, HOME_TOKEN_KEY, PENDING_KEY, SYNC_BASE_KEY]) localStorage.removeItem(key);
  liveSync.devices = 0;
  startPhonePolling();
  fillHostSettings();
  fillHomeServerSettings();
  fillFolderSyncSettings();
  fillSettingsMode();
  render();
}

function fillHostSettings() {
  const section = $('#host-settings');
  section.hidden = !canHostKitchen();
  if (section.hidden) return;
  const host = hosting();
  $('#host-start').hidden = Boolean(host);
  $('#host-stop').hidden = !host;
  const details = $('#host-details');
  details.hidden = !host;
  if (!host) { setHostNote(t('Off')); details.innerHTML = ''; return; }
  setHostNote(tp(liveSync.devices, 'Hosting · {count} other device connected', 'Hosting · {count} other devices connected'), 'connected');
  const addresses = host.addresses.length
    ? host.addresses.map((address) => `<dd><code>${escapeHtml(`${address}:${host.port}`)}</code></dd>`).join('')
    : `<dd>${escapeHtml(t('Not on a Wi-Fi network right now'))}</dd>`;
  details.innerHTML = `<p>${escapeHtml(t('On the other phones, open Settings → Connections → Home server and enter:'))}</p>`
    + `<dl class="host-codes"><dt>${escapeHtml(t('Address'))}</dt>${addresses}<dt>${escapeHtml(t('PIN'))}</dt><dd><code class="host-pin">${escapeHtml(host.pin)}</code></dd></dl>`
    + (canStartAtLogin()
      ? `<label class="host-login"><input type="checkbox" id="host-start-at-login" ${localStorage.getItem(START_AT_LOGIN_KEY) === 'true' ? 'checked' : ''} /> <span>${escapeHtml(t('Start with the computer, in the background'))}</span></label>`
        + `<p class="field-hint">${escapeHtml(t('Closing the window keeps sharing from the tray.'))}</p>`
      : '');
}
