// Server hardening: security headers on every answer; login limits per device behind the HTTPS proxy (TRUST_PROXY)
// and nobody else's X-Forwarded-For believed; over the household-wide limit the right PIN still gets in (single file,
// slowly) instead of everyone being locked out; and the import/photo fetch connecting only to the address it checked
// (a DNS answer that changes in between, "DNS rebinding", can't reach this machine).
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const freePort = () => new Promise((resolve) => {
  const probe = createServer().listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

// A server of this test's own, with extra environment variables and node options.
async function ownServer(env = {}, nodeArgs = []) {
  const port = await freePort();
  const data = await mkdtemp(join(tmpdir(), 'goodstock-security-'));
  const child = spawn(process.execPath, [...nodeArgs, 'server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: data, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${errors}`)), 15_000);
    child.stdout.on('data', (chunk) => { if (/listening/i.test(chunk)) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => reject(new Error(`server exited (${code}): ${errors}`)));
  });
  return { base: `http://127.0.0.1:${port}`, port, stop: async () => { child.kill(); await rm(data, { recursive: true, force: true }); } };
}

export default async function run({ base }) {
  const fail = [];
  const log = [];
  const login = (at, pin, from) => fetch(`${at}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...(from ? { 'x-forwarded-for': from } : {}) }, body: JSON.stringify({ pin }) });
  const setPin = (at) => fetch(`${at}/api/auth/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '4821' }) });

  // 1. Headers on pages, files, API answers and errors.
  for (const path of ['/', '/index.html', '/app/core.js', '/api/health', '/api/state', '/api/nothing-here', '/fonts/nothing.woff2']) {
    const answer = await fetch(`${base}${path}`);
    const headers = answer.headers;
    const missing = [['x-content-type-options', 'nosniff'], ['referrer-policy', 'same-origin'], ['x-frame-options', 'SAMEORIGIN']]
      .filter(([name, value]) => headers.get(name) !== value).map(([name]) => name);
    if (!/frame-ancestors 'self'/.test(headers.get('content-security-policy') || '')) missing.push('content-security-policy frame-ancestors');
    if (/script-src|default-src/.test(headers.get('content-security-policy') || '')) fail.push(`${path}: a content security policy that would block the inline scripts`);
    if (missing.length) fail.push(`${path} (${answer.status}) lacks ${missing.join(', ')}`);
  }

  // 2. Without TRUST_PROXY, X-Forwarded-For is ignored: five wrong PINs "from" different addresses lock this one.
  await setPin(base);
  for (let index = 0; index < 5; index++) await login(base, '0000', `203.0.113.${index + 1}`);
  const spoofed = await login(base, '0000', '203.0.113.99');
  if (spoofed.status !== 429) fail.push(`a made-up X-Forwarded-For got a fresh limit (${spoofed.status})`);

  // 3. Behind a trusted proxy (here: this machine), each forwarded address has its own limit.
  const proxied = await ownServer({ TRUST_PROXY: '127.0.0.1' });
  try {
    await setPin(proxied.base);
    for (let index = 0; index < 5; index++) await login(proxied.base, '0000', '198.51.100.7');
    const locked = await login(proxied.base, '4821', '198.51.100.7');
    const other = await login(proxied.base, '4821', '198.51.100.8');
    log.push(`proxied: locked device ${locked.status}, other device ${other.status}`);
    if (locked.status !== 429) fail.push(`the device with five wrong PINs was not locked (${locked.status})`);
    if (other.status !== 200) fail.push(`another device behind the proxy was locked out too (${other.status})`);
    // A chain of addresses: the last one (what the proxy saw) counts, not what the client wrote in front.
    const chained = await login(proxied.base, '4821', '198.51.100.8, 198.51.100.7');
    if (chained.status !== 429) fail.push(`the forwarded chain's last address was not used (${chained.status})`);

    // 4. The household-wide limit: with these 45, 50 wrong PINs from ten devices. Then the right PIN from a new
    // device still gets in (after waiting its turn), while wrong ones are slowed to one every few seconds.
    for (let device = 0; device < 9; device++) {
      await Promise.all(Array.from({ length: 5 }, (_, index) => login(proxied.base, String(1000 + device * 5 + index), `192.0.2.${device + 10}`)));
    }
    const started = Date.now();
    const right = await login(proxied.base, '4821', '192.0.2.200');
    log.push(`right PIN over the overall limit: ${right.status} after ${Date.now() - started} ms`);
    if (right.status !== 200) fail.push(`the right PIN from a fresh device was refused over the overall limit (${right.status})`);
    const burst = Array.from({ length: 9 }, (_, index) => login(proxied.base, String(2000 + index), `192.0.2.${index + 100}`).then((answer) => answer.status, () => 'closed'));
    const quick = await Promise.all(burst.map((answer) => Promise.race([answer, new Promise((resolve) => setTimeout(() => resolve('waiting'), 2500))])));
    log.push(`burst over the overall limit: ${quick.join(' ')}`);
    if (quick.filter((status) => status === 401).length > 1) fail.push(`over the overall limit, more than one wrong PIN was checked within 2.5 s: ${quick.join(' ')}`);
    if (quick.filter((status) => status === 429).length < 3) fail.push(`over the overall limit, the waiting line was not limited: ${quick.join(' ')}`);
  } finally {
    await proxied.stop();
  }

  // 5. DNS rebinding: the name first answers with a public address (checked and allowed), then with this machine.
  // The fetch must go to the checked address, so the private server here never sees a request.
  let secretHits = 0;
  const secret = createHttpServer((request, response) => { secretHits++; response.writeHead(200, { 'content-type': 'image/png' }); response.end('secret'); });
  await new Promise((resolve) => secret.listen(0, '127.0.0.1', resolve));
  const secretPort = secret.address().port;
  const rebinding = `
    import { syncBuiltinESMExports } from 'node:module';
    import dns from 'node:dns';
    const realLookup = dns.lookup;
    const realPromise = dns.promises.lookup;
    dns.promises.lookup = async (host, options) => host === 'rebind.test' ? [{ address: '192.0.2.44', family: 4 }]
      : host === 'self.test' ? [{ address: '127.0.0.1', family: 4 }] : realPromise(host, options);
    dns.lookup = (host, options, callback) => {
      const done = typeof options === 'function' ? options : callback;
      const all = typeof options === 'object' && options && options.all;
      if (host === 'rebind.test' || host === 'self.test') return process.nextTick(() => all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4));
      return realLookup(host, options, callback);
    };
    syncBuiltinESMExports();`;
  const rebound = await ownServer({}, ['--import', `data:text/javascript,${encodeURIComponent(rebinding)}`]);
  try {
    const answer = await Promise.race([
      fetch(`${rebound.base}/api/photo?url=${encodeURIComponent(`http://rebind.test:${secretPort}/photo.png`)}`).then((result) => result.status),
      new Promise((resolve) => setTimeout(() => resolve('still trying the public address'), 3000)),
    ]);
    log.push(`rebinding photo: ${answer}, private server hits: ${secretHits}`);
    if (secretHits) fail.push('the photo fetch looked the name up again and reached a private address (DNS rebinding)');
    if (answer === 200) fail.push('the rebinding fetch answered with the private server\'s photo');
    // A name is still fetched (through the pinned address): this server's own icon by a name that means this machine.
    const own = await fetch(`${rebound.base}/api/photo?url=${encodeURIComponent(`http://self.test:${rebound.port}/icon-192.png`)}`);
    const bytes = (await own.arrayBuffer()).byteLength;
    log.push(`own icon by name: ${own.status}, ${bytes} bytes`);
    if (own.status !== 200 || bytes < 100) fail.push(`a photo by host name could not be fetched (${own.status})`);
  } finally {
    await rebound.stop();
    secret.close();
  }
  return { fail, log };
}
