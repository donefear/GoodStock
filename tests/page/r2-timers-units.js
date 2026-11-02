// r2: timers keep their texts in step with what they are (+1 min, language changes), French spoons keep their unit
// in the steps, the converter reads "350F", gas marks stay in range, "timer" is hours only in Danish, counted units
// are shown in the app's language, and the restore summary counts in every language.
const fail = []; const log = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
const kitchenBefore = JSON.stringify(state);
const timersBefore = cookTimers;

// 10a. A finished 1-second timer extended by a minute says "1 min", not "1 sec".
cookTimers = [];
startCustomTimer('', 1);
const short = cookTimers[0];
short.endsAt = Date.now() - 10;
refreshTimers();
extendTimer(short.id);
log.push(`extended: ${timerTitle(short)} · ${timerLabel(short)}`);
if (timerLabel(short) !== '1 min') fail.push(`extended timer label: ${timerLabel(short)}`);
// 10b. A built-in preset started in English follows a switch to Russian.
cookTimers = [];
startCustomTimer('Pasta', 600, 'Pasta');
startCustomTimer('', 90);
await setLanguage('ru');
const [pasta, plain] = cookTimers;
log.push(`in Russian: ${timerTitle(pasta)} · ${timerLabel(pasta)} | ${timerTitle(plain)} · ${timerLabel(plain)}`);
if (timerLabel(pasta) !== t('{minutes} min', { minutes: 10 })) fail.push(`label not in the new language: ${timerLabel(pasta)}`);
if (timerLabel(plain) !== t('{minutes} min {seconds} sec', { minutes: 1, seconds: 30 })) fail.push(`unnamed timer label not re-translated: ${timerLabel(plain)}`);
if (timerTitle(pasta) !== t('Pasta')) fail.push(`preset name not re-translated: ${timerTitle(pasta)}`);
// 14. Counted units in Russian rows (display only; the stored unit stays).
state.inventory = [{ id: 'u1', name: 'Tomatoes', quantity: 2, unit: 'can', location: state.locations[0], kind: 'Food' }, { id: 'u2', name: 'Soap', quantity: 1, unit: 'bottle', location: state.locations[0], kind: 'Household' }];
activeView = 'inventory';
render();
const rows = [...document.querySelectorAll('.stepper-amount small')].map((el) => el.textContent);
log.push(`Russian units: ${rows.join(', ')} / ${amountText(2, 'can')} / ${amountText(500, 'g')}`);
if (tp(2, 'can', 'cans') !== 'cans' && !rows.includes(tp(2, 'can', 'cans'))) fail.push(`can not translated in the row: ${rows}`);
if (state.inventory[0].unit !== 'can') fail.push('the stored unit changed');
if (amountText(500, 'g') !== '500 g' || amountText(1, 'tbsp') !== '1 tbsp') fail.push('a measured unit was translated');
await setLanguage('en');
if (amountText(2, 'can') !== '2 cans' || amountText(1, 'bottle') !== '1 bottle' || amountText(3, 'pcs') !== '3 pcs') fail.push(`English counted units: ${amountText(2, 'can')}, ${amountText(1, 'bottle')}`);
cookTimers = timersBefore;
refreshTimers();

// 11. Spoons in other languages.
const spoons = [['2 cuillères à soupe d’huile', 'tbsp', 'huile'], ['1 cuillère à café de sel', 'tsp', 'sel'], ['1 c. à s. de sucre', 'tbsp', 'sucre'], ['2 colheres de sopa de azeite', 'tbsp', 'azeite'],
  ['2 EL Öl', 'tbsp', 'Öl'], ['1 TL Salz', 'tsp', 'Salz'], ['2 Esslöffel Zucker', 'tbsp', 'Zucker'], ['1 Teelöffel Zimt', 'tsp', 'Zimt'], ['2 cucharadas de aceite', 'tbsp', ''], ['1 cucchiaino di sale', 'tsp', ''], ['2 cucchiai di olio', 'tbsp', ''], ['1 eetlepel olie', 'tbsp', 'olie'], ['1 tl zout', 'tsp', 'zout']];
for (const [line, unit, name] of spoons) {
  const parsed = parseIngredient(line);
  log.push(`${line} → ${parsed.amount} ${parsed.unit} (${parsed.unitText}) ${parsed.name}`);
  if (parsed.unit !== unit || (name && parsed.name !== name)) fail.push(`${line}: got ${parsed.unit} / ${parsed.name}`);
}
const steps = [{ text: 'Faites chauffer l’huile dans une poêle.' }];
addStepAmounts(steps, ['2 cuillères à soupe d’huile']);
const step = steps[0].text.replace(/[\u0001\u0002]/g, '');
log.push(`French step: ${step}`);
if (!/2 cuillères à soupe d[’']huile/.test(step)) fail.push(`French spoon lost in the step: ${step}`);

// 12. Converter: "350F" with °C picked, gas mark 0 and 10.
activeView = 'tools';
toolsTab = 'convert';
render();
const temperature = (value, unit) => { temperatureInput.value = value; temperatureInput.unit = unit; updateTemperature(); return $('#temp-results').textContent; };
const f350 = temperature('350F', 'c');
log.push(`350F with °C picked: ${f350}`);
if (!/175 °C/.test(f350) || !/350 °F/.test(f350)) fail.push(`350F not read as Fahrenheit: ${f350}`);
if (!/175 °C/.test(temperature('350 °F', 'c'))) fail.push('"350 °F" not read as Fahrenheit');
const gas0 = temperature('0', 'gas');
log.push(`gas 0: ${gas0}`);
if (/Gas ½/.test(gas0) || /130 °C/.test(gas0)) fail.push(`gas 0 gave a temperature: ${gas0}`);
if (!/180 °C/.test(temperature('4', 'gas'))) fail.push('gas 4 is not 180 °C');
if (!/160 °C/.test(temperature('2.5', 'gas'))) fail.push(`gas 2.5 not between 2 and 3: ${temperature('2.5', 'gas')}`);
if (!/–/.test(temperature('50', 'c'))) fail.push('50 °C still gets a gas mark');
temperature('180', 'c');

// 13. "timer" is hours only in Danish or Norwegian.
const useTimer = stepMinutes('Use 1 timer.');
const danish = stepMinutes('Lad det simre i 2 timer.');
const both = stepMinutes('Set 1 timer and bake for 25 minutes.');
log.push(`Use 1 timer → ${JSON.stringify(useTimer)}; Danish → ${JSON.stringify(danish)}; both → ${JSON.stringify(both)}`);
if (useTimer) fail.push('"Use 1 timer." became a timer');
if (!danish || danish.minutes !== 120) fail.push('Danish "2 timer" is not 2 hours');
if (!both || both.minutes !== 25) fail.push('the time after "1 timer" was not found');
if (/<mark>1 timer<\/mark>/.test(highlightStepText('Use 1 timer.'))) fail.push('"1 timer" highlighted as a time');

// 15. The restore summary in languages with several plural forms.
for (const code of ['ru', 'pl', 'ar', 'en']) {
  await setLanguage(code);
  const texts = [1, 2, 5].map((count) => kitchenSummary(count, count));
  log.push(`${code}: ${texts.join(' | ')}`);
  if (texts.some((text) => /\{count\}|\{items\}|\{recipes\}/.test(text))) fail.push(`${code}: summary placeholder left: ${texts}`);
}
await setLanguage('en');

state = normalizeState(JSON.parse(kitchenBefore));
activeView = 'inventory';
persist();
return { fail, log };
