// Downloads the app's two fonts (DM Sans, Fraunces) from Google Fonts once and writes fonts/fonts.css pointing at
// local copies, so the app looks right without internet (the Android app, a tablet offline).
// Run from the repository root:  node fonts/build-fonts.mjs  (only needed to change fonts)
import { writeFile } from 'node:fs/promises';

const cssUrl = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap';
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const keep = new Set(['latin', 'latin-ext']);

const css = await (await fetch(cssUrl, { headers: { 'user-agent': userAgent } })).text();
const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g)];
const files = new Map();
let output = '/* DM Sans and Fraunces (SIL Open Font License), bundled so the app works offline. Made by fonts/build-fonts.mjs. */\n';
for (const [, subset, block] of blocks) {
  if (!keep.has(subset)) continue;
  const family = /font-family: '([^']+)'/.exec(block)[1];
  const url = /url\((https:[^)]+)\)/.exec(block)[1];
  const name = `${family.toLowerCase().replace(/\s+/g, '-')}-${subset}.woff2`;
  if (!files.has(url)) files.set(url, name);
  output += `/* ${subset} */\n${block.replace(url, files.get(url))}\n`;
}
for (const [url, name] of files) {
  const data = Buffer.from(await (await fetch(url)).arrayBuffer());
  await writeFile(`fonts/${name}`, data);
  console.log(name, data.length, 'bytes');
}
await writeFile('fonts/fonts.css', output);
console.log('wrote fonts/fonts.css with', output.match(/@font-face/g).length, 'faces');
