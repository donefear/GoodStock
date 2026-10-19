// The desktop app's Node side (desktop/native.js): requests follow redirects without sending a key to another host,
// automatic backups keep the newest four, and only timers and reminders still to come are scheduled.
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const native = createRequire(import.meta.url)('../../desktop/native.js');

export default async () => {
  const fail = [];
  const log = [];
  const check = (ok, message) => { if (!ok) fail.push(message); };

  // Two hosts on one port: 127.0.0.1 redirects to localhost; each answers with the Authorization header it saw.
  const server = createServer((request, response) => {
    if (request.url === '/move') {
      response.writeHead(302, { location: `http://localhost:${server.address().port}/landed` });
      return response.end();
    }
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`auth=${request.headers.authorization || ''} method=${request.method}`);
  });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const { port } = server.address();
  try {
    const same = await native.httpRequest({ url: `http://127.0.0.1:${port}/here`, headers: { Authorization: 'Bearer secret' } });
    check(same.status === 200 && same.body === 'auth=Bearer secret method=GET', `same host keeps the key: ${JSON.stringify(same)}`);
    const moved = await native.httpRequest({ url: `http://127.0.0.1:${port}/move`, headers: { Authorization: 'Bearer secret' } });
    check(moved.url.includes('localhost') && moved.body === 'auth= method=GET', `redirect to another host drops the key: ${JSON.stringify(moved)}`);
    const posted = await native.httpRequest({ method: 'post', url: `http://127.0.0.1:${port}/move`, body: '{}' });
    check(posted.status === 302, `a request with a body is not re-sent: ${posted.status}`);
    let refused = '';
    try { await native.httpRequest({ url: 'file:///etc/passwd' }); } catch (error) { refused = error.message; }
    check(/http and https/.test(refused), `file links are refused: ${refused}`);

    // Recipe photos (0.33): images come back as a data URL, anything else is refused.
    const fakeFetch = (type, body) => async () => new Response(body, { headers: { 'content-type': type } });
    const photo = await native.fetchImage({ url: 'https://example.com/cake.png', fetchImpl: fakeFetch('image/png', Buffer.from([137, 80, 78, 71])) });
    check(photo === 'data:image/png;base64,iVBORw==', `photo as a data URL: ${photo}`);
    let notImage = '';
    try { await native.fetchImage({ url: 'https://example.com/page', fetchImpl: fakeFetch('text/html', '<html>') }); } catch (error) { notImage = error.message; }
    check(/could not be loaded/.test(notImage), `a web page is not taken for a photo: ${notImage}`);
    let fileLink = '';
    try { await native.fetchImage({ url: 'file:///etc/passwd' }); } catch (error) { fileLink = error.message; }
    check(/http and https/.test(fileLink), `file links are refused for photos: ${fileLink}`);
  } finally {
    server.close();
  }

  const folder = await mkdtemp(join(tmpdir(), 'goodstock-desktop-'));
  try {
    await writeFile(join(folder, 'notes.txt'), 'keep me');
    for (const day of ['01', '08', '15', '22', '29']) await native.writeBackup(folder, `goodstock-auto-backup-2026-09-${day}.json`, '{}');
    const left = (await readdir(folder)).sort();
    log.push(left.join(', '));
    check(left.length === 5 && !left.includes('goodstock-auto-backup-2026-09-01.json') && left.includes('notes.txt'), `newest four backups kept, other files untouched: ${left}`);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }

  // Shared folder: only Goodstock sync files are listed, read or written.
  const syncFolder = await mkdtemp(join(tmpdir(), 'goodstock-sync-'));
  try {
    await writeFile(join(syncFolder, 'holiday.json'), '{}');
    await native.writeSyncFile(syncFolder, 'goodstock-sync-abcd1234.json', '{"app":"goodstock"}');
    const listed = await native.listSyncFolder(syncFolder);
    check(listed.length === 1 && listed[0].name === 'goodstock-sync-abcd1234.json' && listed[0].size === 19 && listed[0].modified > 0, `only sync files are listed: ${JSON.stringify(listed)}`);
    check(await native.readSyncFile(syncFolder, 'goodstock-sync-abcd1234.json') === '{"app":"goodstock"}', 'a sync file reads back');
    let refused = '';
    try { await native.readSyncFile(syncFolder, '../holiday.json'); } catch (error) { refused = error.message; }
    check(/sync file/.test(refused), `other files cannot be read: ${refused}`);
  } finally {
    await rm(syncFolder, { recursive: true, force: true });
  }

  // Hosting: the PIN gives the token, saves need the current revision, and the kitchen survives a restart.
  const hostFolder = await mkdtemp(join(tmpdir(), 'goodstock-hosted-'));
  try {
    let clock = 0;
    const options = { file: join(hostFolder, 'kitchen.json'), pin: '123456', token: 'secret-token', now: () => clock };
    const host = native.createKitchenHost(options);
    await host.load();
    const auth = (client) => ({ authorization: 'Bearer secret-token', 'x-goodstock-client': client });
    const kitchen = { inventory: [{ id: '1', name: 'Rice' }], recipes: [] };
    check((await host.handle({ method: 'GET', path: '/api/state' })).body.code === 'pin', 'the kitchen needs the token');
    check((await host.handle({ method: 'POST', path: '/api/auth/login', body: '{"pin":"123456"}' })).body.token === 'secret-token', 'the PIN gives the token');
    for (let i = 0; i < 5; i += 1) await host.handle({ method: 'POST', path: '/api/auth/login', body: '{"pin":"000000"}' });
    check((await host.handle({ method: 'POST', path: '/api/auth/login', body: '{"pin":"123456"}' })).status === 429, 'five wrong PINs lock the login');
    clock += 6 * 60_000;
    check((await host.handle({ method: 'POST', path: '/api/auth/login', body: '{"pin":"123456"}' })).status === 200, 'the lock ends after five minutes');
    const saved = await host.handle({ method: 'POST', path: '/api/state', headers: auth('a'), body: JSON.stringify({ state: kitchen, baseRevision: 0 }) });
    check(saved.status === 200 && saved.body.revision === 1, `first save: ${JSON.stringify(saved)}`);
    const stale = await host.handle({ method: 'POST', path: '/api/state', headers: auth('b'), body: JSON.stringify({ state: kitchen, baseRevision: 0 }) });
    check(stale.status === 409 && stale.body.state.inventory[0].name === 'Rice', `a save on an old revision gets the kitchen: ${stale.status}`);
    const revision = await host.handle({ method: 'GET', path: '/api/state/revision', headers: auth('a') });
    check(revision.body.revision === 1 && revision.body.devices === 1, `revision and other devices: ${JSON.stringify(revision.body)}`);
    const again = native.createKitchenHost(options);
    await again.load();
    const reloaded = await again.handle({ method: 'GET', path: '/api/state', headers: auth('a') });
    check(reloaded.body && reloaded.body._revision === 1 && reloaded.body.inventory[0].name === 'Rice', `the kitchen survives a restart: ${JSON.stringify(reloaded.body)}`);
    const { server, port } = await native.startKitchenHost(again, [0]);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/state/revision`, { headers: auth('c') });
      check(response.status === 200 && (await response.json()).revision === 1, 'the host answers over HTTP');
    } finally {
      server.close();
    }
  } finally {
    await rm(hostFolder, { recursive: true, force: true });
  }

  const now = 1_000_000;
  const timers = native.upcomingAlarms(JSON.stringify([
    { id: 'a', endsAt: now + 5000, title: 'Pasta', text: 'Done' },
    { id: 'b', endsAt: now + 5000, done: true },
    { id: 'c', endsAt: now - 1 },
  ]), 'endsAt', now);
  check(timers.length === 1 && timers[0].id === 'a' && timers[0].delay === 5000 && timers[0].title === 'Pasta', `only running timers: ${JSON.stringify(timers)}`);
  check(native.upcomingAlarms('not json', 'at', now) === null, 'an unreadable list keeps the alarms already set');
  check(native.safeFileName('../a:b.json', 'x') === '..-a-b.json', `file names cannot leave the folder: ${native.safeFileName('../a:b.json', 'x')}`);
  return { fail, log };
};
