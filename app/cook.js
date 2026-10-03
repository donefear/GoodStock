// Goodstock, part 4 of 5: step-by-step cook mode: steps and their amounts, timers and alarms, read aloud and voice
// commands.
// The parts load in order as plain scripts (see index.html) and share one global scope.

// Step-by-step cook mode: one small, concrete action per screen.
// Times in recipe steps, in the app's languages ("10 minutes", "10 Minuten", "10 minutos", "5 分钟", "1時間").
// Longer words come before their short forms; the lookahead keeps "min" from matching inside "minced".
const TIME_UNITS = [
  'hours?', 'hrs?', 'uur', 'uren', 'stunden', 'stunde', 'std', 'heures?', 'horas?', 'ore', 'ora', 'часов', 'часа', 'час', '小时', '小時', '時間', 'h',
  'minutes?', 'minuten', 'minuut', 'minuti', 'minuto', 'minutos', 'минуты', 'минуту', 'минута', 'минут', 'мин', '分钟', '分鐘', '分', 'mins?', 'min',
  'seconds?', 'seconden', 'sekunden', 'sekunde', 'sek', 'secondes?', 'secondi', 'secondo', 'segundos?', 'seg', 'секунды', 'секунду', 'секунда', 'секунд', 'сек', '秒', 'secs?',
];
const TIME_PATTERN = new RegExp(String.raw`(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|~|〜|to|tot|bis|à|a|al|до|至)\s*(\d+))?\s*(${TIME_UNITS.join('|')})(?![a-zà-ÿа-яё])`, 'i');
const HOUR_UNIT = /^(?:h|uur|uren|stund|std|heure|hora|or[ae]|час|小时|小時|時間)/i;
const SECOND_UNIT = /^(?:s|сек|秒)/i;
const TEMPERATURE_PATTERN = /\d{2,3}\s*°\s*[CF]?/;
let recipeDialogRecipe = null;
let recipeDialogPlanId = '';
let cookSession = null;
let cookTimers = [];
let timerTickId = null;
let alarmLoopId = null;
let timerPanelOpen = false;
let cookWakeLock = null;

function readCookProgress() {
  try { return JSON.parse(localStorage.getItem(COOK_PROGRESS_KEY) || '{}'); } catch { return {}; }
}

function saveCookProgress() {
  if (!cookSession) return;
  const progress = readCookProgress();
  const finished = cookSession.index >= cookSession.bites.length - 1;
  if (finished || cookSession.index === 0) delete progress[cookSession.recipe.id]; else progress[cookSession.recipe.id] = cookSession.index;
  try { localStorage.setItem(COOK_PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Progress is a convenience only. */ }
}

function stepMinutes(text) {
  const match = TIME_PATTERN.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  const unit = match[3].toLowerCase();
  const minutes = HOUR_UNIT.test(unit) ? value * 60 : SECOND_UNIT.test(unit) ? value / 60 : value;
  return minutes > 0 ? { minutes, label: match[0].trim() } : null;
}

function isStepHeading(text) {
  return text.length <= 40 && !/[.!?:。！？：]$/.test(text) && text.split(/\s+/).length <= 4;
}

function splitIntoBites(text) {
  const cleaned = text.replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, '').trim();
  // Sentences end with . ! ? before a capital (Latin or Cyrillic), or with Chinese/Japanese 。！？.
  const sentences = cleaned.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÝА-ЯЁ0-9¿¡])|(?<=[。！？])/).flatMap((sentence) => sentence.length > 160 ? sentence.split(/;\s+/) : [sentence]);
  // Chinese and Japanese say as much in far fewer characters, so "very short" is shorter there.
  const dense = /[぀-ヿ一-鿿]/.test(cleaned);
  return sentences.map((sentence) => sentence.trim()).filter(Boolean).reduce((bites, sentence) => {
    const previous = bites[bites.length - 1];
    if (previous && previous.length < (dense ? 8 : 25)) bites[bites.length - 1] = `${previous}${dense ? '' : ' '}${sentence}`;
    else bites.push(sentence);
    return bites;
  }, []).filter(Boolean);
}

function recipeInstructions(recipe) {
  if (Array.isArray(recipe.instructions) && recipe.instructions.length) return recipe.instructions;
  return starterRecipes.find((starter) => starter.id === recipe.id)?.instructions || [];
}

function unitLabel(unitText, amount) {
  if (amount <= 1 || !/^(?:cup|teaspoon|tablespoon|can|clove|jar|bag|bottle|pinch|slice|sprig|bunch|handful|stick|piece|pack|packet)$/i.test(unitText)) return unitText;
  return /(?:ch|sh)$/i.test(unitText) ? `${unitText}es` : `${unitText}s`;
}

// Word stem for matching ingredient names in step text: drops plural and Dutch diminutive endings and a doubled
// last consonant, so eggs/egg, eieren, kaneelstokje/kaneelstok and vanillestokken/vanillestokjes line up.
function wordStem(word) {
  const lower = word.toLowerCase();
  const stripped = lower.replace(/(?:tjes|tje|jes|je|es|en|s)$/, '');
  return (stripped.length >= 3 ? stripped : lower).replace(/([^aeiou])\1$/, '$1');
}

// Articles per recipe language, replaced by the amount ("Add the flour" → "Add 200 g of flour"), and the word that
// links an amount with a unit to the ingredient ("200 g of flour", "200 g de farine", "200 g di farina").
const STEP_ARTICLES = {
  en: ['the', 'a', 'an'], nl: ['de', 'het', 'een'], de: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen'],
  fr: ['le', 'la', 'les', "l'", 'l’', 'un', 'une', 'des', 'du'], es: ['el', 'la', 'los', 'las', 'un', 'una'],
  it: ['il', 'lo', 'la', 'i', 'gli', 'le', "l'", 'l’', 'un', 'una'], pt: ['o', 'a', 'os', 'as', 'um', 'uma'],
};
const AMOUNT_LINKS = { en: ' of ', fr: ' de ', es: ' de ', it: ' di ', pt: ' de ' };
// French and Italian join an article to the next word ("l'huile"); those are split so the ingredient is found.
const STEP_WORD = /[lLdD]['’](?=\p{L})|[\p{L}-]+(?:['’][\p{L}-]+)*/gu;
const isPrepWord = (word) => /^\p{L}{2,}ed$/u.test(word) || /^ge\p{L}+(?:en|de|te)$/iu.test(word);

// Puts each ingredient's amount in front of its first mention in the steps:
// "Add the sesame oil" → "Add 1 tbsp of sesame oil", "Weeg de bloem" → "Weeg 200 gram bloem",
// "Meet de hoeveelheid melk af" → "Meet 5 deciliter melk af", "the crushed garlic" → "3 cloves of crushed garlic".
// Exact names match anywhere; looser matches (compound words like patisseriebloem ↔ bloem or nootjeschocolade ↔
// chocolade, or only the last word of a longer name) need "the/de/het/een/a" right before them.
function addStepAmounts(steps, ingredients) {
  const markerRanges = (text) => [...text.matchAll(/\u0001[^\u0002]*\u0002/g)].map((match) => [match.index, match.index + match[0].length]);
  const language = textLanguage(steps.map((step) => step.text).join(' '));
  const articles = new Set(STEP_ARTICLES[language] || []);
  for (const target of ingredients.map(parseIngredient).filter((entry) => entry.amount)) {
    const name = target.name.replace(/\([^)]*\)/g, ' ').split(',')[0].replace(/\s+/g, ' ').trim().toLowerCase().replace(/^(?:de|d['’]|di)\s*/, '');
    const core = name.split(/\s+(?:met|with|zonder|without|voor|for|mit|ohne|für|avec|sans|pour|con|sin|para|senza|per|com|sem)\s+/)[0].trim();
    const coreWords = core.split(' ').filter(Boolean);
    if (!coreWords.length || core.length < 2) continue;
    const phrases = [...new Set([name, core])].map((phrase) => phrase.split(' ').filter(Boolean).map(wordStem));
    const lastWord = coreWords[coreWords.length - 1];
    const loose = coreWords.length === 1 ? wordStem(coreWords[0]) : (lastWord.length > 3 ? wordStem(lastWord) : '');
    let placed = false;
    for (const step of steps) {
      if (placed) break;
      const skip = markerRanges(step.text);
      const words = [...step.text.matchAll(STEP_WORD)]
        .filter((match) => !skip.some(([from, to]) => match.index >= from && match.index < to))
        .map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length, stem: wordStem(match[0]) }));
      let found = null;
      for (let index = 0; index < words.length && !found; index++) {
        // Exact: the whole name (or its core) word for word.
        for (const phrase of phrases) {
          if (phrase.every((stem, offset) => words[index + offset]?.stem === stem)) { found = { first: index, last: index + phrase.length - 1, exact: true }; break; }
        }
        if (found || !loose) continue;
        const stem = words[index].stem;
        const similar = stem === loose || (loose.length >= 4 && stem.endsWith(loose)) || (stem.length >= 4 && loose.endsWith(stem));
        if (!similar) continue;
        // Loose matches need an article (or a prep word after one) right before them.
        const previous = words[index - 1]?.text.toLowerCase();
        const beforePrep = words[index - 2]?.text.toLowerCase();
        if (articles.has(previous) || previous === 'hoeveelheid' || (isPrepWord(words[index - 1]?.text || '') && articles.has(beforePrep))) {
          found = { first: index, last: index, exact: false };
        }
      }
      if (!found) continue;
      // Words just before the name: a prep word stays after the amount, and an article (or "de hoeveelheid",
      // "the amount of") is replaced by the amount.
      let from = found.first;
      let prep = '';
      if (from > 0 && isPrepWord(words[from - 1].text)) { prep = words[from - 1].text; from -= 1; }
      let dropFrom = from;
      const previous = (offset) => words[from - offset]?.text.toLowerCase();
      if (previous(1) === 'hoeveelheid' && articles.has(previous(2))) dropFrom = from - 2;
      else if (previous(1) === 'of' && previous(2) === 'amount' && articles.has(previous(3))) dropFrom = from - 3;
      else if (articles.has(previous(1))) dropFrom = from - 1;
      const insertAt = words[dropFrom].start;
      const before = step.text.slice(0, insertAt);
      // Already has an amount right there ("2 tbsp milk"): leave it.
      // Also when another ingredient line already put its amount there.
      if (/[\d¼½¾⅓⅔⅛⅜⅝⅞]\s*[\p{L}.]*\s*(?:(?:of|van|de|di)\s+|d['’])?$/u.test(before) || /\u0002\s*$/.test(before)) { placed = true; break; }
      const named = step.text.slice(words[found.first].start, words[found.last].end);
      const moved = `${prep ? `${prep} ` : ''}${named}`;
      // "200 g of flour", "200 g de farine", "200 g d’huile" (French before a vowel), "200 g Mehl".
      let link = target.unitText ? (AMOUNT_LINKS[language] || ' ') : ' ';
      if (language === 'fr' && link === ' de ' && /^[aeiouyhàâéèêëîïôûü]/i.test(moved)) link = ' d’';
      const unit = target.unitText ? ` ${unitLabel(target.unitText, target.amount)}` : '';
      const amount = `${formatAmount(target.amount, target.unit)}${unit}${link.trimEnd()}`;
      const gap = link.endsWith(' ') ? ' ' : '';
      step.text = `${before}\u0001${amount}\u0002${gap}${insertAt === 0 && language !== 'de' ? moved.toLowerCase() : moved}${step.text.slice(words[found.last].end)}`;
      placed = true;
    }
  }
}

function buildCookBites(recipe) {
  const bites = [];
  const ingredients = recipe.ingredients || [];
  for (let start = 0; start < ingredients.length; start += 6) {
    bites.push({ type: 'gather', items: ingredients.slice(start, start + 6), part: start / 6 + 1, parts: Math.ceil(ingredients.length / 6) });
  }
  const steps = [];
  let heading = '';
  for (const raw of recipeInstructions(recipe).map((text) => metricText(String(text).trim())).filter(Boolean)) {
    if (isStepHeading(raw)) {
      if (heading) steps.push({ type: 'step', heading: '', text: heading });
      heading = raw;
      continue;
    }
    for (const text of splitIntoBites(raw)) steps.push({ type: 'step', heading, text, timer: stepMinutes(text) });
    heading = '';
  }
  if (heading) steps.push({ type: 'step', heading: '', text: heading });
  addStepAmounts(steps, ingredients);
  const ovenIndex = steps.findIndex((step) => TEMPERATURE_PATTERN.test(step.text));
  if (ovenIndex > 0) {
    const temperature = steps[ovenIndex].text.match(TEMPERATURE_PATTERN)[0].replace(/\s+/g, '');
    steps.unshift({ type: 'step', heading: t('Heads-up'), text: t('Turn the oven on to {temperature} now. You will need it in step {step}.', { temperature, step: ovenIndex + 2 }) });
  }
  for (const step of steps) step.tools = typeof kitchenToolsIn === 'function' ? kitchenToolsIn(step.text) : [];
  const tools = [...new Set(steps.flatMap((step) => step.tools))];
  if (tools.length) bites.push({ type: 'tools', tools });
  if (!steps.length) bites.push({ type: 'empty' });
  bites.push(...steps, { type: 'done' });
  return bites;
}

function highlightStepText(text) {
  const pattern = new RegExp(`${TIME_PATTERN.source}|${TEMPERATURE_PATTERN.source}`, 'gi');
  return escapeHtml(text).replace(pattern, (match) => `<mark>${match}</mark>`)
    .replace(/\u0001([^\u0002]*)\u0002/g, '<strong class="steps-amount">$1</strong>');
}

function formatTimer(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(safe / 3600);
  const rest = `${String(Math.floor((safe % 3600) / 60)).padStart(hours ? 2 : 1, '0')}:${String(safe % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${rest}` : rest;
}

// One shared audio context, unlocked by the tap on "Start timer" so the alarm may play later without a gesture.
let alarmAudio = null;

function unlockAlarmAudio() {
  try {
    if (!alarmAudio) alarmAudio = new AudioContext();
    if (alarmAudio.state === 'suspended') alarmAudio.resume().catch(() => {});
  } catch { alarmAudio = null; }
}

// Timers: any number can run at once, each tied to its recipe and step. The alarm beeps every 2 seconds
// while any timer has finished, until each finished timer is tapped or stopped.
function timerAlarm(timer) {
  if (!alarmLoopId) {
    timerBeep();
    alarmLoopId = setInterval(timerBeep, 2000);
  }
  // The Android app posts its own alarm notification when it is in the background.
  if (!STANDALONE && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(t('Goodstock timer'), { body: t('{name}: {time} is done.', { name: timerTitle(timer), time: timer.label }), tag: timer.id, requireInteraction: true });
  }
}

function timerBeep() {
  try {
    unlockAlarmAudio();
    const context = alarmAudio;
    [0, 0.35, 0.7].forEach((offset) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, context.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + offset + 0.3);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + offset);
      oscillator.stop(context.currentTime + offset + 0.3);
    });
  } catch { /* Sound is optional. */ }
  if (STANDALONE) { try { nativeApp.vibrate(700); } catch { /* Optional. */ } } else navigator.vibrate?.([300, 150, 300]);
}

const timerRemaining = (timer) => (timer.endsAt - Date.now()) / 1000;
// Finished timers first, then the one that ends soonest.
const timersByUrgency = (timers) => [...timers].sort((a, b) => Number(b.done) - Number(a.done) || a.endsAt - b.endsAt);
const currentStepTimer = () => cookSession && cookTimers.find((timer) => timer.recipe?.id === cookSession.recipe.id && timer.stepIndex === cookSession.index);

const timerTitle = (timer) => timer.recipe?.name || timer.name || t('Timer');

function timerPillText(timer) {
  return {
    time: timer.done ? t('Time is up!') : formatTimer(timerRemaining(timer)),
    label: `${timerTitle(timer)} · ${timer.done ? (timer.recipe ? t('tap to go back') : t('tap to clear')) : timer.label}`,
  };
}

// Keyed update so the pills are not rebuilt every second (a tap mid-rebuild would get lost).
function syncTimerList(container, timers, { extend = false } = {}) {
  const wanted = new Set(timers.map((timer) => timer.id));
  for (const pill of [...container.children]) if (!wanted.has(pill.dataset.timerId)) pill.remove();
  timers.forEach((timer, position) => {
    let pill = container.querySelector(`[data-timer-id="${timer.id}"]`);
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'timer-pill';
      pill.dataset.timerId = timer.id;
      pill.innerHTML = `<button class="timer-pill-open" type="button" data-action="timer-open" data-timer="${escapeHtml(timer.id)}"><span class="timer-pill-icon" aria-hidden="true">⏱</span><span><strong></strong><small></small></span></button><button class="timer-pill-stop" type="button" data-action="timer-stop" data-timer="${escapeHtml(timer.id)}" aria-label="${t('Stop timer')}">×</button>`;
      if (extend) pill.querySelector('.timer-pill-stop').insertAdjacentHTML('beforebegin', `<button class="timer-pill-extend" type="button" data-action="timer-extend" data-timer="${escapeHtml(timer.id)}" aria-label="${t('Add one minute')}">${t('+1 min')}</button>`);
    }
    if (container.children[position] !== pill) container.insertBefore(pill, container.children[position] || null);
    const text = timerPillText(timer);
    pill.classList.toggle('is-done', timer.done);
    pill.querySelector('strong').textContent = text.time;
    pill.querySelector('small').textContent = text.label;
  });
}

const APP_TITLE = document.title;
let titleFlashId = null;

// Timers are kept per browser, so a reload or closed tab picks up where it left off.
// Timers that ended more than an hour before the app opens again are dropped instead of ringing.
// Only writes when something changed, and never rewrites identical data: another tab reloads on every write,
// so an unconditional save would bounce between tabs forever.
let savedTimersSignature = '';
const timersSignature = (timers) => JSON.stringify(timers.map((timer) => [timer.id, timer.endsAt, Boolean(timer.done)]));

function saveTimers() {
  const signature = timersSignature(cookTimers);
  if (signature === savedTimersSignature) return;
  savedTimersSignature = signature;
  const snapshot = cookTimers.map(({ id, recipe, planId, stepIndex, label, name, endsAt, done }) => ({
    id, planId, stepIndex, label, name, endsAt, done,
    recipe: recipe && { id: recipe.id, slug: recipe.slug, name: recipe.name, source: recipe.source, ingredients: recipe.ingredients, instructions: recipe.instructions },
  }));
  syncNativeTimers();
  try {
    const value = snapshot.length ? JSON.stringify(snapshot) : null;
    if (localStorage.getItem(TIMERS_KEY) === value) return;
    if (value) localStorage.setItem(TIMERS_KEY, value); else localStorage.removeItem(TIMERS_KEY);
  } catch { /* Timers still run; they just won't survive a reload. */ }
}

// In the Android app, every timer also gets a system alarm, so it rings with the app in the background or the
// screen off. Timers that disappear here are cancelled there, including a notification that is still ringing.
function syncNativeTimers() {
  if (!STANDALONE) return;
  // The alarm notification shows these texts as they are, so they are written in the app's language here.
  const timers = cookTimers.map((timer) => ({
    id: timer.id, endsAt: timer.endsAt, done: Boolean(timer.done),
    title: `⏰ ${t('Time is up: {name}', { name: timerTitle(timer) })}`,
    text: t('{time} · tap to open Goodstock', { time: timer.label || t('Your timer') }),
  }));
  try { nativeApp.setTimers(JSON.stringify(timers)); } catch { /* In-app alarm still works while the app is open. */ }
}

function loadTimers() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(TIMERS_KEY) || '[]'); } catch { saved = []; }
  const now = Date.now();
  saved = Array.isArray(saved) ? saved : [];
  cookTimers = saved
    .filter((timer) => timer && timer.id && Number.isFinite(timer.endsAt) && now - timer.endsAt < TIMER_RESTORE_LIMIT_MS)
    .map((timer) => ({ ...timer, done: Boolean(timer.done) }));
  // What is stored now; refreshTimers only saves if dropping old timers or finishing one changes it.
  savedTimersSignature = timersSignature(saved.filter((timer) => timer && timer.id));
  syncNativeTimers();
  if (cookTimers.length && !timerTickId) timerTickId = setInterval(refreshTimers, 1000);
  // Already-finished timers keep ringing, without sending their notification again.
  if (cookTimers.some((timer) => timer.done) && !alarmLoopId) {
    timerBeep();
    alarmLoopId = setInterval(timerBeep, 2000);
  }
  refreshTimers();
}

function refreshTimers() {
  for (const timer of cookTimers) {
    if (!timer.done && timerRemaining(timer) <= 0) {
      timer.done = true;
      timerAlarm(timer);
    }
  }
  saveTimers();
  if (alarmLoopId && !cookTimers.some((timer) => timer.done)) {
    clearInterval(alarmLoopId);
    alarmLoopId = null;
    navigator.vibrate?.(0);
  }
  if (!cookTimers.length && timerTickId) {
    clearInterval(timerTickId);
    timerTickId = null;
  }
  const stepsOpen = $('#steps-dialog').open;
  const here = stepsOpen ? currentStepTimer() : null;
  const others = timersByUrgency(cookTimers.filter((timer) => timer !== here));

  // Big countdown under this step's Start button.
  const inline = $('#steps-timer-inline');
  if (inline) {
    inline.hidden = !here;
    inline.classList.toggle('is-done', Boolean(here?.done));
    if (here) {
      inline.dataset.timer = here.id;
      inline.innerHTML = here.done ? `<strong>${t('Time is up')}</strong><span>${t('Tap to clear')}</span>` : `<strong>${formatTimer(timerRemaining(here))}</strong><span>${t('Tap to stop')}</span>`;
    }
  }

  // Top-bar chip in step-by-step: the most urgent other timer and how many more. Tap to list them all.
  const chip = $('#steps-timer-chip');
  chip.hidden = !others.length;
  if (!others.length) timerPanelOpen = false;
  if (others.length) {
    const first = others[0];
    chip.classList.toggle('is-done', first.done);
    chip.textContent = `${first.done ? `⏰ ${t('Time is up')}` : `⏱ ${formatTimer(timerRemaining(first))}`}${others.length > 1 ? ` · ${tp(others.length - 1, '+{count} more', '+{count} more')}` : ` · ${timerTitle(first)}`}`;
    chip.setAttribute('aria-expanded', String(timerPanelOpen));
  }
  const panel = $('#steps-timer-panel');
  panel.hidden = !stepsOpen || !timerPanelOpen;
  if (!panel.hidden) syncTimerList(panel, others);

  // Every timer on the Timers tab, with +1 min.
  const viewList = $('#timer-view-list');
  if (viewList) {
    syncTimerList(viewList, timersByUrgency(cookTimers), { extend: true });
    $('#timer-view-empty').hidden = cookTimers.length > 0;
    $('#timer-view-count').textContent = cookTimers.length ? String(cookTimers.length) : t('None yet');
  }
  $('#timer-count').textContent = cookTimers.length ? String(cookTimers.length) : '';

  // Stacked pills on the main screen while step-by-step is closed (the Timers tab already lists them).
  const floating = $('#floating-timers');
  floating.hidden = stepsOpen || !cookTimers.length || (activeView === 'tools' && toolsTab === 'timers');
  if (!floating.hidden) syncTimerList(floating, timersByUrgency(cookTimers));

  const flash = cookTimers.some((timer) => timer.done);
  if (flash && !titleFlashId) {
    titleFlashId = setInterval(() => { document.title = document.title === APP_TITLE ? `⏰ ${t('Time is up!')}` : APP_TITLE; }, 1000);
  } else if (!flash && titleFlashId) {
    clearInterval(titleFlashId);
    titleFlashId = null;
    document.title = APP_TITLE;
  }
}

// Jump to the recipe and step a timer belongs to, switching recipes if needed. Tapping a finished timer also clears it.
function openTimerStep(id) {
  const timer = cookTimers.find((entry) => entry.id === id);
  if (!timer) return;
  if (timer.done) cookTimers = cookTimers.filter((entry) => entry !== timer);
  if (!timer.recipe) {
    if ($('#steps-dialog').open) $('#steps-dialog').close();
    activeView = 'tools';
    toolsTab = 'timers';
    render();
    return;
  }
  if (cookSession?.recipe.id === timer.recipe.id) {
    cookSession.index = timer.stepIndex;
  } else {
    if (cookSession) saveCookProgress();
    cookSession = { recipe: timer.recipe, bites: buildCookBites(timer.recipe), index: timer.stepIndex, planId: timer.planId, checked: new Set(), resumed: false };
  }
  timerPanelOpen = false;
  renderCookStep();
  const dialog = $('#steps-dialog');
  if (!dialog.open) {
    dialog.showModal();
    keepScreenOn(true);
  }
  refreshTimers();
}

// Starting a step's timer again restarts it rather than adding a duplicate.
function startCookTimer(minutes, label) {
  if (!cookSession) return;
  unlockAlarmAudio();
  const existing = currentStepTimer();
  if (existing) cookTimers = cookTimers.filter((timer) => timer !== existing);
  cookTimers.push({ id: makeId(), recipe: cookSession.recipe, planId: cookSession.planId, stepIndex: cookSession.index, label, endsAt: Date.now() + minutes * 60_000, done: false });
  if (!timerTickId) timerTickId = setInterval(refreshTimers, 1000);
  refreshTimers();
}

function stopCookTimer(id) {
  cookTimers = cookTimers.filter((timer) => timer.id !== id);
  refreshTimers();
}

// Hands-free cooking. Read aloud speaks each step as you reach it: the browser's speech, or the phone's own
// text-to-speech in the Android app (its web view has none). Voice commands listen for "next", "back", "repeat",
// "timer" and "stop" in the app's languages; browsers allow the microphone only over HTTPS, so it shows only there.
const READ_ALOUD_KEY = 'goodstock-read-aloud-v1';
let readAloud = (() => { try { return localStorage.getItem(READ_ALOUD_KEY) === 'true'; } catch { return false; } })();
let voiceRecognition = null;
let listening = false;
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const VOICE_COMMANDS = {
  // \b only knows Latin letters, so Russian, Chinese and Japanese words stand outside it.
  next: /\b(?:next|volgende|verder|weiter|nächster|suivant|suivante|siguiente|avanti|prossimo|próximo|seguinte)\b|дальше|далее|следующ|下一步|下一个|次へ|次/i,
  back: /\b(?:back|previous|terug|vorige|zurück|retour|précédent|atrás|anterior|indietro|voltar)\b|назад|上一步|戻る|前へ/i,
  repeat: /\b(?:repeat|again|herhaal|opnieuw|wiederholen|nochmal|répète|répéter|repite|repetir|ripeti|repete)\b|повтори|重复|もう一度/i,
  timer: /\b(?:timer|minuteur|temporizador|cronometro)\b|cronômetro|таймер|计时|タイマー/i,
  stop: /\b(?:stop|stopp|para|ferma|pare)\b|arrête|стоп|停止|止めて/i,
};

const canSpeak = () => (STANDALONE && nativeApp.canSpeak ? Boolean(nativeApp.canSpeak()) : 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function');
const canListen = () => Boolean(SpeechRecognitionApi) && window.isSecureContext;

function speak(parts) {
  stopSpeaking();
  const clean = parts.map((part) => ({ ...part, text: String(part.text || '').replace(/[\u0001\u0002]/g, '').trim() })).filter((part) => part.text);
  if (!clean.length) return;
  if (STANDALONE && nativeApp.speak) { try { nativeApp.speak(JSON.stringify(clean)); } catch { /* Optional. */ } return; }
  for (const part of clean) {
    const utterance = new window.SpeechSynthesisUtterance(part.text);
    utterance.lang = part.lang;
    window.speechSynthesis.speak(utterance);
  }
}

function stopSpeaking() {
  if (STANDALONE && nativeApp.stopSpeaking) { try { nativeApp.stopSpeaking(); } catch { /* Optional. */ } return; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

// The step in the recipe's language; the short label before it in the app's language.
function speakCookStep() {
  if (!readAloud || !cookSession) return;
  const bite = cookSession.bites[cookSession.index];
  const app = languageLocale();
  const recipe = (LANGUAGES.find((language) => language.code === recipeLanguage(cookSession.recipe)) || LANGUAGES[0]).locale;
  if (bite.type === 'gather') speak([{ text: t('Get these out'), lang: app }, { text: bite.items.join(', '), lang: recipe }]);
  else if (bite.type === 'tools') speak([{ text: t("Tools you'll need"), lang: app }, { text: bite.tools.map((tool) => t(tool.name)).join(', '), lang: app }]);
  else if (bite.type === 'step') speak([{ text: bite.heading, lang: recipe }, { text: bite.text, lang: recipe }]);
  else if (bite.type === 'done') speak([{ text: t('You did it.'), lang: app }]);
}

function updateVoiceButtons() {
  const aloud = $('#steps-read-aloud');
  const listen = $('#steps-listen');
  aloud.hidden = !canSpeak();
  aloud.setAttribute('aria-pressed', String(readAloud));
  listen.hidden = !canListen();
  listen.setAttribute('aria-pressed', String(listening));
}

function toggleReadAloud() {
  readAloud = !readAloud;
  try { localStorage.setItem(READ_ALOUD_KEY, String(readAloud)); } catch { /* For this visit only. */ }
  if (readAloud) speakCookStep(); else stopSpeaking();
  updateVoiceButtons();
}

function voiceCommand(transcript) {
  const said = String(transcript || '').trim();
  if (VOICE_COMMANDS.stop.test(said)) {
    stopSpeaking();
    const ringing = cookTimers.find((timer) => timer.done);
    if (ringing) stopCookTimer(ringing.id);
    return 'stop';
  }
  if (VOICE_COMMANDS.next.test(said)) { moveCookStep(1); return 'next'; }
  if (VOICE_COMMANDS.back.test(said)) { moveCookStep(-1); return 'back'; }
  if (VOICE_COMMANDS.repeat.test(said)) { speakCookStep(); return 'repeat'; }
  if (VOICE_COMMANDS.timer.test(said)) {
    const bite = cookSession && cookSession.bites[cookSession.index];
    if (bite && bite.timer) startCookTimer(bite.timer.minutes, bite.timer.label);
    return 'timer';
  }
  return '';
}

function toggleListening(on = !listening) {
  if (!canListen()) return;
  listening = on;
  if (on) {
    voiceRecognition = new SpeechRecognitionApi();
    voiceRecognition.lang = languageLocale();
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = false;
    voiceRecognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (result && result.isFinal) voiceCommand(result[0].transcript);
    };
    // Listening stops by itself after a pause; keep it going while cook mode is open.
    voiceRecognition.onend = () => { if (listening && $('#steps-dialog').open) { try { voiceRecognition.start(); } catch { /* Already running. */ } } };
    voiceRecognition.onerror = (event) => { if (event.error === 'not-allowed' || event.error === 'service-not-allowed') { listening = false; updateVoiceButtons(); } };
    try { voiceRecognition.start(); } catch { listening = false; }
  } else if (voiceRecognition) {
    voiceRecognition.onend = null;
    try { voiceRecognition.stop(); } catch { /* Not running. */ }
    voiceRecognition = null;
  }
  updateVoiceButtons();
}

function renderCookStep() {
  const { recipe, bites, index, checked } = cookSession;
  const bite = bites[index];
  const stepCount = bites.filter((entry) => entry.type === 'step').length;
  const stepNumber = bites.slice(0, index + 1).filter((entry) => entry.type === 'step').length;
  $('#steps-recipe-name').textContent = recipe.name;
  $('#steps-counter').textContent = bite.type === 'gather' || bite.type === 'tools' ? t('GET READY') : bite.type === 'done' ? t('FINISHED') : bite.type === 'empty' ? t('NO STEPS') : t('STEP {number} OF {total}', { number: stepNumber, total: stepCount });
  $('#steps-progress-bar').style.width = `${Math.round((index / Math.max(1, bites.length - 1)) * 100)}%`;
  const resume = cookSession.resumed && index > 0 ? `<button class="text-button steps-restart" type="button" data-action="steps-restart">${t('Resumed where you left off · start over')}</button>` : '';
  let body = '';
  if (bite.type === 'gather') {
    body = `<h3 class="steps-heading">${t('Get these out')}${bite.parts > 1 ? ` (${bite.part}/${bite.parts})` : ''}</h3><p class="steps-hint">${t('Tap each one as it lands on the counter.')}</p><div class="steps-gather">${bite.items.map((item) => {
      const key = `${index}:${item}`;
      const stocked = matchingInventory(item);
      return `<label class="ingredient-check"><input type="checkbox" data-steps-item="${escapeHtml(key)}" ${checked.has(key) ? 'checked' : ''}><span class="custom-check" aria-hidden="true"></span><span>${escapeHtml(item)}</span><small>${stocked ? escapeHtml(stocked.location) : t('not in inventory')}</small></label>`;
    }).join('')}</div>`;
  } else if (bite.type === 'tools') {
    body = `<h3 class="steps-heading">${t("Tools you'll need")}</h3><p class="steps-hint">${t("Tap each one once it's out and ready.")}</p><div class="steps-gather">${bite.tools.map((tool) => {
      const key = `${index}:${tool.id}`;
      return `<label class="ingredient-check tool-check"><input type="checkbox" data-steps-item="${escapeHtml(key)}" ${checked.has(key) ? 'checked' : ''}><span class="custom-check" aria-hidden="true"></span>${kitchenToolIcon(tool)}<span><strong>${escapeHtml(t(tool.name))}</strong><small>${escapeHtml(t(tool.description))}</small></span></label>`;
    }).join('')}</div>`;
  } else if (bite.type === 'step') {
    const timer = bite.timer
      ? `<button class="button button-outline steps-timer-button" type="button" data-action="steps-timer-start" data-minutes="${bite.timer.minutes}" data-label="${escapeHtml(bite.timer.label)}">⏱ ${t('Start {time} timer', { time: escapeHtml(bite.timer.label) })}</button><button class="steps-timer-inline" id="steps-timer-inline" type="button" data-action="timer-stop" aria-live="polite" hidden><strong>0:00</strong><span>${t('Tap to stop')}</span></button>`
      : '';
    const tools = bite.tools?.length
      ? `<ul class="steps-tools" aria-label="${t('Tools for this step')}">${bite.tools.map((tool) => `<li title="${escapeHtml(t(tool.description))}">${kitchenToolIcon(tool)}<span>${escapeHtml(t(tool.name))}</span></li>`).join('')}</ul>`
      : '';
    body = `${bite.heading ? `<span class="steps-step-heading">${escapeHtml(bite.heading)}</span>` : ''}<p class="steps-text">${highlightStepText(bite.text)}</p>${tools}${timer}`;
  } else if (bite.type === 'empty') {
    body = `<h3 class="steps-heading">${t('No steps saved for this recipe')}</h3><p class="steps-hint">${t('The ingredients are ready above.')} ${mealieRecipeLink(recipe, 'mealie-link', t('Check the full recipe in Mealie')) || t('Add instructions to the recipe to get small steps here.')}</p>`;
  } else {
    const plan = cookSession.planId && state.plan.find((entry) => entry.id === cookSession.planId);
    body = `<div class="steps-done"><span aria-hidden="true">✓</span><h3 class="steps-heading">${t('You did it.')}</h3><p class="steps-hint">${plan && !plan.cooked ? t('Mark it as cooked and take the used ingredients out of your stock.') : t('Enjoy your meal.')}</p>${plan && !plan.cooked ? `<button class="button button-primary" type="button" data-action="steps-review" data-id="${escapeHtml(plan.id)}">${t('Mark as cooked')} ✓</button>` : ''}</div>`;
  }
  $('#steps-body').innerHTML = `${resume}${body}`;
  $('.steps-back').disabled = index === 0;
  $('.steps-next').textContent = index === bites.length - 1 ? t('Close') : index === bites.length - 2 ? `${t('Finish')} ›` : `${t('Next')} ›`;
  refreshTimers();
  updateVoiceButtons();
  speakCookStep();
}

async function startCookSteps(recipe, planId = '') {
  if (!recipe) return;
  if (recipe.source === 'Mealie' && recipe.slug && !Array.isArray(recipe.instructions)) {
    try {
      const details = metricRecipe(await mealieRecipe(recipe.slug));
      const saved = recipeById(recipe.id);
      if (saved) { saved.instructions = details.instructions || []; persist(); }
      recipe = { ...recipe, instructions: details.instructions || [] };
    } catch { /* Fall back to ingredients only while Mealie is unreachable. */ }
  }
  const plan = planId && state.plan.find((entry) => entry.id === planId);
  recipe = scaledRecipe(recipe, plan ? planScale(plan) : (recipeScales.get(recipe.id) || 1));
  const bites = buildCookBites(recipe);
  const saved = readCookProgress()[recipe.id];
  const index = Number.isInteger(saved) && saved > 0 && saved < bites.length - 1 ? saved : 0;
  cookSession = { recipe, bites, index, planId, checked: new Set(), resumed: index > 0 };
  renderCookStep();
  const dialog = $('#steps-dialog');
  if (!dialog.open) dialog.showModal();
  await keepScreenOn(true);
}

function moveCookStep(direction) {
  if (!cookSession) return;
  const next = cookSession.index + direction;
  if (next >= cookSession.bites.length) { $('#steps-dialog').close(); return; }
  cookSession.index = Math.max(0, next);
  cookSession.resumed = false;
  saveCookProgress();
  renderCookStep();
}
