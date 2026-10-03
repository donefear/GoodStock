const fail = []; const log = [];
const item = (name, checked = false) => ({ id: makeId(), name, quantity: 1, unit: '', checked, source: 'Test' });
state.shopping = [item('Milk'), item('Dish soap'), item('Kartoffeln'), item('Appels', true), item('Harina'), item('Chicken'), item('Basil')];
activeView = 'shopping';
render();
const headings = [...document.querySelectorAll('.shopping-group')].map((h) => h.textContent.trim());
const order = [...document.querySelectorAll('.shopping-list > *')].map((el) => (el.classList.contains('shopping-group') ? `# ${el.textContent.trim()}` : el.querySelector('.shopping-name').textContent));
log.push(order.join(' | '));
const want = ['Vegetables', 'Fruit', 'Herbs', 'Baking', 'Dairy', 'Meat and fish', 'Other'];
if (headings.map((h) => h.replace(/\s+\S+$/, '')).join() !== want.join()) fail.push(`groups in wrong order: ${headings.join(', ')}`);
if (!headings.some((h) => /^Fruit ✓$/.test(h))) fail.push('a group with everything checked should show ✓');
// One group only: no headings.
state.shopping = [item('Milk'), item('Butter')];
render();
if (document.querySelectorAll('.shopping-group').length) fail.push('a single group should not get a heading');
return { fail, log };
