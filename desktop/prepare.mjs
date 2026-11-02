// Copies the web app from the repository root into desktop/web before a desktop build, plus the app icon, and prints
// the version from the "Goodstock vX.Y.Z" label in index.html. Keep the file list in step with webFiles in
// android/app/build.gradle and ios/scripts/copy-web.sh.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const web = join(here, 'web');
const files = ['index.html', 'i18n.js', 'kitchen-tools.js', 'kitchen-reference.js', 'recipe-import.mjs', 'mealie.mjs', 'deepl.mjs', 'styles.css', 'ingredients.json', 'manifest.webmanifest', 'logo.svg', 'icon.svg', 'fonts/fonts.css'];
const folders = [['lang', '.js'], ['app', '.js'], ['fonts', '.woff2'], ['fonts/legacy', '.woff'], ['fonts/legacy', '.css']];

await rm(web, { recursive: true, force: true });
for (const folder of ['', 'lang', 'app', 'fonts', 'fonts/legacy']) await mkdir(join(web, folder), { recursive: true });
for (const file of files) await copyFile(join(root, file), join(web, file));
for (const [folder, extension] of folders) {
  for (const name of (await readdir(join(root, folder))).filter((entry) => entry.endsWith(extension))) await copyFile(join(root, folder, name), join(web, folder, name));
}
// The copy for old browsers (tools/build-legacy.mjs, generated and git-ignored): index.html sends a browser without
// ?. and ?? there, e.g. the kitchen tablet opening a desktop-hosted kitchen. Built here when the repository's own dev
// dependencies are installed (npm install in the repository root); otherwise an existing legacy/ is copied as it is.
if (existsSync(join(root, 'node_modules', '@babel', 'core'))) {
  const build = spawnSync(process.execPath, ['tools/build-legacy.mjs'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (build.status !== 0) throw new Error('tools/build-legacy.mjs failed');
}
if (existsSync(join(root, 'legacy', 'index.html'))) await cp(join(root, 'legacy'), join(web, 'legacy'), { recursive: true });
else console.error('No legacy/ copy for old browsers (run npm install in the repository root, then this again).');
// One square picture serves as the window icon and, through electron-builder, the .exe/.app/AppImage icon.
const icon = join(root, 'ios/Goodstock/Assets.xcassets/AppIcon.appiconset/icon-1024.png');
await copyFile(icon, join(web, 'app-icon.png'));
await mkdir(join(here, 'build'), { recursive: true });
await copyFile(icon, join(here, 'build', 'icon.png'));

const label = /Goodstock v(\d+)\.(\d+)(?:\.(\d+))?/.exec(await readFile(join(root, 'index.html'), 'utf8'));
console.log(label ? `${label[1]}.${label[2]}.${label[3] || 0}` : '1.0.0');
