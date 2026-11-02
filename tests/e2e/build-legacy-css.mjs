// The legacy stylesheet passes (tools/legacy/css.mjs): min()/max()/clamp() anywhere in a value (flex, grid tracks,
// padding) get a plain fallback without cutting the value in half. An unbalanced "(" in the output would make old
// engines drop every later rule without an error, so checkBalanced has to catch a planted one, and the rule after
// the tricky ones (.d) has to survive.
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import customProperties from 'postcss-custom-properties';
import logical from 'postcss-logical';
import { checkBalanced, legacyGrid, legacySelectors, legacyThemeValues, legacyValues, plainValue } from '../../tools/legacy/css.mjs';

const SAMPLE = ':root{--x:1px}:root[data-theme="dark"]{--x:2px}'
  + '.a{flex:1 1 min(140px,100%)}'
  + '.b{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr));gap:8px}'
  + '.c{padding:clamp(8px,2vw,20px)}'
  + '.e{grid-template-columns:minmax(min(200px,100%),1fr) minmax(0,2fr);display:grid}'
  + '.f{margin:0 max(4px,env(safe-area-inset-bottom)) 0 min(10px,5vw)}'
  + '.d{color:red}';

export default async () => {
  const fail = [];
  const log = [];
  const check = (ok, message) => { if (!ok) fail.push(message); };

  for (const [theme, direction] of [['light', 'ltr'], ['dark', 'rtl']]) {
    let css = '';
    try {
      css = (await postcss([
        legacyThemeValues(theme),
        customProperties({ preserve: true }),
        logical({ inlineDirection: direction === 'rtl' ? 'right-to-left' : 'left-to-right' }),
        legacyValues(),
        legacySelectors(),
        legacyGrid(direction),
        autoprefixer({ overrideBrowserslist: ['chrome 30', 'android 4.4'] }),
      ]).process(SAMPLE, { from: undefined })).css;
    } catch (error) {
      fail.push(`${theme}/${direction}: the passes threw: ${error.message}`);
      continue;
    }
    log.push(`${theme}/${direction}: ${css.replace(/\s+/g, ' ')}`);
    try { checkBalanced(css, 'sample'); } catch (error) { fail.push(`${theme}/${direction}: ${error.message}`); }
    // Parsed again, the rules are all there and .d keeps its colour.
    const rules = {};
    postcss.parse(css).walkRules((rule) => { rules[rule.selector] = (rules[rule.selector] || []).concat(rule.nodes.filter((node) => node.type === 'decl').map((decl) => `${decl.prop}:${decl.value}`)); });
    const has = (selector, decl) => (rules[selector] || []).some((one) => one.replace(/\s+/g, '') === decl.replace(/\s+/g, ''));
    check(has('.d', 'color:red'), `${theme}/${direction}: .d{color:red} did not survive`);
    check(has('.a', 'flex:1 1 140px') && has('.a', 'flex:1 1 min(140px,100%)'), `${theme}/${direction}: .a has no plain flex fallback before the min() one`);
    check(has('.b', 'grid-template-columns:repeat(auto-fit,minmax(160px,1fr))'), `${theme}/${direction}: .b has no plain grid template for engines with grid but without min()`);
    check(has('html.no-grid .b > :nth-child(n)', 'flex:1 1 160px'), `${theme}/${direction}: .b's flexbox fallback is not flex: 1 1 160px`);
    check(has('.c', 'padding:2vw') && has('.c', 'padding:clamp(8px,2vw,20px)'), `${theme}/${direction}: .c has no plain padding fallback`);
    check(has('.f', 'margin:0 4px 0 10px'), `${theme}/${direction}: .f has no plain margin fallback`);
    check(Object.keys(rules).some((selector) => selector.startsWith('html.no-grid .e > :nth-child(2n+1)')), `${theme}/${direction}: .e's two tracks got no flexbox fallback`);
    check(!/min\(\d+px;|minmax\(min\(\d+px[;}]/.test(css), `${theme}/${direction}: a min() was cut in half`);
  }

  // Plain values on their own, and "minmax(" is not mistaken for "max(".
  check(plainValue('minmax(0, 1fr)') === null, `plainValue changed minmax(0, 1fr) into ${plainValue('minmax(0, 1fr)')}`);
  check(plainValue('repeat(auto-fill, minmax(min(160px, 100%), 1fr))') === 'repeat(auto-fill, minmax(160px, 1fr))', `plainValue in a grid template: ${plainValue('repeat(auto-fill, minmax(min(160px, 100%), 1fr))')}`);
  // The check itself: the old bug's output, a stray ")" and a fine stylesheet with url(), strings and comments.
  const throws = (css) => { try { checkBalanced(css); return false; } catch { return true; } };
  check(throws('.a{flex:1 1 min(140px;}.d{color:red}'), 'checkBalanced missed "flex: 1 1 min(140px;"');
  check(throws('.a{width:calc(100% - 2px));}'), 'checkBalanced missed a stray ")"');
  check(!throws('@import url(\'x.css\');.a{background:url(data:image/svg+xml;utf8,<svg>);content:"(";}/* ( */.d{color:red}'), 'checkBalanced rejected a balanced stylesheet');
  return { fail, log };
};
