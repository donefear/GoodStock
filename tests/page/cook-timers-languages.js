const fail = []; const log = [];
const cases = [
  ['Let it rest for 10 minutes.', 10], ['Kook 5 minuten.', 5], ['Bake for 1 hour.', 60],
  ['10 Minuten köcheln lassen.', 10], ['Cuire 20 minutes.', 20], ['Laisser reposer 1 h.', 60],
  ['Hornear 25 minutos.', 25], ['Cuocere per 8 minuti.', 8], ['Asse por 2 horas.', 120],
  ['Варите 15 минут.', 15], ['Жарьте 3 минуты.', 3], ['Отдохнуть 30 секунд.', 0.5],
  ['煮 5 分钟。', 5], ['焖 1 小时。', 60], ['5分煮ます。', 5], ['1時間寝かせます。', 60],
  ['Fierbe 20 de minute.', 20], ['Lasă la cuptor 1 oră.', 60], ['Gotuj przez 15 minut.', 15], ['Piecz godzinę 1 godz.', 60], ['Odstaw na 30 sekund.', 0.5], ['10 dakika pişirin.', 10], ['1 saat dinlendirin.', 60],
  ['اطبخ لمدة 10 دقائق.', 10], ['اتركها 15 دقيقة على نار هادئة.', 15], ['اخبزها لمدة 1 ساعة.', 60], ['اخفق 30 ثانية.', 0.5],
  ['בשלו 10 דקות.', 10], ['אפו 1 שעה.', 60], ['טרפו 20 שניות.', 1 / 3], ['בשלו 5–7 דקות.', 5],
  ['Mix 20 seconds.', 1 / 3], ['Add the minced garlic.', null], ['Etwa 2 bis 3 Minuten braten.', 2],
];
for (const [text, minutes] of cases) {
  const got = stepMinutes(text);
  const value = got ? Math.round(got.minutes * 1000) / 1000 : null;
  const want = minutes === null ? null : Math.round(minutes * 1000) / 1000;
  log.push(`${text} → ${got ? `${value} min (“${got.label}”)` : 'no timer'}`);
  if (value !== want) fail.push(`${text}: expected ${want}, got ${value}`);
}
const bites = splitIntoBites('鸡蛋打散。加入牛奶，搅拌均匀。煮 5 分钟。');
log.push(`zh split → ${JSON.stringify(bites)}`);
if (bites.length < 2) fail.push('Chinese steps were not split into sentences');
const ru = splitIntoBites('Разогрейте сковороду на среднем огне. Добавьте масло и лук. Жарьте 3 минуты.');
log.push(`ru split → ${JSON.stringify(ru)}`);
if (ru.length < 2) fail.push('Russian steps were not split');
const ar = splitIntoBites('سخّن الزيت في المقلاة على نار متوسطة. أضف البصل وقلّبه جيدًا. اطبخ لمدة 5 دقائق.');
const he = splitIntoBites('חממו את השמן במחבת על אש בינונית. הוסיפו את הבצל וערבבו היטב. בשלו 5 דקות.');
log.push(`ar split → ${JSON.stringify(ar)}`, `he split → ${JSON.stringify(he)}`);
if (ar.length < 2 || he.length < 2) fail.push('Arabic or Hebrew steps were not split into sentences');
const highlighted = highlightStepText('Hornear 25 minutos a 180 °C.');
if (!/<mark>25 minutos<\/mark>/.test(highlighted)) fail.push(`Spanish time not highlighted: ${highlighted}`);
return { fail, log };
