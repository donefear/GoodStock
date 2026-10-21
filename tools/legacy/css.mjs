// PostCSS passes for legacy/styles.css (see tools/build-legacy.mjs). Old WebViews (Chrome 30–56) have no CSS grid,
// min()/max()/clamp(), 8-digit hex colours or :focus-visible; these add fallbacks next to the real rules, so an
// engine that does know the new feature still uses it.

// Split "a, b(c, d)" on top-level commas or spaces.
function splitTop(value, separator) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0 && (separator === ' ' ? /\s/.test(char) : char === separator)) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const RELATIVE = /%|vw|vh|calc\(/;
const SYMBOL_FONTS = "'Noto Sans Symbols 2', 'Noto Sans Symbols', 'Noto Sans Math', 'Noto Emoji'";

// min(a, b) → the fixed length (px/rem/em), max(a, b) → its first plain length, clamp(a, b, c) → b (the preferred
// size). env() falls away. Returns the value without any of these functions, or null when nothing changed.
function plainValue(value) {
  let result = value;
  for (let guard = 0; guard < 20; guard++) {
    const match = /(min|max|clamp)\(/.exec(result);
    if (!match) break;
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < result.length; end++) {
      if (result[end] === '(') depth += 1;
      if (result[end] === ')' && --depth === 0) break;
    }
    const args = splitTop(result.slice(match.index + match[0].length, end), ',').filter((arg) => !/^env\(/.test(arg));
    let chosen = args[0] || '0';
    if (match[1] === 'min') chosen = args.find((arg) => !RELATIVE.test(arg)) || args[0];
    if (match[1] === 'clamp' && args.length === 3) chosen = args[1];
    result = result.slice(0, match.index) + chosen + result.slice(end + 1);
  }
  return result === value ? null : result;
}

export const legacyValues = () => ({
  postcssPlugin: 'goodstock-legacy-values',
  Declaration(decl) {
    if (decl.legacyDone) return;
    // #rrggbbaa → rgba()
    const hex = decl.value.replace(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})\b/gi, (all, r, g, b, a) =>
      `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${Math.round((parseInt(a, 16) / 255) * 100) / 100})`);
    if (hex !== decl.value) decl.value = hex;
    // Symbol fonts (fonts/legacy) before the generic family: old Android fonts lack the app's icon symbols.
    if ((decl.prop === 'font-family' || decl.prop === 'font') && /(^|,|\s)(sans-serif|serif)$/.test(decl.value) && !decl.value.includes('Noto Emoji')) {
      decl.value = decl.value.replace(/(sans-serif|serif)$/, `${SYMBOL_FONTS}, $1`);
    }
    if (/\b(min|max|clamp)\(/.test(decl.value) && !decl.prop.startsWith('grid')) {
      const plain = plainValue(decl.value);
      if (plain === null) return;
      // width: min(640px, calc(100% - 20px)) → width: calc(100% - 20px); max-width: 640px
      const sized = /^(width|height)$/.exec(decl.prop) && /^min\((.*)\)$/.exec(decl.value.trim());
      const args = sized ? splitTop(sized[1], ',') : [];
      if (sized && args.length === 2 && args.some((arg) => RELATIVE.test(arg)) && args.some((arg) => !RELATIVE.test(arg))) {
        const relative = args.find((arg) => RELATIVE.test(arg));
        const fixed = args.find((arg) => !RELATIVE.test(arg));
        decl.cloneBefore({ value: relative }).legacyDone = true;
        const limit = `max-${decl.prop}`;
        if (!decl.parent.some((other) => other.prop === limit)) decl.cloneBefore({ prop: limit, value: fixed }).legacyDone = true;
      } else {
        decl.cloneBefore({ value: plain }).legacyDone = true;
      }
      decl.legacyDone = true;
    }
  },
});

// Theme colours written out. Old engines have no custom properties, so tools/build-legacy.mjs makes two stylesheets,
// one with the light values (:root) and one with the dark ones (:root[data-theme="dark"]), and tools/legacy/dom.js
// switches between them with data-theme. Every var() of a theme colour is replaced; print styles keep theirs.
export const legacyThemeValues = (theme) => ({
  postcssPlugin: 'goodstock-legacy-theme-values',
  Once(root) {
    const values = { light: {}, dark: {} };
    root.walkRules((rule) => {
      if (rule.parent.type !== 'root') return;
      const target = rule.selector === ':root' ? values.light : rule.selector === ':root[data-theme="dark"]' ? values.dark : null;
      if (target) rule.walkDecls(/^--/, (decl) => { target[decl.prop] = decl.value; });
    });
    if (!Object.keys(values.dark).length) throw new Error('legacy styles: no :root[data-theme="dark"] colours found');
    const chosen = theme === 'dark' ? { ...values.light, ...values.dark } : values.light;
    root.walkDecls((decl) => {
      if (decl.prop.startsWith('--') || !/var\(--/.test(decl.value)) return;
      for (let parent = decl.parent; parent; parent = parent.parent) if (parent.type === 'atrule' && /print/.test(parent.params)) return;
      decl.value = decl.value.replace(/var\((--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (all, name) => (name in values.dark ? chosen[name] : all));
    });
  },
});

// A selector list with one selector an old engine doesn't know is dropped whole; give those selectors rules of their own.
const NEWER_SELECTORS = /:focus-visible|:focus-within|:is\(|:where\(|:has\(|::backdrop|:placeholder-shown|:any-link/;

export const legacySelectors = () => ({
  postcssPlugin: 'goodstock-legacy-selectors',
  Rule(rule) {
    if (rule.legacyDone || !NEWER_SELECTORS.test(rule.selector)) return;
    rule.legacyDone = true;
    const selectors = rule.selectors;
    // dialog-polyfill draws the backdrop as a sibling element.
    for (const selector of selectors) {
      if (selector.includes('::backdrop')) rule.cloneBefore({ selector: selector.replace('::backdrop', ' + .backdrop') }).legacyDone = true;
    }
    if (selectors.length < 2) return;
    for (const selector of selectors) rule.cloneBefore({ selector }).legacyDone = true;
    rule.remove();
  },
});

// CSS grid → flexbox under html.no-grid (set by tools/legacy/dom.js when the engine lacks grid).
function tracksOf(template) {
  const tracks = [];
  for (const part of splitTop(template, ' ')) {
    const repeat = /^repeat\(\s*([^,]+),(.*)\)$/.exec(part);
    if (!repeat) { tracks.push(part); continue; }
    const inner = splitTop(repeat[2].trim(), ' ');
    if (/auto-(fill|fit)/.test(repeat[1])) return { autoFill: inner[0] };
    for (let i = 0; i < Number(repeat[1]); i++) tracks.push(...inner);
  }
  return { tracks };
}

function trackKind(track) {
  const minmax = /^minmax\(([^,]+),(.*)\)$/.exec(track);
  const max = minmax ? minmax[2].trim() : track;
  const fr = /^([\d.]+)fr$/.exec(max);
  if (fr) return { fr: Number(fr[1]) };
  if (max === 'auto' || /content/.test(max)) return { auto: true };
  return { fixed: max };
}

function gapsOf(rule, known) {
  let row = known ? known.row : '0px';
  let column = known ? known.column : '0px';
  rule.each((decl) => {
    if (decl.type !== 'decl') return;
    if (decl.prop === 'gap' || decl.prop === 'grid-gap') {
      const [first, second] = splitTop(decl.value, ' ');
      row = first;
      column = second || first;
    }
    if (decl.prop === 'row-gap' || decl.prop === 'grid-row-gap') row = decl.value;
    if (decl.prop === 'column-gap' || decl.prop === 'grid-column-gap') column = decl.value;
  });
  return { row, column };
}

const zero = (length) => /^0(px|rem|em)?$/.test(length);

export const legacyGrid = () => {
  const grids = new Map();
  return {
    postcssPlugin: 'goodstock-legacy-grid',
    Rule(rule, { Rule: NewRule }) {
      if (rule.legacyDone || rule.parent.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
      const decls = rule.nodes.filter((node) => node.type === 'decl');
      const display = decls.find((decl) => decl.prop === 'display');
      const template = decls.find((decl) => decl.prop === 'grid-template-columns');
      const isGrid = display && /^(inline-)?grid$/.test(display.value);
      const known = rule.selectors.map((selector) => grids.get(selector)).find(Boolean);
      if (!isGrid && !template && !(known && decls.some((decl) => /gap$/.test(decl.prop)))) return;
      if (display && !isGrid) return;
      rule.legacyDone = true;
      const gap = gapsOf(rule, known);
      const columns = template ? tracksOf(template.value) : known && known.columns || null;
      for (const selector of rule.selectors) grids.set(selector, { row: gap.row, column: gap.column, columns });

      const added = [];
      const add = (selector, props) => {
        // The container's own fallback goes into the rule itself, so it keeps the rule's weight and order (a later
        // ".x:empty { display: none }" still wins). An engine with grid ignores flex-direction and flex-wrap, and
        // display: grid comes after display: flex.
        if (!selector) {
          for (const [prop, value] of Object.entries(props)) {
            if (prop === 'display' && !isGrid) continue;
            const decl = { prop, value };
            if (isGrid) display.cloneBefore(decl).legacyDone = true; else rule.append(decl);
          }
          const place = decls.find((decl) => decl.prop === 'place-items' && /^center/.test(decl.value));
          if (place) rule.append({ prop: 'justify-content', value: 'center' }, { prop: 'align-items', value: 'center' });
          return;
        }
        const extra = new NewRule({ selectors: rule.selectors.map((one) => `html.no-grid ${one}${selector}`) });
        for (const [prop, value] of Object.entries(props)) extra.append({ prop, value });
        extra.legacyDone = true;
        added.push(extra);
      };

      if (!columns || columns.tracks && columns.tracks.length === 1) {
        // One column: stack the children.
        add('', { display: 'flex', 'flex-direction': 'column', 'flex-wrap': 'nowrap' });
        add(' > :nth-child(n)', { 'margin-left': '0', 'margin-right': '0', 'margin-bottom': gap.row, width: 'auto' });
        add(' > :last-child', { 'margin-bottom': '0' });
      } else if (columns.autoFill) {
        const min = trackKind(columns.autoFill);
        const basis = /^minmax\(([^,]+),/.exec(columns.autoFill);
        add('', { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap' });
        add(' > :nth-child(n)', { flex: `1 1 ${basis ? basis[1].trim() : min.fixed || '150px'}`, 'min-width': '0', 'box-sizing': 'border-box', 'margin-left': '0', 'margin-right': gap.column, 'margin-bottom': gap.row, width: 'auto' });
      } else {
        const tracks = columns.tracks.map(trackKind);
        const count = tracks.length;
        const totalFr = tracks.reduce((sum, track) => sum + (track.fr || 0), 0) || 1;
        const fixed = tracks.filter((track) => track.fixed).map((track) => track.fixed);
        const hasAuto = tracks.some((track) => track.auto);
        const free = ['100%', ...fixed, ...(zero(gap.column) ? [] : [`${count - 1} * ${gap.column}`])].join(' - ');
        add('', { display: 'flex', 'flex-direction': 'row', 'flex-wrap': hasAuto ? 'nowrap' : 'wrap' });
        add(' > :nth-child(n)', { 'box-sizing': 'border-box', 'min-width': '0', 'margin-left': '0', 'margin-bottom': gap.row, 'margin-right': gap.column });
        tracks.forEach((track, index) => {
          const nth = ` > :nth-child(${count}n+${index + 1})`;
          const width = track.fr ? `calc((${free}) * ${Math.floor((track.fr / totalFr) * 10000) / 10000})` : track.fixed || 'auto';
          add(nth, { flex: track.fr && hasAuto ? `${track.fr} 1 0%` : '0 0 auto', width, ...(index === count - 1 ? { 'margin-right': '0' } : {}) });
        });
      }
      let after = rule;
      for (const extra of added) { after.after(extra); after = extra; }
    },
  };
};
