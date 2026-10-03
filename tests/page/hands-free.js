const fail = []; const log = [];
const spoken = [];
window.speechSynthesis.speak = (utterance) => spoken.push(`${utterance.lang}: ${utterance.text}`);
window.speechSynthesis.cancel = () => {};
// Commands, without moving anything: stub the actions.
const calls = [];
const realMove = moveCookStep; const realSpeak = speakCookStep;
moveCookStep = (d) => calls.push(d > 0 ? 'next' : 'back');
const phrases = {
  next: ['next please', 'volgende', 'weiter', 'suivant', 'siguiente', 'avanti', 'próximo', 'дальше', '下一步', '次へ'],
  back: ['go back', 'terug', 'zurück', 'retour', 'atrás', 'indietro', 'voltar', 'назад', '上一步', '戻る'],
  repeat: ['repeat that', 'herhaal', 'nochmal', 'répète', 'repite', 'ripeti', 'repete', 'повтори', '重复', 'もう一度'],
  timer: ['start the timer', 'minuteur', 'temporizador', 'таймер', '计时', 'タイマー'],
};
for (const [command, list] of Object.entries(phrases)) {
  for (const phrase of list) {
    const got = voiceCommand(phrase);
    if (got !== command) fail.push(`"${phrase}" → ${got || 'nothing'} (expected ${command})`);
  }
}
if (voiceCommand('the onions are soft now') !== '') fail.push('an ordinary sentence was taken as a command');
moveCookStep = realMove;
// Read aloud: a Dutch recipe in an English app speaks the label in English and the ingredients in Dutch.
await setLanguage('en');
const recipe = { id: 'nl-test', name: 'Erwtensoep', language: 'nl', ingredients: ['500 g spliterwten', '1 ui'], instructions: ['Snijd de ui.', 'Kook 10 minuten.'] };
await startCookSteps(recipe);
log.push(`read-aloud button ${$('#steps-read-aloud').hidden ? 'hidden' : 'shown'}, voice button ${$('#steps-listen').hidden ? 'hidden' : 'shown'}`);
if ($('#steps-read-aloud').hidden) fail.push('read-aloud button hidden in Chrome');
toggleReadAloud();
moveCookStep(1);
moveCookStep(1);
log.push(...spoken);
if (!spoken.some((line) => /^en-GB: Get these out/.test(line))) fail.push('label not spoken in the app language');
if (!spoken.some((line) => /^nl-NL: .*spliterwten/.test(line))) fail.push('ingredients not spoken in the recipe language');
if (!spoken.some((line) => /^nl-NL: .*Snijd/.test(line))) fail.push('step not spoken in the recipe language');
toggleReadAloud();
$('#steps-dialog').close();
return { fail, log };
