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
