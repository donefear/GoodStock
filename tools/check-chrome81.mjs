// The kitchen tablet runs Chrome 81 (CLAUDE.md, "Browser support"). A quick static check over every file the browser
// loads, in a second instead of the Chromium 80 run's minute, that also covers code paths that run rarely:
//   1. each script parses as ES2021 and has none of its logical assignments, so no ??=, ||=, &&=, class fields,
//      private #names, regex flags d or v, or top-level await (numeric separators like 20_000 are fine since Chrome 75);
//   2. no calls Chrome 81 lacks (replaceAll, .at(), Object.hasOwn, structuredClone, …), found in the code itself, not in
//      comments or strings;
//   3. styles.css has no inset, inset-inline or inset-block (use top, right, bottom and left).
// `node tools/check-chrome81.mjs` prints what it finds and exits 1; `npm test` runs it.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, tokenizer } from 'acorn';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inFolder = (folder, extension) => readdirSync(join(root, folder)).filter((file) => file.endsWith(extension)).map((file) => `${folder}/${file}`);
const scripts = ['i18n.js', 'kitchen-tools.js', 'kitchen-reference.js', 'sw.js', ...inFolder('app', '.js'), ...inFolder('lang', '.js')];
const modules = ['recipe-import.mjs', 'mealie.mjs', 'deepl.mjs'];

// Name → the Chrome version that brought it: a method call (".at("), a global ("structuredClone") or a static one.
const table = (entries) => Object.assign(Object.create(null), entries);
const NEWER_METHODS = table({ replaceAll: 85, at: 92, findLast: 97, findLastIndex: 97, toSorted: 110, toReversed: 110, toSpliced: 110, isWellFormed: 111, toWellFormed: 111, hasOwn: 93, groupBy: 117, fromAsync: 121 });
const NEWER_GLOBALS = table({ structuredClone: 98, AggregateError: 85, WeakRef: 84, FinalizationRegistry: 84 });
const NEWER_STATIC = table({ 'Promise.any': 85, 'Intl.Segmenter': 87 });
const LOGICAL_ASSIGNMENTS = ['??=', '||=', '&&='];

export function checkScript(code, sourceType = 'script') {
  const options = { ecmaVersion: 2021, sourceType, allowHashBang: true, locations: true };
  const problems = [];
  try {
    parse(code, options);
  } catch (error) {
    problems.push(`line ${error.loc ? error.loc.line : '?'}: too new (${error.message.replace(/ \(\d+:\d+\)$/, '')})`);
    return problems;
  }
  const tokens = [...tokenizer(code, options)];
  tokens.forEach((token, index) => {
    const line = token.loc.start.line;
    if (token.type.label === '_=' && LOGICAL_ASSIGNMENTS.includes(token.value)) problems.push(`line ${line}: ${token.value} needs Chrome 85`);
    if (token.type.label !== 'name') return;
    const before = tokens[index - 1];
    const after = tokens[index + 1];
    const called = after && after.type.label === '(';
    const property = before && before.type.label === '.';
    const owner = property ? tokens[index - 2] : null;
    const declared = before && ['const', 'let', 'var', 'function'].includes(before.value);
    if (property && called && NEWER_METHODS[token.value]) problems.push(`line ${line}: .${token.value}() needs Chrome ${NEWER_METHODS[token.value]}`);
    if (!property && !declared && NEWER_GLOBALS[token.value]) problems.push(`line ${line}: ${token.value} needs Chrome ${NEWER_GLOBALS[token.value]}`);
    if (property && owner && NEWER_STATIC[`${owner.value}.${token.value}`]) problems.push(`line ${line}: ${owner.value}.${token.value} needs Chrome ${NEWER_STATIC[`${owner.value}.${token.value}`]}`);
  });
  return problems;
}

export function checkStyles(css) {
  const problems = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  withoutComments.split('\n').forEach((text, index) => {
    if (/(^|[{;\s])inset(-inline|-block)?(-start|-end)?\s*:/.test(text)) problems.push(`line ${index + 1}: inset needs Chrome 87; use top, right, bottom and left`);
  });
  return problems;
}

function main() {
  const problems = [];
  for (const file of [...scripts, ...modules]) {
    for (const problem of checkScript(readFileSync(join(root, file), 'utf8'), modules.includes(file) ? 'module' : 'script')) problems.push(`${file} ${problem}`);
  }
  for (const problem of checkStyles(readFileSync(join(root, 'styles.css'), 'utf8'))) problems.push(`styles.css ${problem}`);
  if (problems.length) {
    console.log(problems.join('\n'));
    process.exit(1);
  }
  console.log(`${scripts.length + modules.length} scripts and styles.css are fine for Chrome 81.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
