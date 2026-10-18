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
  // Languages without articles (0.20): brackets after the word, matched by its stem; Chinese before, Japanese after.
  [['200 г муки', '2 шт. моркови', 'Соль — 1 ч. л.'], 'Просейте муку в миску. Натрите морковь и добавьте соль.', 'Просейте муку ([200 г]) в миску. Натрите морковь ([2 шт.]) и добавьте соль ([1 ч. л.]).'],
  [['200 г муки'], 'Добавьте 200 г муки и перемешайте.', 'Добавьте 200 г муки и перемешайте.'],
  [['500 g mąki', '2 jajka'], 'Wsyp mąkę do miski i dodaj jajka.', 'Wsyp mąkę ([500 g]) do miski i dodaj jajka ([2]).'],
  [['300 g făină', '2 ouă'], 'Cerne făina într-un castron și adaugă ouăle cu sare.', 'Cerne făina ([300 g]) într-un castron și adaugă ouăle ([2]) cu sare.'],
  [['2 su bardağı un', '3 yumurta'], 'Unu eleyin ve yumurtaları ekleyin.', 'Unu ([2 su bardağı]) eleyin ve yumurtaları ([3]) ekleyin.'],
  [['200克面粉', '鸡蛋 2个'], '把面粉倒入碗中，加入鸡蛋搅拌。', '把[200克]面粉倒入碗中，加入[2个]鸡蛋搅拌。'],
  [['卵 2個', '砂糖 大さじ2'], '卵を溶きほぐし、砂糖を加える。', '卵（[2個]）を溶きほぐし、砂糖（[大さじ2]）を加える。'],
  // Arabic and Hebrew: the name with a small word in front ("الدقيق", "והביצים").
  [['200 غ دقيق', '2 بيضة', '2 ملعقة كبيرة زيت زيتون'], 'انخل الدقيق في وعاء ثم أضف البيضة وزيت الزيتون.', 'انخل الدقيق ([200 غ]) في وعاء ثم أضف البيضة ([2]) وزيت الزيتون ([2 ملعقة كبيرة]).'],
  [['200 גרם קמח', '3 ביצים'], 'נפו את הקמח לקערה והוסיפו את הביצים.', 'נפו את הקמח ([200 גרם]) לקערה והוסיפו את הביצים ([3]).'],
];
for (const [ingredients, text, want] of cases) {
  const steps = [{ text }];
  addStepAmounts(steps, ingredients);
  const got = plain(steps[0].text);
  log.push(`${got}`);
  if (got !== want) fail.push(`${text}\n   want: ${want}\n   got:  ${got}`);
}
return { fail, log };
