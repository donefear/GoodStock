// Builds legacy/: the web app for old Android tablets whose built-in browser engine (Android System WebView) can no
// longer be updated, e.g. Android 4.4 with its Chrome 30–33 engine. The Android app opens legacy/index.html instead
// of index.html when the WebView is older than Chrome 80 (MainActivity.java).
//
//   - JavaScript: each script through Babel (preset-env, Chrome 30), with polyfills first (legacy/polyfills.js:
//     core-js, fetch, <dialog>, DOM methods, legacyRegExp for patterns built at run time).
//   - CSS: theme colours written out, in styles.css (light) and styles-dark.css (swapped in by tools/legacy/dom.js), logical properties → left/right, vendor prefixes,
//     and fallbacks for grid, min()/max()/clamp() and newer selectors (tools/legacy/css.mjs), then
//     tools/legacy/legacy.css.
//
// `node tools/build-legacy.mjs` (needs the dev dependencies: npm install). legacy/ is generated, not committed;
// android/build-apk.sh and the Android workflow build it before the APK.
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { tokenizer } from 'acorn';
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import customProperties from 'postcss-custom-properties';
import logical from 'postcss-logical';
import { symbolsInApp } from '../fonts/build-legacy-fonts.mjs';
import { legacyGrid, legacySelectors, legacyThemeValues, legacyValues } from './legacy/css.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'legacy');
const TARGET = 'chrome 30';
const read = (file) => readFileSync(join(root, file), 'utf8');
const write = (file, text) => {
  mkdirSync(dirname(join(out, file)), { recursive: true });
  writeFileSync(join(out, file), text);
};

// new RegExp(…) / RegExp(…) → legacyRegExp(…) (tools/legacy/regexp.js), which rewrites \p{…} and drops flag u.
const runtimeRegExps = ({ types: t }) => ({
  visitor: {
    'NewExpression|CallExpression'(path) {
      if (t.isIdentifier(path.node.callee, { name: 'RegExp' }) && !path.scope.getBinding('RegExp')) {
        path.replaceWith(t.callExpression(t.identifier('legacyRegExp'), path.node.arguments));
      }
    },
  },
});

// Old engines cannot compile a lookbehind, and nothing can rewrite one; fail the build instead of the tablet.
function checkNoLookbehind(file, code, sourceType) {
  for (const token of tokenizer(code, { ecmaVersion: 'latest', sourceType })) {
    if (token.type.label === 'regexp' && /\(\?<[=!]/.test(token.value.pattern)) {
      throw new Error(`${file}: a regex lookbehind (${token.value.pattern.slice(0, 60)}…) cannot run on old tablets; rewrite it without (?<= or (?<!`);
    }
  }
}

function compile(file, code) {
  const { code: result } = transformSync(code, {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceType: 'script',
    compact: false,
    comments: false,
    plugins: [runtimeRegExps],
    presets: [[require.resolve('@babel/preset-env'), { targets: TARGET, modules: false }]],
  });
  // The scripts share one global scope, so Babel's top-level helpers and caches (_templateObject, _excluded…) from
  // one file would overwrite another's. Names Babel made up get a per-file suffix.
  const suffix = `$${file.replace(/\W+/g, '_')}`;
  const ownHelpers = () => ({
    visitor: {
      Program(path) {
        for (const name of Object.keys(path.scope.bindings)) {
          const inSource = new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(code);
          if (name.startsWith('_') && !inSource) path.scope.rename(name, name + suffix);
        }
      },
    },
  });
  return transformSync(result, { filename: file, babelrc: false, configFile: false, sourceType: 'script', compact: false, plugins: [ownHelpers] }).code;
}

rmSync(out, { recursive: true, force: true });

// Scripts, in the order index.html loads them. Modules become plain scripts: their exports were only used through
// the window globals they set, so each is wrapped in its own function scope.
const html = read('index.html');
const scripts = [...html.matchAll(/<script(?: type="module")? src="([^"]+)"[^>]*><\/script>/g)].map((match) => match[1]);
if (!scripts.includes('app/actions.js')) throw new Error('index.html: app scripts not found');
const legacyName = (file) => file.replace(/\.mjs$/, '.js');
for (const file of scripts) {
  let code = read(file);
  const isModule = file.endsWith('.mjs');
  checkNoLookbehind(file, code, isModule ? 'module' : 'script');
  if (isModule) {
    if (/^import\s/m.test(code)) throw new Error(`${file}: imports are not supported in the legacy build`);
    code = `(function () {\n${code.replace(/^export\s+(?=function|const|let|class|async)/gm, '')}\n})();`;
  }
  if (file === 'i18n.js') {
    const before = code;
    code = code.replace('script.src = `lang/${code}.js`;', 'script.src = `legacy/lang/${code}.js`;');
    if (code === before) throw new Error('i18n.js: the language file path changed; update tools/build-legacy.mjs');
  }
  write(legacyName(file), compile(file, code));
}
for (const file of readdirSync(join(root, 'lang')).filter((name) => /^[a-z-]+\.js$/i.test(name))) {
  write(`lang/${file}`, compile(`lang/${file}`, read(`lang/${file}`)));
}

// Polyfills: core-js (all of it; old engines lack most), fetch, <dialog>, DOM methods and run-time regex rewriting.
const bmp = (name) => require(`regenerate-unicode-properties/General_Category/${name}.js`).characters.clone().removeRange(0x10000, 0x10ffff).toString().replace(/^\[|\]$/g, '');
const properties = { L: bmp('Letter'), Letter: bmp('Letter'), Lu: bmp('Uppercase_Letter'), Ll: bmp('Lowercase_Letter'), M: bmp('Mark'), Mark: bmp('Mark'), N: bmp('Number'), Nd: bmp('Decimal_Number'), P: bmp('Punctuation') };
// String.prototype.normalize (Chrome 34): the app only uses NFD, to strip accents. The table holds every character
// of the Basic Multilingual Plane that NFD changes (Hangul aside), made with this Node's own normalize().
const decompositions = {};
for (let code = 0; code < 0x10000; code++) {
  if ((code >= 0xd800 && code <= 0xdfff) || (code >= 0xac00 && code <= 0xd7a3)) continue;
  const char = String.fromCharCode(code);
  const decomposed = char.normalize('NFD');
  if (decomposed !== char) decompositions[char] = decomposed;
}
const normalizePolyfill = `(function () {
  if (String.prototype.normalize) return;
  var table = ${JSON.stringify(decompositions)};
  Object.defineProperty(String.prototype, 'normalize', { configurable: true, writable: true, value: function (form) {
    var text = String(this);
    if (form !== 'NFD' && form !== 'NFKD') return text;
    var out = '';
    for (var i = 0; i < text.length; i++) out += table[text[i]] || text[i];
    return out;
  } });
})();`;

write('polyfills.js', [
  read('node_modules/core-js-bundle/minified.js').replace(/\/\/# sourceMappingURL=.*$/m, ''),
  read('node_modules/whatwg-fetch/dist/fetch.umd.js'),
  read('node_modules/dialog-polyfill/dist/dialog-polyfill.js'),
  normalizePolyfill,
  read('tools/legacy/dom.js'),
  read('tools/legacy/regexp.js').replace('/* PROPERTIES */ {}', JSON.stringify(properties)),
].join('\n;\n'));

// Fonts: .woff copies and the icon symbols' fonts (fonts/build-legacy-fonts.mjs), which must cover every symbol the
// app uses. legacy/styles.css sits one folder down, so its @import goes up one.
const knownSymbols = new Set(read('fonts/legacy/symbols.txt').split(/\r?\n/));
const newSymbols = (await symbolsInApp(root)).filter((symbol) => !knownSymbols.has(symbol));
if (newSymbols.length) throw new Error(`New symbols ${newSymbols.join(' ')} are not in the old tablets' fonts yet: run node fonts/build-legacy-fonts.mjs`);
const css = read('styles.css').replace("@import url('fonts/fonts.css');", "@import url('../fonts/legacy/fonts.css');");
if (!css.includes('fonts/legacy/fonts.css')) throw new Error("styles.css no longer imports fonts/fonts.css; update tools/build-legacy.mjs");
// Two stylesheets with the theme colours written out (old engines have no custom properties): styles.css (light)
// and styles-dark.css. tools/legacy/dom.js switches between them when the app sets data-theme.
for (const theme of ['light', 'dark']) {
  const styled = await postcss([
    legacyThemeValues(theme),
    customProperties({ preserve: true }),
    logical(),
    legacyValues(),
    legacySelectors(),
    legacyGrid(),
    autoprefixer({ overrideBrowserslist: [TARGET, 'android 4.4'] }),
  ]).process(css, { from: join(root, 'styles.css'), to: join(out, 'styles.css') });
  // @import only counts at the very top, so the fonts' import goes before dialog-polyfill's styles.
  const imports = styled.css.match(/^@import [^;]+;\n?/gm) || [];
  if (!imports.length) throw new Error('legacy styles: the fonts @import is missing');
  write(theme === 'dark' ? 'styles-dark.css' : 'styles.css', [...imports, read('node_modules/dialog-polyfill/dist/dialog-polyfill.css'), styled.css.replace(/^@import [^;]+;\n?/gm, ''), read('tools/legacy/legacy.css')].join('\n'));
}

// The page: same markup, files from legacy/ (the <base> keeps every other address, like ingredients.json, at the root).
// index.html's check that sends old browsers here stays out, or this page would send itself to itself.
let page = html
  .replace(/\s*<script id="old-browser-check">[\s\S]*?<\/script>/, '')
  .replace('<head>', '<head>\n    <base href="../" />')
  .replace('<link rel="stylesheet" href="styles.css" />', '<link rel="stylesheet" href="legacy/styles.css" id="legacy-styles" />')
  .replace('</title>', '</title>\n    <script src="legacy/polyfills.js"></script>');
for (const file of scripts) {
  page = page.replace(new RegExp(`<script(?: type="module")? src="${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`), `<script src="legacy/${legacyName(file)}" defer></script>`);
}
if (/<script type="module"|old-browser-check/.test(page) || !page.includes('legacy/polyfills.js') || !page.includes('<base href')) throw new Error('index.html changed; update tools/build-legacy.mjs');
write('index.html', page);
console.log(`Built legacy/ (${scripts.length} scripts, polyfills, styles) for ${TARGET}`);
