// Printing (0.14): Print buttons on the recipe page and the shopping list open the print dialog, and the print
// styles exist. tests/e2e/print-layout.mjs looks at the page as printed.
const fail = []; const log = [];
const kitchenBefore = JSON.stringify(state);
let printed = 0;
window.print = () => { printed += 1; };
state.shopping = [{ id: 'a', name: 'Milk', quantity: 1, unit: 'l', checked: false }, { id: 'b', name: 'Bread', quantity: 1, unit: '', checked: true }];
activeView = 'shopping';
render();
const shoppingPrint = document.querySelector('.shopping-heading-actions [data-action="print"]');
if (!shoppingPrint) fail.push('no Print button on the shopping list');
shoppingPrint?.click();
if (printed !== 1) fail.push('Print did not open the print dialog');
if (!document.querySelector('.print-footer')) fail.push('no print footer on the shopping list');

openRecipePage(state.recipes[0].id);
const recipePrint = document.querySelector('.recipe-page-links [data-action="print"]');
if (!recipePrint) fail.push('no Print button on the recipe page');
recipePrint?.click();
if (printed !== 2) fail.push('recipe Print did not open the print dialog');

const rules = [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules]; } catch { return []; } })
  .filter((rule) => rule.media && /print/.test(rule.media.mediaText)).map((rule) => rule.cssText).join('\n');
for (const selector of ['.sidebar', '.topbar', '.recipe-page-actions', '.shopping-row.checked']) if (!rules.includes(selector)) fail.push(`print styles do not hide ${selector}`);
state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
