const fail = []; const log = [];
const ids = (text) => kitchenToolsIn(text).map((tool) => tool.id);
const cases = [
  ['Heat the oven and whisk the eggs in a bowl.', ['oven', 'whisk', 'bowl']],
  ['Verwarm de oven voor en klop de eieren in een kom.', ['oven', 'whisk', 'bowl']],
  ['Den Backofen vorheizen. Die Eier in einer Schüssel mit dem Schneebesen verquirlen.', ['oven', 'bowl', 'whisk']],
  ['Préchauffez le four. Fouettez les œufs dans un saladier.', ['oven', 'whisk', 'bowl']],
  ['Calienta el horno. Bate los huevos con varillas en un cuenco.', ['oven', 'whisk', 'bowl']],
  ['Scalda il forno. Sbatti le uova in una ciotola.', ['oven', 'whisk', 'bowl']],
  ['Preaqueça o forno. Bata os ovos numa tigela com um batedor.', ['oven', 'bowl', 'whisk']],
  ['Разогрейте духовку. Взбейте яйца венчиком в миске.', ['oven', 'whisk', 'bowl']],
  ['烤箱预热。用打蛋器在碗里打散鸡蛋。', ['oven', 'whisk', 'bowl']],
  ['オーブンを予熱する。ボウルに卵を入れ、泡立て器で混ぜる。', ['oven', 'bowl', 'whisk']],
  ['Faites revenir dans une poêle avec une fourchette.', ['skillet']],
  ['Ajoutez les tagliatelle et le tomate.', []],
  ['Añade el tomate pelado.', []],
  ['Отварите куриные ножки.', []],
  ['Pon las tapas en la mesa.', []],
  ['Preîncălziți cuptorul. Bateți ouăle cu telul într-un castron.', ['oven', 'whisk', 'bowl']],
  ['Rozgrzej piekarnik. Ubij jajka trzepaczką w misce.', ['oven', 'whisk', 'bowl']],
  ['Fırını önceden ısıtın. Yumurtaları bir kasede çırpın.', ['oven', 'bowl', 'whisk']],
  ['Bake a lemon tart.', []],
];
for (const [text, want] of cases) {
  const got = ids(text);
  log.push(`${text.slice(0, 45)} → ${got.join(', ') || '(none)'}`);
  const missing = want.filter((id) => !got.includes(id));
  const extra = got.filter((id) => !want.includes(id));
  if (missing.length || (want.length === 0 && extra.length) ) fail.push(`${text}: missing [${missing}] extra [${extra}]`);
}
return { fail, log };
