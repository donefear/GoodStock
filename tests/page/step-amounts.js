const fail = []; const log = [];
const plain = (text) => text.replace(/\u0001/g, '[').replace(/\u0002/g, ']');
const cases = [
  [['1 tbsp sesame oil'], 'Add the sesame oil and stir.', 'Add [1 tbsp of] sesame oil and stir.'],
  [['200 gram bloem'], 'Weeg de bloem en voeg toe.', 'Weeg [200 gram] bloem en voeg toe.'],
  [['200 g Mehl'], 'Das Mehl in die Schüssel geben und mit dem Zucker mischen.', '[200 g] Mehl in die Schüssel geben und mit dem Zucker mischen.'],
  [['2 Eier'], 'Die Eier mit dem Schneebesen verquirlen.', '[2] Eier mit dem Schneebesen verquirlen.'],
  [['200 g farine'], 'Ajoutez la farine et mélangez avec le sucre.', 'Ajoutez [200 g de] farine et mélangez avec le sucre.'],
  [['30 ml huile'], "Versez l'huile dans la poêle et ajoutez le sel.", "Versez [30 ml d’]huile dans la poêle et ajoutez le sel."],
  [['300 g de harina'], 'Mezcla la harina con el azúcar y la leche.', 'Mezcla [300 g de] harina con el azúcar y la leche.'],
  [['2 cebollas'], 'Pica las cebollas y fríe con el aceite.', 'Pica [2] cebollas y fríe con el aceite.'],
  [['250 g di farina'], 'Aggiungi la farina e mescola il latte con le uova.', 'Aggiungi [250 g di] farina e mescola il latte con le uova.'],
  [['100 g de manteiga'], 'Derreta a manteiga com o açúcar e os ovos.', 'Derreta [100 g de] manteiga com o açúcar e os ovos.'],
  [['2 tbsp milk'], 'Add 2 tbsp milk.', 'Add 2 tbsp milk.'],
];
for (const [ingredients, text, want] of cases) {
  const steps = [{ text }];
  addStepAmounts(steps, ingredients);
  const got = plain(steps[0].text);
  log.push(`${got}`);
  if (got !== want) fail.push(`${text}\n   want: ${want}\n   got:  ${got}`);
}
return { fail, log };
