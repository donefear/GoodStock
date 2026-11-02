// Phone layout under zoom (4.8): media queries measure real pixels, but the text size zooms the page, so an 800px
// tablet at Large text is only ~615 CSS pixels wide. The app then sets html.compact-layout (CSS width ≤ 720px), and
// every rule of each `@media (max-width: 720px)` block in styles.css has a copy prefixed with .compact-layout right
// after the block. This test checks those copies are complete and up to date.
//
// After changing a 720px block: `node tests/e2e/layout-compact-css.mjs --write` rewrites the copies.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STYLES = join(root, 'styles.css');
const START = '/* html.compact-layout: the same rules as the 720px block above (made by tests/e2e/layout-compact-css.mjs --write). */';
const END = '/* end of html.compact-layout copy */';
const PHONE = /^\(\s*max-width:\s*720px\s*\)$/;

// .x → .compact-layout .x; :root[…] .x → :root.compact-layout[…] .x; [dir="rtl"] .x → .compact-layout[dir="rtl"] .x
export function compactSelector(selector) {
  if (selector.startsWith(':root')) return `:root.compact-layout${selector.slice(5)}`;
  if (/^html\b/.test(selector)) return `html.compact-layout${selector.slice(4)}`;
  if (selector.startsWith('[dir=') || /^\.(no-flex-gap|no-grid|is-standalone|is-hosted)\b/.test(selector)) return `.compact-layout${selector}`;
  return `.compact-layout ${selector}`;
}

function ruleText(rule, indent) {
  const declarations = [];
  rule.each((node) => { if (node.type === 'decl') declarations.push(`${node.prop}: ${node.value}${node.important ? ' !important' : ''}`); });
  return `${indent}${rule.selectors.map(compactSelector).join(', ')} { ${declarations.join('; ')}; }`;
}

function copyOf(container, indent = '') {
  const lines = [];
  container.each((node) => {
    if (node.type === 'rule') lines.push(ruleText(node, indent));
    else if (node.type === 'atrule' && node.name === 'supports') lines.push(`${indent}@supports ${node.params} {`, ...copyOf(node, `${indent}  `), `${indent}}`);
    else if (node.type === 'atrule') throw new Error(`layout-compact-css: no copy for @${node.name} inside a 720px block`);
  });
  return lines;
}

// styles.css as it should be: old copies removed, a fresh copy after every 720px block.
export function withCompactCopies(css) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = css.replace(new RegExp(`${escape(START)}[\\s\\S]*?${escape(END)}\\n`, 'g'), '');
  const inserts = [];
  postcss.parse(stripped).each((node) => {
    if (node.type !== 'atrule' || node.name !== 'media' || !PHONE.test(node.params.trim())) return;
    inserts.push({ at: node.source.end.offset + 1, text: [START, ...copyOf(node), END, ''].join('\n') });
  });
  let result = stripped;
  for (const { at, text } of inserts.reverse()) result = result.slice(0, at) + text + result.slice(at);
  return result;
}

export default async function run() {
  const css = readFileSync(STYLES, 'utf8');
  const fail = [];
  // tools/check-chrome81.mjs still notices :focus-visible in a selector list (Chrome 81 drops the whole rule).
  const { checkStyles } = await import('../../tools/check-chrome81.mjs');
  if (checkStyles('.a:hover, .a:focus-visible { color: red; }\n.b:focus:not(:focus-visible) { outline: none; }').length !== 1) fail.push('check-chrome81 missed :focus-visible in a selector list');
  // tools/legacy/css.mjs turns grid tracks into flexbox and cannot read min()/max()/clamp() inside them (the old
  // tablet copy then loses every rule after it).
  postcss.parse(css).walkDecls(/^grid-template-columns$/, (decl) => {
    if (/\b(min|max|clamp)\(/.test(decl.value.replace(/minmax\(/g, ''))) fail.push(`styles.css line ${decl.source.start.line}: min()/max()/clamp() in grid-template-columns breaks the legacy build`);
  });
  const wanted = withCompactCopies(css);
  if (wanted === css) return { fail, log: ['every 720px block has its html.compact-layout copy'] };
  const have = css.split('\n');
  const want = wanted.split('\n');
  let line = 0;
  while (line < have.length && have[line] === want[line]) line += 1;
  return { fail: [...fail, `styles.css line ${line + 1}: the html.compact-layout copies are out of date (expected "${(want[line] || '').slice(0, 120)}"); run node tests/e2e/layout-compact-css.mjs --write`] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--write')) {
  const css = readFileSync(STYLES, 'utf8');
  const wanted = withCompactCopies(css);
  if (wanted !== css) writeFileSync(STYLES, wanted);
  console.log(wanted === css ? 'styles.css: copies already up to date' : 'styles.css: compact-layout copies written');
}
