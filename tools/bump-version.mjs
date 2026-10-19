// Bumps the "Goodstock vX.Y.Z" label in index.html and the service worker cache name in sw.js together.
//
//   npm run bump              v3.2.13 → v3.2.14
//   npm run bump -- minor     v3.2.13 → v3.3.0
//   npm run bump -- major     v3.2.13 → v4.0.0
//   npm run bump -- 3.4.1     an exact version
//   npm run bump -- --check   only check that the two match (exit 1 if not); `npm test` runs this
//
// The cache name is `goodstock-shell-v<version>`, so a new version always clears the old offline cache.
// The APK (android/app/build.gradle) and the desktop and iOS builds read their version from the label.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = /Goodstock v(\d+)\.(\d+)\.(\d+)/;
const CACHE = /const CACHE_NAME = '([^']*)';/;

async function readVersions() {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  const label = html.match(LABEL);
  const cache = sw.match(CACHE);
  if (!label) throw new Error('No "Goodstock vX.Y.Z" label in index.html.');
  if (!cache) throw new Error("No `const CACHE_NAME = '…';` in sw.js.");
  return { html, sw, version: label.slice(1, 4).join('.'), cacheName: cache[1] };
}

const cacheNameFor = (version) => `goodstock-shell-v${version}`;

function nextVersion(version, how = 'patch') {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [major, minor, patch] = version.split('.').map(Number);
  if (how === 'major') return `${major + 1}.0.0`;
  if (how === 'minor') return `${major}.${minor + 1}.0`;
  if (how === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump "${how}": use patch, minor, major or X.Y.Z.`);
}

async function main() {
  const arg = process.argv[2] || 'patch';
  const { html, sw, version, cacheName } = await readVersions();
  if (arg === '--check') {
    if (cacheName === cacheNameFor(version)) { console.log(`v${version}, cache ${cacheName}`); return; }
    console.log(`sw.js cache name is ${cacheName}, expected ${cacheNameFor(version)} for v${version}. Run \`npm run bump\`.`);
    process.exit(1);
  }
  const next = nextVersion(version, arg);
  await writeFile(join(root, 'index.html'), html.replace(LABEL, `Goodstock v${next}`));
  await writeFile(join(root, 'sw.js'), sw.replace(CACHE, `const CACHE_NAME = '${cacheNameFor(next)}';`));
  console.log(`v${version} → v${next} (index.html label, sw.js cache ${cacheNameFor(next)})`);
  if (next.endsWith('.0')) console.log('A new X.Y.0: after committing, run `bash tools/backup-version.sh`.');
}

main().catch((error) => { console.error(error.message); process.exit(1); });
