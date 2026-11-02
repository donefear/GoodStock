// Downloads the app's two fonts (DM Sans, Fraunces) from Google Fonts once and writes fonts/fonts.css pointing at
// local copies, so the app looks right without internet (the Android app, a tablet offline).
// Neither font has Cyrillic letters, so Russian would fall back to Arial and Georgia in the middle of DM Sans and
// Fraunces digits. Two look-alikes with Cyrillic stand in under the same family names, limited by unicode-range to
// Cyrillic (the browser only downloads them when a page shows Cyrillic text): Onest for DM Sans, Lora for Fraunces.
// Run from the repository root:  node fonts/build-fonts.mjs  (only needed to change fonts)
import { writeFile } from 'node:fs/promises';

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// [Google Fonts request, subsets kept, family name used in the app (null = its own)]
const sources = [
  ['DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600', new Set(['latin', 'latin-ext']), null],
  ['Onest:wght@400;500;600;700', new Set(['cyrillic']), 'DM Sans'],
  ['Lora:wght@500;600', new Set(['cyrillic']), 'Fraunces'],
];

const files = new Map();
let output = '/* DM Sans and Fraunces, with Onest and Lora for Cyrillic (all SIL Open Font License), bundled so the app works offline. Made by fonts/build-fonts.mjs. */\n';
for (const [request, keep, as] of sources) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${request}&display=swap`, { headers: { 'user-agent': userAgent } })).text();
  const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g)];
  for (const [, subset, found] of blocks) {
    if (!keep.has(subset)) continue;
    const own = /font-family: '([^']+)'/.exec(found)[1];
    const family = as || own;
    const block = found.replace(`font-family: '${own}'`, `font-family: '${family}'`);
    const url = /url\((https:[^)]+)\)/.exec(block)[1];
    const name = `${family.toLowerCase().replace(/\s+/g, '-')}-${subset}.woff2`;
    if (!files.has(url)) files.set(url, name);
    output += `/* ${subset}${as ? ` (${own})` : ''} */\n${block.replace(url, files.get(url))}\n`;
  }
}
for (const [url, name] of files) {
  const data = Buffer.from(await (await fetch(url)).arrayBuffer());
  await writeFile(`fonts/${name}`, data);
  console.log(name, data.length, 'bytes');
}
await writeFile('fonts/fonts.css', output);
console.log('wrote fonts/fonts.css with', output.match(/@font-face/g).length, 'faces');
