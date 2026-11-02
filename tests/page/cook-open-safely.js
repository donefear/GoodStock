// Cook mode opens with read aloud saved on in a browser without speech, and tapping a finished timer of one's own
// while cook mode is open only clears it (v4.7.1).
const fail = []; const log = [];
const recipe = { id: 'cook-safe', name: 'Toast', ingredients: ['2 slices bread'], instructions: ['Toast the bread for 3 minutes.', 'Butter it.'] };
state.recipes = [recipe]; state.plan = []; state.inventory = [];
const saved = { utterance: window.SpeechSynthesisUtterance, readAloud };
try {
  try { Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true, writable: true }); } catch { window.SpeechSynthesisUtterance = undefined; }
  readAloud = true;
  try { await startCookSteps(recipe); } catch (error) { fail.push(`startCookSteps threw: ${error.message}`); }
  if (!$('#steps-dialog').open) fail.push('cook mode did not open with read aloud on and no speech');
  try { moveCookStep(1); } catch (error) { fail.push(`next step threw: ${error.message}`); }
  log.push(`open: ${$('#steps-dialog').open}, step ${cookSession && cookSession.index}`);
} finally {
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: saved.utterance, configurable: true, writable: true });
  readAloud = saved.readAloud;
}

// A finished custom timer (no recipe), tapped while cook mode is open.
if (!$('#steps-dialog').open) await startCookSteps(recipe);
const viewBefore = activeView;
cookTimers.push({ id: 'custom-done', recipe: null, label: '5 min', endsAt: Date.now() - 1000, done: true });
openTimerStep('custom-done');
log.push(`after tap: open ${$('#steps-dialog').open}, view ${activeView}, timers ${cookTimers.length}`);
if (!$('#steps-dialog').open) fail.push('tapping a finished custom timer closed cook mode');
if (activeView !== viewBefore) fail.push(`tapping a finished custom timer switched to ${activeView}`);
if (cookTimers.some((timer) => timer.id === 'custom-done')) fail.push('the finished timer was not cleared');
cookTimers = cookTimers.filter((timer) => timer.id !== 'custom-done');
refreshTimers();
$('#steps-dialog').close();
return { fail, log };
