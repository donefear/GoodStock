// Goodstock, part 2 of 5: the shared kitchen: phone apps on a home server, the household PIN, and syncing with
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
  const headers = JSON.stringify({ 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) });
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
  if (!isShared()) {
    dot.className = 'sync-dot online';
    label.textContent = t('Saved on this phone');
    text.textContent = t('Back up in Settings');
    return;
  }
  dot.className = `sync-dot ${mode}`;
  label.textContent = mode === 'offline' ? t('Working offline') : mode === 'pending' ? t('Changes queued') : t('Shared kitchen, in sync');
  const live = STANDALONE
    ? t('Home server · {address}', { address: homeServer().replace(/^https?:\/\//, '') })
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
  const snapshot = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, snapshot);
  if (isShared()) localStorage.setItem(PENDING_KEY, snapshot);
  render();
  checkExpiryReminders();
  pushPendingState();
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

// Three-way merge of lists of items with an id: changes made here since the last sync win over the server's copy,
// everything else takes the server's version. A delete does not beat an edit made elsewhere.
function mergeById(base = [], local = [], remote = []) {
  const idOf = (item) => (item && item.id != null ? String(item.id) : null);
  const baseById = new Map(base.map((item) => [idOf(item), JSON.stringify(item)]));
  const localById = new Map(local.map((item) => [idOf(item), item]));
  const remoteById = new Map(remote.map((item) => [idOf(item), item]));
  const changed = (item, id) => (item ? !baseById.has(id) || JSON.stringify(item) !== baseById.get(id) : baseById.has(id));
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
  for (const key of ['inventory', 'recipes', 'plan', 'shopping', 'timerPresets']) {
    merged[key] = mergeById(base?.[key] || [], local?.[key] || [], remote?.[key] || []);
  }
  merged.locations = JSON.stringify(local?.locations) !== JSON.stringify(base?.locations) ? local.locations : remote.locations;
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
    const { revision } = await (await kitchenRequest('/api/state/revision')).json();
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
  const address = homeServer();
  $('#settings-form').elements.homeServer.value = address;
  $('#home-server-disconnect').hidden = !address;
  setHomeServerNote(address ? t('Connected to {address}. This phone shares that kitchen.', { address }) : t('Not connected. This phone keeps its own kitchen.'), address ? 'connected' : '');
}

async function connectHomeServer() {
  let address = $('#settings-form').elements.homeServer.value.trim().replace(/\/+$/, '');
  if (!address) { setHomeServerNote(t('Enter the address you open Goodstock on at home.'), 'error'); return; }
  if (!/^https?:\/\//i.test(address)) address = `http://${address}`;
  setHomeServerNote(t('Testing the connection…'));
  let revision = null;
  try {
    const token = homeToken();
    const answer = JSON.parse(await nativeCall('httpRequest', `${address}/api/state/revision`, JSON.stringify({ accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) })));
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
  if (STANDALONE) { startPhonePolling(); return; }
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
