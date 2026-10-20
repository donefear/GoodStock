// Fonts for the legacy page (tools/build-legacy.mjs) on old tablets. Their engines (Chrome 30–35) can't read woff2,
// and Android 4.4's own fonts lack most symbols the app uses as icons (▤ ⌕ ★ ⏱ 🥕 …). This downloads, once, from
// Google Fonts with an old browser's user agent (so the answer is .woff):
//   - DM Sans and Fraunces, whole fonts;
//   - Noto Sans Symbols 2, Noto Sans Symbols, Noto Sans Math and Noto Emoji (black and white), each cut down to the
//     symbols the app uses (listed in fonts/legacy/symbols.txt).
// It writes fonts/legacy/*.woff and fonts/legacy/fonts.css. The legacy build fails when the app uses a symbol that is
// not in symbols.txt; then run from the repository root:  node fonts/build-legacy-fonts.mjs
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const userAgent = 'Mozilla/5.0 (Linux; Android 4.4.2; GT-P5210 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/30.0.0.0 Safari/537.36';
export const SYMBOL_FAMILIES = ['Noto Sans Symbols 2', 'Noto Sans Symbols', 'Noto Sans Math', 'Noto Emoji'];

// Symbols and emoji in the files the browser loads (arrows, shapes, dingbats, emoji…); DM Sans has the rest.
export async function symbolsInApp(root = '.') {
  const files = ['index.html', 'styles.css', 'i18n.js', 'kitchen-tools.js', 'kitchen-reference.js', ...(await readdir(`${root}/app`)).map((file) => `app/${file}`)];
  const found = new Set();
  for (const file of files) {
    for (const char of await readFile(`${root}/${file}`, 'utf8')) {
      const code = char.codePointAt(0);
      if ((code >= 0x2070 && code < 0x2c00) || (code >= 0x1f000 && code < 0x1fb00)) found.add(char);
    }
  }
  return [...found].sort();
}

async function fetchFaces(family) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}`, { headers: { 'user-agent': userAgent } })).text();
  return [...css.matchAll(/@font-face \{[\s\S]*?\}/g)].map(([block]) => block);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await rm('fonts/legacy', { recursive: true, force: true });
  await mkdir('fonts/legacy', { recursive: true });
  const symbols = await symbolsInApp();
  let css = '/* Fonts for the legacy page (SIL Open Font License): .woff for old engines. Made by fonts/build-legacy-fonts.mjs. */\n';
  const requests = [
    ['DM Sans', 'DM+Sans:wght@400;500;600;700'],
    ['Fraunces', 'Fraunces:wght@500;600'],
    ...SYMBOL_FAMILIES.map((name) => [name, `${name.replace(/ /g, '+')}&text=${encodeURIComponent(symbols.join(''))}`]),
  ];
  for (const [name, query] of requests) {
    const faces = await fetchFaces(query);
    if (!faces.length) throw new Error(`Google Fonts sent nothing for ${name}`);
    for (const face of faces) {
      const url = /url\((https:[^)]+)\)/.exec(face)[1];
      const weight = /font-weight: (\d+)/.exec(face)[1];
      const file = `${name.toLowerCase().replace(/\s+/g, '-')}-${weight}.woff`;
      const data = Buffer.from(await (await fetch(url, { headers: { 'user-agent': userAgent } })).arrayBuffer());
      await writeFile(`fonts/legacy/${file}`, data);
      console.log(file, data.length, 'bytes');
      css += `${face.replace(url, file)}\n`;
    }
  }
  await writeFile('fonts/legacy/fonts.css', css);
  await writeFile('fonts/legacy/symbols.txt', `${symbols.join('\n')}\n`);
  console.log(`wrote fonts/legacy/fonts.css (${symbols.length} symbols)`);
}
