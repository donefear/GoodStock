// Tagalog (0.59): units with their linking "na"/"ng" ("2 tasang harina", "3 butil na bawang"), catalog names, cook-mode
// times and voice commands, kitchen tools, storage places, recipe headings and language; no DeepL target.
const fail = []; const log = [];
const lines = {
  '2 tasang harina': ['cup', 'harina', 'flour'],
  '1 kutsarang asukal': ['tbsp', 'asukal', 'sugar'],
  '1/2 kutsaritang asin': ['tsp', 'asin', 'salt'],
  '3 butil na bawang': ['clove', 'bawang', 'garlic'],
  '1 latang gatas': ['can', 'gatas', 'milk'],
  '2 pirasong sibuyas': ['pcs', 'sibuyas', 'onion'],
  '500 gramong manok': ['g', 'manok', 'chicken'],
  '1 kilo ng karne ng baka': ['kg', 'karne ng baka', 'beef'],
};
for (const [line, [unit, name, id]] of Object.entries(lines)) {
  const parsed = parseIngredient(line);
  if (parsed.unit !== unit || parsed.name !== name) fail.push(`${line}: ${parsed.unit} / ${parsed.name}`);
  const record = findIngredientRecord(parsed.name);
  if (record?.id !== id) fail.push(`${line}: catalog ${record?.id}`);
}
// Butter is not oil, sugar is not vinegar.
if (findIngredientRecord('mantikilya')?.id !== 'butter') fail.push(`mantikilya: ${findIngredientRecord('mantikilya')?.id}`);
if (findIngredientRecord('asukal')?.id !== 'sugar') fail.push('asukal is not sugar');

const time = TIME_PATTERN.exec('Pakuluan nang 10 hanggang 15 minuto.');
if (!time || time[1] !== '10' || time[2] !== '15') fail.push(`time range: ${time && time.slice(1, 4)}`);
if (!HOUR_UNIT.test((TIME_PATTERN.exec('Lutuin nang 2 oras.') || [])[3] || '')) fail.push('"oras" is not hours');
if (!VOICE_COMMANDS.next.test('susunod') || !VOICE_COMMANDS.back.test('bumalik') || !VOICE_COMMANDS.repeat.test('ulitin')) fail.push('Tagalog voice commands');

const tools = kitchenToolsIn('Igisa ang bawang sa kawali. Ilagay sa mangkok at takpan.').map((tool) => tool.id);
for (const id of ['skillet', 'bowl', 'lid']) if (!tools.includes(id)) fail.push(`tool ${id} not found: ${tools.join(', ')}`);
if (!FRIDGE_WORDS.test('Refrigerator') || !FRIDGE_WORDS.test('Ref') || FRIDGE_WORDS.test('Refill') || !PANTRY_WORDS.test('Paminggalan')) fail.push('storage places');

const recipe = parseRecipeText('Adobong manok\nMga sangkap\n1 kg manok\n3 butil na bawang\nParaan ng pagluluto\nIlagay ang manok sa kawali at haluin hanggang maluto.');
if (recipe.ingredients.length !== 2 || recipe.instructions.length !== 1) fail.push(`recipe text: ${JSON.stringify(recipe)}`);
if (textLanguage('Ilagay ang manok sa kawali at haluin ang mga sibuyas hanggang maluto.') !== 'tl') fail.push('Tagalog text not recognised');
if (deeplTarget('tl') || !deeplTarget('sv')) fail.push('Tagalog offered as a DeepL target');
return { fail, log };
