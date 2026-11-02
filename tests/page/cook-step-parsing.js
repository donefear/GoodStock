// Cook mode parsing (v4.7.1): names inside other names get their own amount, headings never swallow a time or a
// temperature, the oven heads-up only for oven temperatures, compound and fractional times, and step numbers and
// abbreviations inside a paragraph.
const fail = []; const log = [];
const plain = (text) => text.replace(/\u0001/g, '[').replace(/\u0002/g, ']');

// 1. Ingredient names inside other names.
const amounts = [
  [['1 cup milk', '2 cups coconut milk'], 'Heat the coconut milk. Add the milk.', 'Heat [2 cups of] coconut milk. Add [1 cup of] milk.'],
  [['2 cups coconut milk', '1 cup milk'], 'Heat the coconut milk. Add the milk.', 'Heat [2 cups of] coconut milk. Add [1 cup of] milk.'],
  [['100 g sugar', '50 g brown sugar'], 'Mix the brown sugar with the sugar.', 'Mix [50 g of] brown sugar with [100 g of] sugar.'],
  [['100 g sugar', '50 g brown sugar'], 'Mix the sugar with the brown sugar.', 'Mix [100 g of] sugar with [50 g of] brown sugar.'],
  [['2 eggs', '1 egg yolk'], 'Beat the egg yolk, then add the eggs.', 'Beat [1] egg yolk, then add [2] eggs.'],
  [['200 ml melk', '400 ml kokosmelk'], 'Verwarm de kokosmelk en voeg de melk toe.', 'Verwarm [400 ml] kokosmelk en voeg [200 ml] melk toe.'],
  [['卵 2個', '卵黄 1個'], '卵黄を混ぜ、卵を溶く。', '卵黄（[1個]）を混ぜ、卵（[2個]）を溶く。'],
  [['卵 2個', '卵黄 1個'], '卵を溶き、卵黄を混ぜる。', '卵（[2個]）を溶き、卵黄（[1個]）を混ぜる。'],
  [['鸡蛋 2个', '蛋黄 1个'], '把蛋黄和鸡蛋打散。', '把[1个]蛋黄和[2个]鸡蛋打散。'],
  [['100 г сахара', '50 г коричневого сахара'], 'Смешайте коричневый сахар и сахар.', 'Смешайте коричневый сахар ([50 г]) и сахар ([100 г]).'],
];
for (const [ingredients, text, want] of amounts) {
  const steps = [{ text }];
  addStepAmounts(steps, ingredients);
  const got = plain(steps[0].text);
  log.push(got);
  if (got !== want) fail.push(`amounts: ${text}\n   want: ${want}\n   got:  ${got}`);
  if (/[\u0005\u0006]/.test(steps[0].text)) fail.push(`working marks left in: ${got}`);
}

const show = (instructions) => buildCookBites({ id: `cook-parse-${Math.random()}`, name: 'Test', ingredients: [], instructions })
  .filter((bite) => bite.type === 'step')
  .map((bite) => `${bite.heading ? `[${bite.heading}] ` : ''}${plain(bite.text)}${bite.timer ? ` <${bite.timer.minutes}>` : ''}`);
const same = (label, got, want) => {
  log.push(`${label}: ${JSON.stringify(got)}`);
  if (JSON.stringify(got) !== JSON.stringify(want)) fail.push(`${label}\n   want: ${JSON.stringify(want)}\n   got:  ${JSON.stringify(got)}`);
};

// 2. Headings.
for (const line of ['Bake for 25 minutes', 'Oven 200°C', 'Simmer 1 hour', 'Bake at gas mark 4']) if (isStepHeading(line)) fail.push(`"${line}" is taken for a heading`);
for (const line of ['For the sauce', 'Saus:', 'For the topping:', 'Sauce']) if (!isStepHeading(line)) fail.push(`"${line}" is not a heading`);
same('headings', show(['For the sauce', 'Melt the butter in a pan.', 'Bake for 25 minutes', 'Saus:', 'Roer de room erdoor.', 'Serve hot']),
  ['[For the sauce] Melt the butter in a pan.', 'Bake for 25 minutes <25>', '[Saus] Roer de room erdoor.', 'Serve hot']);

// 4. Oven heads-up.
const headsUp = (instructions) => (show(instructions)[0].match(/^\[Heads-up\] .*?to (.+?) now/) || [])[1] || '';
const ovens = [
  [['Chop the onion.', 'Warm the milk to 37 °C.'], ''],
  [['Chop the onion.', 'Heat the oil to 180 °C and fry the fries.'], ''],
  [['Chop the onion.', 'Preheat the oven to 180 °C.'], '180°C'],
  [['Chop the onion.', 'Let it rise in the oven at 40°C.'], '40°C'],
  [['Chop the onion.', 'Bake at gas mark 4 for 30 minutes.'], 'gas mark 4'],
  [['Snijd de ui.', 'Bak de taart 30 minuten op 180 graden.'], '180 graden'],
  [['Chop the onion.', 'Oven 200°C'], '200°C'],
];
for (const [instructions, want] of ovens) {
  const got = headsUp(instructions);
  log.push(`oven: ${instructions[1]} → ${got || 'none'}`);
  if (got !== want) fail.push(`oven heads-up for "${instructions[1]}": want ${want || 'none'}, got ${got || 'none'}`);
}

// 5. Times.
const times = [
  ['Cook for 1 hour 30 min until tender.', 90], ['Simmer 1 hr 15 mins.', 75], ['Braise for 1 hour and 20 minutes.', 80],
  ['Simmer 1½ hours.', 90], ['Roast 2½ hours.', 150], ['Roast for an hour.', 60], ['Cook for half an hour.', 30],
  ['Laat een uur rijzen.', 60], ['Laat een half uur rusten.', 30], ['Simmer for 10-15 minutes.', 10], ['Bak 1,5 uur in de oven.', 90],
  ['Rest for 30 seconds.', 0.5], ['Add the minced garlic.', null], ['Bake for 1 hour, then rest 10 minutes.', 60],
];
for (const [text, want] of times) {
  const got = stepMinutes(text);
  log.push(`${text} → ${got ? `${got.minutes} (“${got.label}”)` : 'none'}`);
  if ((got ? got.minutes : null) !== want) fail.push(`time "${text}": want ${want}, got ${got ? got.minutes : null}`);
}

// 6. Step numbers and abbreviations inside a paragraph.
same('numbered', splitIntoBites('1. Mix the flour and sugar well. 2. Add the eggs one by one. 3. Bake for 30 minutes.'),
  ['Mix the flour and sugar well.', 'Add the eggs one by one.', 'Bake for 30 minutes.']);
same('abbreviations', splitIntoBites('Cut the carrots into approx. 1.5 cm pieces and set aside. Add cheese, e.g. Gouda or Edam, and stir it in well.'),
  ['Cut the carrots into approx. 1.5 cm pieces and set aside.', 'Add cheese, e.g. Gouda or Edam, and stir it in well.']);
same('Dutch abbreviations', splitIntoBites('Doe er bijv. wat peper en zout bij. Laat het ca. 5 minuten rustig staan.'),
  ['Doe er bijv. wat peper en zout bij.', 'Laat het ca. 5 minuten rustig staan.']);
same('unit at the end', splitIntoBites('Fry the onions in the butter for 10 min. Then add the garlic and stir well.'),
  ['Fry the onions in the butter for 10 min.', 'Then add the garlic and stir well.']);
return { fail, log };
