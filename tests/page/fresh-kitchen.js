const fail = []; const log = [];
for (const code of ['en', 'nl', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'zh', 'ja', 'ro', 'pl', 'tr']) {
  await setLanguage(code);
  const fresh = freshState();
  state = fresh;
  const kinds = fresh.locations.map((place) => (FREEZER_WORDS.test(place) ? 'freezer' : FRIDGE_WORDS.test(place) ? 'fridge' : PANTRY_WORDS.test(place) ? 'pantry' : 'other'));
  if (kinds.join() !== 'pantry,fridge,freezer,other') fail.push(`${code}: storage places not recognised: ${fresh.locations.join(' / ')} → ${kinds}`);
  const soup = fresh.recipes.find((recipe) => recipe.id === 'tomato-bean-soup');
  const pancakes = fresh.recipes.find((recipe) => recipe.id === 'oat-pancakes');
  // Every ingredient line has an amount, and the catalog knows what it is.
  for (const recipe of fresh.recipes) {
    for (const line of recipe.ingredients) {
      if (!parseIngredient(line).amount) fail.push(`${code}: no amount in "${line}"`);
      if (!ingredientRecord(line) && !/rosemary|rozemarijn|rosmarin|romarin|romero|rosmarino|alecrim|розмарин|迷迭香|ローズマリー|rozmarin|rozmaryn|biberiye/i.test(line)) fail.push(`${code}: catalog does not know "${line}"`);
    }
  }
  // The sample eggs in the fridge count for the pancakes; the step with a time gets a timer.
  if (!matchingInventory(pancakes.ingredients.find((line) => ingredientRecord(line)?.id === 'egg') || '')) fail.push(`${code}: sample eggs do not match the pancake recipe`);
  const timers = buildCookBites(soup).filter((bite) => bite.timer).length;
  if (timers < 2) fail.push(`${code}: soup has ${timers} timers (expected 2)`);
  log.push(`${code}: ${fresh.locations.join(' / ')} | ${soup.name} | timers ${timers} | ${pancakes.ingredients.join('; ')}`);
}
await setLanguage('en');
return { fail, log };
