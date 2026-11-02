// Server backups: safety copies made within the same minute (or second) each get their own name, they are kept apart
// from the daily copies (the newest 14 daily ones and the newest 10 safety ones), older minute-named safety copies
// still count, and a save with safetyCopy: true (a restore) keeps the kitchen as it was even when little changes.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const freePort = () => new Promise((resolve) => {
  const probe = createServer().listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

export default async function run() {
  const fail = [];
  const log = [];
  const port = await freePort();
  const data = await mkdtemp(join(tmpdir(), 'goodstock-backups-'));
  const backups = join(data, 'backups');
  // Sixteen old daily copies and three safety copies named the old way (to the minute), from last year.
  await mkdir(backups, { recursive: true });
  const old = (name, items) => writeFile(join(backups, name), JSON.stringify({ app: 'goodstock', backupVersion: 1, exportedAt: '2025-01-01T00:00:00Z', state: { inventory: Array.from({ length: items }, (_, index) => ({ id: `o${index}` })), recipes: [] } }));
  for (let day = 1; day <= 16; day++) await old(`state-2025-01-${String(day).padStart(2, '0')}.json`, day);
  for (const time of ['0901', '0902', '0903']) await old(`state-2025-01-16-before-${time}.json`, 3);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 15_000);
      child.stdout.on('data', (chunk) => { if (/listening/i.test(chunk)) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => reject(new Error(`server exited (${code})`)));
    });
    const list = async () => (await (await fetch(`${base}/api/backups`)).json()).backups;
    // The server answers a save before its queued backup writes finish, so wait until the list stops changing.
    const settled = async () => {
      let last = '';
      for (let tries = 0; tries < 50; tries++) {
        const now = JSON.stringify(await list());
        if (now === last) return JSON.parse(now);
        last = now;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return JSON.parse(last);
    };
    const revision = async () => (await (await fetch(`${base}/api/state/revision`)).json()).revision;
    const kitchen = (items) => ({ inventory: Array.from({ length: items }, (_, index) => ({ id: `i${index}`, name: `Item ${index}`, quantity: 1, unit: '', location: 'Fridge', kind: 'Food' })), recipes: [] });
    const save = async (state, extra = {}) => fetch(`${base}/api/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, baseRevision: await revision(), client: 'test', ...extra }) });

    // The first save has nothing to back up; the second makes today's daily copy and prunes the old daily ones to 14.
    await save(kitchen(8));
    await save(kitchen(9));
    let names = (await settled()).map((backup) => backup.name);
    const daily = names.filter((name) => !name.includes('-before-'));
    log.push(`after two saves: ${daily.length} daily, ${names.length - daily.length} safety`);
    if (daily.length !== 14) fail.push(`${daily.length} daily copies kept (should be 14)`);
    if (!daily.some((name) => name === `state-${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}.json`)) fail.push('no daily copy for today');
    if (names.filter((name) => name.includes('-before-')).length !== 3) fail.push('the old minute-named safety copies were not kept (or not recognised)');

    // A restore asks for a safety copy even when the kitchen hardly changes: twelve of them in quick succession.
    for (let count = 0; count < 12; count++) {
      const answer = await save(kitchen(10 + count), { safetyCopy: true });
      if (answer.status !== 200) fail.push(`save with safetyCopy answered ${answer.status}`);
    }
    const listed = await settled();
    names = listed.map((backup) => backup.name);
    const safety = listed.filter((backup) => backup.safety);
    log.push(`after twelve restores: ${names.length} backups, safety ${safety.map((backup) => `${backup.name}:${backup.inventory}`).join(' ')}`);
    if (safety.length !== 10) fail.push(`${safety.length} safety copies kept (should be the newest 10)`);
    if (new Set(names).size !== names.length) fail.push('two backups with the same name');
    if (names.filter((name) => !name.includes('-before-')).length !== 14) fail.push('safety copies pushed out daily copies');
    // Each copy holds the kitchen as it was before that save (9, 10 … 20 items); the newest ten are 11 … 20.
    const counts = safety.map((backup) => backup.inventory).sort((a, b) => a - b);
    if (counts.join(',') !== '11,12,13,14,15,16,17,18,19,20') fail.push(`safety copies hold the wrong kitchens: ${counts.join(',')}`);
    if (names.some((name) => /-before-\d{4}\.json$/.test(name))) fail.push('old safety copies were not pruned first');
    // Every listed name can be fetched (the name check knows the new names), and a made-up one cannot.
    for (const name of names) {
      const answer = await fetch(`${base}/api/backups/${name}`);
      if (answer.status !== 200) fail.push(`${name} could not be fetched (${answer.status})`);
    }
    for (const bad of ['state-2025-01-01-before-12.json', 'state-2025-01-01-before-120000-x.json', 'state-2025-01-01-before-1200001.json']) {
      if ((await fetch(`${base}/api/backups/${bad}`)).status !== 400) fail.push(`${bad} was accepted as a backup name`);
    }
    // A save without the flag that changes little makes no safety copy.
    const before = (await settled()).filter((backup) => backup.safety).map((backup) => backup.name).join();
    await save(kitchen(21));
    if ((await settled()).filter((backup) => backup.safety).map((backup) => backup.name).join() !== before) fail.push('a small save without safetyCopy made a safety copy');
    if ((await readdir(backups)).some((name) => name.endsWith('.tmp'))) fail.push('a temporary backup file was left behind');
  } finally {
    child.kill();
    await rm(data, { recursive: true, force: true });
  }
  return { fail, log };
}
