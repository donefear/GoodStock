// A second copy of the server backups (0.38): BACKUP_COPY_DIR gets every backup, catches up after a restart, and a
// copy folder that can't be used never stops a save. Starts its own servers, since it needs the setting.
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const freePort = () => new Promise((resolve) => { const probe = createServer().listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });

async function withServer(env, run) {
  const port = await freePort();
  const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 15_000);
      server.stdout.on('data', (chunk) => { if (/listening/i.test(chunk)) { clearTimeout(timer); resolve(); } });
      server.on('exit', (code) => reject(new Error(`server exited (${code})`)));
    });
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.kill();
  }
}

const save = async (base, state) => {
  const { _revision: baseRevision = 0 } = (await (await fetch(`${base}/api/state`)).json()) || {};
  return fetch(`${base}/api/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, baseRevision, client: 'test' }) });
};
const kitchen = (name) => ({ inventory: [{ id: 'a', name, quantity: 1, unit: '', location: 'Fridge' }], recipes: [], plan: [], shopping: [], locations: ['Fridge'] });

export default async () => {
  const fail = [];
  const log = [];
  const data = await mkdtemp(join(tmpdir(), 'goodstock-data-'));
  const copy = await mkdtemp(join(tmpdir(), 'goodstock-copy-'));
  try {
    await withServer({ DATA_DIR: data, BACKUP_COPY_DIR: copy }, async (base) => {
      await save(base, kitchen('Milk'));
      await save(base, kitchen('Cheese')); // The first save of the day makes the daily backup of the kitchen before it.
      const copied = (await readdir(copy)).filter((name) => /^state-.*\.json$/.test(name));
      const status = await (await fetch(`${base}/api/backups`)).json();
      log.push(`copied: ${copied.join(', ')} · status ${JSON.stringify(status.copy)}`);
      if (copied.length !== 1) fail.push('the daily backup was not copied');
      if (!status.copy || !status.copy.ok) fail.push('Settings should hear that copying works');
      await unlink(join(copy, copied[0]));
    });
    // A restart copies what the folder missed (for example while a NAS was off).
    await withServer({ DATA_DIR: data, BACKUP_COPY_DIR: copy }, async () => {
      if (!(await readdir(copy)).some((name) => /^state-.*\.json$/.test(name))) fail.push('a restart did not catch the copy folder up');
    });
    // A copy folder that can't be used: saving still works, and Settings shows the reason.
    const notAFolder = join(copy, 'not-a-folder');
    await writeFile(notAFolder, 'x');
    const data2 = await mkdtemp(join(tmpdir(), 'goodstock-data-'));
    await withServer({ DATA_DIR: data2, BACKUP_COPY_DIR: join(notAFolder, 'inside') }, async (base) => {
      await save(base, kitchen('Milk'));
      const saved = await save(base, kitchen('Bread'));
      const status = await (await fetch(`${base}/api/backups`)).json();
      log.push(`broken copy folder: save ${saved.status}, status ${JSON.stringify(status.copy)}`);
      if (!saved.ok) fail.push('a broken copy folder stopped the save');
      if (!status.copy || status.copy.ok || !status.copy.error) fail.push('Settings should hear that copying failed');
    });
    await rm(data2, { recursive: true, force: true });
    // Without the setting there is no copy line at all.
    await withServer({ DATA_DIR: data, BACKUP_COPY_DIR: '' }, async (base) => {
      if ((await (await fetch(`${base}/api/backups`)).json()).copy !== null) fail.push('copy status shown without BACKUP_COPY_DIR');
    });
  } finally {
    await rm(data, { recursive: true, force: true });
    await rm(copy, { recursive: true, force: true });
  }
  return { fail, log };
};
