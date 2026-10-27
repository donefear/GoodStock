// Goodstock, part 4 of 6: recipes: the Recipes page and favourites, the full recipe page, the recipe editor,
// importing from a website or pasted text, recipe photos, translation with DeepL, and the recipe popup.
// The parts load in order as plain scripts (see index.html) and share one global scope.

// Your own recipes: write one, import it from a recipe website, or paste its text. No Mealie needed.
function openRecipeEditor(recipe = null, { importFirst = false } = {}) {
  const form = $('#recipe-edit-form');
  form.reset();
  form.elements.recipeId.value = recipe?.id || '';
  form.elements.sourceUrl.value = recipe?.sourceUrl || '';
  form.elements.name.value = recipe?.name || '';
  form.elements.description.value = recipe?.description || '';
  form.elements.servings.value = recipe?.servings || '';
  form.elements.ingredients.value = (recipe?.ingredients || []).join('\n');
  form.elements.instructions.value = recipeInstructions(recipe || {}).join('\n');
  setEditorPhoto(recipe?.photo || '');
  $('#recipe-photo-status').textContent = '';
  $('#recipe-edit-title').textContent = recipe ? t('Edit {name}', { name: recipe.name }) : importFirst ? t('Import a recipe') : t('New recipe');
  $('#recipe-edit-eyebrow').textContent = recipe ? t('EDIT RECIPE') : t('YOUR RECIPE');
  $('#recipe-import').hidden = Boolean(recipe);
  $('#recipe-import').open = importFirst;
  $('#recipe-import-status').textContent = '';
  $('#recipe-edit-dialog').showModal();
  (importFirst ? form.elements.importUrl : form.elements.name).focus();
}

// Splits pasted recipe text into name, ingredients and steps. Headings ("Ingredients", "Method", "Bereiding") help;
// without them, short lines that start with an amount count as ingredients and everything else as steps.
function parseRecipeText(text) {
  const ingredientHeading = /^(?:ingredients?|ingredi[eë]nten|you(?:'ll| will)? need|what you need|benodigdheden|zutaten|ingredienser|det skal du bruge|du behöver|ingrédients|ingredientes|ingredienti|ingrediente|składniki|malzemeler|ингредиенты|材料|食材|用料|المكونات|المقادير|מצרכים|רכיבים)\s*[:：]?$/i;
  const stepHeading = /^(?:instructions?|directions?|method|steps?|preparation|how to make it|bereiding(?:swijze)?|werkwijze|zubereitung|fremgangsmåde|tilberedning|sådan gør du|gör så här|tillagning|instruktioner|préparation|instructions|preparación|elaboración|preparazione|procedimento|modo de preparo|preparo|mod de preparare|preparare|przygotowanie|sposób przygotowania|hazırlanışı|yapılışı|приготовление|способ приготовления|作り方|手順|做法|步骤|طريقة التحضير|الطريقة|الخطوات|אופן ההכנה|הוראות הכנה|הכנה)\s*[:：]?$/i;
  const clean = (line) => line.replace(/^(?:[-–•*▢☐□✓]\s*|(?:step\s*)?\d+[.)]\s+)/i, '').trim();
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasHeadings = lines.some((line) => ingredientHeading.test(line) || stepHeading.test(line));
  const result = { name: '', description: '', ingredients: [], instructions: [] };
  const before = [];
  let section = null;
  for (const line of lines) {
    if (ingredientHeading.test(line)) { section = 'ingredients'; continue; }
    if (stepHeading.test(line)) { section = 'instructions'; continue; }
    if (section) { result[section].push(clean(line)); continue; }
    if (!result.name) { result.name = line; continue; }
    before.push(line);
  }
  if (hasHeadings) {
    result.description = before.join(' ').slice(0, 400);
  } else {
    for (const line of before) {
      const looksLikeIngredient = line.length < 80 && !/[.!?]$/.test(line) && /^(?:[-–•*]\s*)?(?:[\d¼½¾⅓⅔⅛]|(?:a|an|one|two|three|pinch|handful|some)\b)/i.test(line);
      (looksLikeIngredient ? result.ingredients : result.instructions).push(clean(line));
    }
  }
  return result;
}

// Imported steps often arrive as one paragraph per step. Split them the way cook mode does: one sentence per step
// (very short sentences stay with the one before), keeping short heading lines like "Sauce" as they are.
function tidyImportedSteps(instructions = []) {
  return instructions
    .map((text) => String(text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap((text) => (isStepHeading(text) ? [text] : splitIntoBites(text)));
}

function fillRecipeEditor(recipe, message) {
  const form = $('#recipe-edit-form');
  if (recipe.name) form.elements.name.value = recipe.name;
  if (recipe.description) form.elements.description.value = recipe.description;
  if (recipe.servings) form.elements.servings.value = recipe.servings;
  if (recipe.ingredients?.length) form.elements.ingredients.value = recipe.ingredients.join('\n');
  if (recipe.instructions?.length) form.elements.instructions.value = recipe.instructions.join('\n');
  if (recipe.sourceUrl) form.elements.sourceUrl.value = recipe.sourceUrl;
  if (recipe.photo) setEditorPhoto(recipe.photo);
  $('#recipe-import-status').textContent = message;
}

// Recipe photos are kept small (at most PHOTO_SIZE pixels on the long side, as JPEG, roughly 20–40 KB) and saved
// with the recipe, so they sync, back up and work offline like the rest of the kitchen, in every mode. Mealie
// photos and photos imported in the phone apps (which can't fetch pictures for the page) stay web addresses.
const PHOTO_SIZE = 480;
const safePhoto = (value) => (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value || '') || /^https?:\/\/[^\s"'<>]+$/i.test(value || '') ? value : '');
const recipePhoto = (recipe, className) => (safePhoto(recipe.photo) ? `<img class="recipe-photo ${className}" src="${escapeHtml(recipe.photo)}" alt="" loading="lazy" />` : '');

function shrinkPhoto(blob) {
  return new Promise((resolve, reject) => {
    const address = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, PHOTO_SIZE / Math.max(image.naturalWidth, image.naturalHeight, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(address);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    image.onerror = () => { URL.revokeObjectURL(address); reject(new Error('not an image')); };
    image.src = address;
  });
}

function setEditorPhoto(photo) {
  const value = safePhoto(photo);
  $('#recipe-edit-form').elements.photo.value = value;
  const preview = $('#recipe-photo-preview');
  preview.hidden = !value;
  if (value) preview.src = value; else preview.removeAttribute('src');
  $('#recipe-photo-remove').hidden = !value;
  $('#recipe-photo-pick').textContent = value ? t('Change photo') : t('Add a photo');
}

async function pickRecipePhoto(file) {
  if (!file) return;
  const status = $('#recipe-photo-status');
  try {
    setEditorPhoto(await shrinkPhoto(file));
    status.textContent = '';
  } catch {
    status.textContent = t('That file could not be used as a photo.');
  }
}

// An imported recipe's photo: downloaded once (through the server, or the app's bridge) and shrunk, so it shows offline.
async function importedPhoto(address) {
  if (!/^https?:\/\//i.test(address || '')) return '';
  // The apps download it through their bridge (0.33); one without fetchImage, or a failed download, keeps the link.
  if (STANDALONE) {
    if (typeof nativeApp.fetchImage !== 'function') return address;
    try {
      const [, type, data] = /^data:([^;,]+);base64,(.*)$/.exec(await nativeCall('fetchImage', address)) || [];
      if (!data) return address;
      const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
      return await shrinkPhoto(new Blob([bytes], { type }));
    } catch {
      return address;
    }
  }
  try {
    const response = await fetch(`/api/photo?url=${encodeURIComponent(address)}`);
    if (!response.ok) return '';
    return await shrinkPhoto(await response.blob());
  } catch {
    return '';
  }
}

async function importRecipeFromUrl() {
  const form = $('#recipe-edit-form');
  const address = form.elements.importUrl.value.trim();
  const status = $('#recipe-import-status');
  if (!address) { form.elements.importUrl.focus(); return; }
  status.textContent = t('Fetching the recipe…');
  try {
    let result;
    if (STANDALONE) {
      // No server in the Android app: the phone fetches the page and the shared parser reads it here.
      if (!/^https?:\/\//i.test(address)) { status.textContent = t('Only http and https links can be imported.'); return; }
      const page = JSON.parse(await nativeCall('fetchPage', address));
      if (page.status >= 400) { status.textContent = t('The website refused the import (HTTP {status}). Some sites block this; copy the recipe text and paste it instead.', { status: page.status }); return; }
      result = window.GoodstockRecipeImport?.extractRecipeFromHtml(page.body, page.url || address);
      if (!result) { status.textContent = t(window.GoodstockRecipeImport?.NO_RECIPE_MESSAGE || N_('No recipe found on that page.')); return; }
    } else if (HOSTED) {
      // A hosting phone or computer can't fetch other websites for a browser.
      status.textContent = t('Importing a link works in the Goodstock app. Here, copy the recipe text and paste it instead.');
      return;
    } else {
      const response = await fetch(`/api/recipes/import?url=${encodeURIComponent(address)}`);
      result = await response.json().catch(() => ({}));
      if (!response.ok) { status.textContent = serverError(result, N_('That recipe could not be imported.')).local; return; }
    }
    const host = (() => { try { return new URL(result.sourceUrl).hostname.replace(/^www\./, ''); } catch { return t('the website'); } })();
    result.instructions = tidyImportedSteps(result.instructions);
    result.photo = await importedPhoto(result.image);
    fillRecipeEditor(result, t('Imported from {host}: {ingredients} ingredients, {steps} steps. Check it, then save.', { host, ingredients: result.ingredients.length, steps: result.instructions.length }));
  } catch (error) {
    if (STANDALONE) status.textContent = navigator.onLine ? (error?.message ? t('Could not load that page ({reason}).', { reason: error.message }) : t('Could not load that page.')) : t('You are offline. Paste the recipe text instead.');
    else status.textContent = navigator.onLine ? t('Could not reach the app server.') : t('You are offline. Paste the recipe text instead.');
  }
}

function saveRecipeFromEditor(form) {
  const lines = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const existing = state.recipes.find((recipe) => recipe.id === form.elements.recipeId.value);
  const sourceUrl = form.elements.sourceUrl.value.trim();
  const recipe = metricRecipe({
    ...(existing || {}),
    id: existing?.id || `my-${makeId()}`,
    name: form.elements.name.value.trim(),
    description: form.elements.description.value.trim(),
    servings: Math.round(Number(form.elements.servings.value)) >= 1 ? Math.min(100, Math.round(Number(form.elements.servings.value))) : null,
    ingredients: lines(form.elements.ingredients.value),
    instructions: lines(form.elements.instructions.value),
    source: existing?.source || (sourceUrl ? 'Imported' : 'My recipes'),
    sourceUrl: sourceUrl || existing?.sourceUrl || '',
    photo: safePhoto(form.elements.photo.value),
  });
  if (!recipe.photo) delete recipe.photo;
  if (!recipe.name) return;
  if (existing && !recipe.photo) delete existing.photo;
  if (existing) Object.assign(existing, recipe); else state.recipes.unshift(recipe);
  // Steps may have changed, so a saved cook-mode position no longer lines up.
  const progress = readCookProgress();
  delete progress[recipe.id];
  try { localStorage.setItem(COOK_PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Progress is a convenience only. */ }
  persist();
  $('#recipe-edit-dialog').close();
  if ($('#recipe-dialog').open) openRecipeDialog(recipe.id, false, recipeDialogPlanId);
  // Stay on the recipe's own page when editing from there; otherwise show the recipe list.
  if (activeView === 'recipe') recipePageId = recipe.id; else activeView = 'recipes';
  render();
}

function deleteRecipe(id) {
  const recipe = recipeById(id);
  if (!recipe) return;
  withUndo(t('Deleted “{name}”', { name: recipe.name }), ['recipes', 'plan', 'recipeNotes'], () => {
    state.recipes = state.recipes.filter((entry) => entry.id !== recipe.id);
    state.plan = state.plan.filter((entry) => entry.recipeId !== recipe.id);
    state.recipeNotes = state.recipeNotes.filter((entry) => entry.recipeId !== recipe.id);
  });
  $('#recipe-dialog').close();
  render();
}

// A recipe as a normal page: ingredients with what is in stock, tools, and numbered steps with the amounts written
// in. Step by step (cook mode) is one button away.
function openRecipePage(id) {
  const recipe = recipeById(id);
  if (!recipe) return;
  recipePageId = recipe.id;
  activeView = 'recipe';
  if ($('#recipe-dialog').open) $('#recipe-dialog').close();
  render();
  window.scrollTo?.(0, 0);
  ensureMealieInstructions(recipe);
}

// Mealie recipes in the library may not have their steps yet; fetch them once, then show them.
const fetchingInstructions = new Set();
async function ensureMealieInstructions(recipe) {
  if (recipe.source !== 'Mealie' || !recipe.slug || Array.isArray(recipe.instructions) || fetchingInstructions.has(recipe.id)) return;
  fetchingInstructions.add(recipe.id);
  try {
    const details = metricRecipe(await mealieRecipe(recipe.slug));
    recipe.instructions = details.instructions || [];
    persist();
  } catch { /* Shown as "no steps" while Mealie is unreachable. */ } finally {
    fetchingInstructions.delete(recipe.id);
  }
}

function recipePageSteps(recipe) {
  const lines = recipeInstructions(recipe).map((text) => metricText(String(text).trim())).filter(Boolean);
  const steps = lines.map((text) => ({ heading: isStepHeading(text), text }));
  addStepAmounts(steps.filter((step) => !step.heading), recipe.ingredients || []);
  return { lines, steps };
}

// Where a recipe came from is stored in English ("Imported") and shown in the chosen language.
const SOURCE_LABELS = { 'My recipes': N_('My recipes'), Imported: N_('Imported'), Translated: N_('Translated'), 'Kitchen collection': N_('Kitchen collection'), 'Goodstock test': N_('Goodstock test') };
const sourceLabel = (source) => (SOURCE_LABELS[source || 'Kitchen collection'] ? t(SOURCE_LABELS[source || 'Kitchen collection']) : source);
const inStockText = (item) => (item ? t('in {location}', { location: escapeHtml(item.location) }) : t('not in inventory'));

function renderRecipePage() {
  const saved = recipeById(recipePageId);
  if (!saved) { activeView = 'recipes'; return renderRecipes(); }
  const factor = recipeScales.get(saved.id) || 1;
  const recipe = scaledRecipe(saved, factor);
  const ingredients = recipe.ingredients || [];
  const servingsControl = `<div class="servings-control" role="group" aria-label="${t('Servings')}"><button class="icon-button" type="button" data-action="scale-recipe" data-id="${escapeHtml(saved.id)}" data-step="-1" aria-label="${t('Fewer')}">−</button><span>${escapeHtml(scaleLabel(saved, factor))}</span><button class="icon-button" type="button" data-action="scale-recipe" data-id="${escapeHtml(saved.id)}" data-step="1" aria-label="${t('More')}">＋</button></div>`;
  const missing = missingIngredients(recipe);
  const { lines, steps } = recipePageSteps(recipe);
  const tools = typeof kitchenToolsIn === 'function' ? kitchenToolsIn(lines.join(' ')) : [];
  const planned = currentWeekPlans().some((entry) => entry.recipeId === recipe.id);
  const safeSourceUrl = /^https?:\/\//i.test(recipe.sourceUrl || '') ? recipe.sourceUrl : '';
  const actions = `<div class="recipe-page-actions">
      <button class="button button-primary" type="button" data-action="start-steps" data-id="${escapeHtml(recipe.id)}">${t('Step by step')} <span aria-hidden="true">▶</span></button>
      <button class="button ${planned ? 'button-outline' : 'button-dark'}" type="button" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">${planned ? t('Plan another day') : t('Plan this week')}</button>
    </div>`;
  const links = [
    safeSourceUrl ? `<a class="text-button" href="${escapeHtml(safeSourceUrl)}" target="_blank" rel="noopener noreferrer">${t('Original recipe')} ↗</a>` : '',
    mealieRecipeLink(recipe, 'text-button', t('Open in Mealie')),
    renderRecipeTranslation(recipe),
    canPrint() ? `<button class="text-button" type="button" data-action="print">${t('Print')}</button>` : '',
    `<button class="text-button" type="button" data-action="share-recipe" data-id="${escapeHtml(recipe.id)}">${t('Share')}</button>`,
    `<button class="text-button" type="button" data-action="edit-recipe" data-id="${escapeHtml(recipe.id)}">${t('Edit')}</button>`,
    `<button class="text-button recipe-delete-button" type="button" data-action="delete-recipe" data-id="${escapeHtml(recipe.id)}">${t('Delete')}</button>`,
  ].filter(Boolean).join('');
  const ingredientList = ingredients.length
    ? `<ul class="recipe-ingredient-list recipe-page-ingredients">${ingredients.map((ingredient) => {
      const item = matchingInventory(ingredient);
      return `<li class="${item ? 'in-stock' : 'not-stocked'}"><span aria-hidden="true">${item ? '✓' : '○'}</span><span>${escapeHtml(ingredient)}</span><small>${inStockText(item)}</small></li>`;
    }).join('')}</ul>`
    : `<p class="muted">${t('No ingredients listed.')}</p>`;
  let number = 0;
  const method = steps.length
    ? `<div class="recipe-method">${steps.map((step) => (step.heading
      ? `<h3 class="recipe-method-heading">${escapeHtml(step.text)}</h3>`
      : `<div class="recipe-method-step"><span class="recipe-step-number" aria-hidden="true">${++number}</span><p>${highlightStepText(step.text)}</p></div>`)).join('')}</div>`
    : `<p class="muted">${recipe.source === 'Mealie' && !Array.isArray(recipe.instructions) ? t('Loading the steps from Mealie…') : t('No steps saved for this recipe yet. Add them with Edit.')}</p>`;
  const toolRow = tools.length ? `<ul class="steps-tools recipe-page-tools" aria-label="${t('Tools')}">${tools.map((tool) => `<li title="${escapeHtml(t(tool.description))}">${kitchenToolIcon(tool)}<span>${escapeHtml(t(tool.name))}</span></li>`).join('')}</ul>` : '';
  return `<button class="text-button recipe-back" type="button" data-action="back-to-recipes">‹ ${t('All recipes')}</button>
    ${pageHeading(escapeHtml(sourceLabel(recipe.source).toUpperCase()), escapeHtml(recipe.name), escapeHtml(recipe.description || ''), actions)}
    <div class="recipe-page-links">${favouriteButton(saved, true)}${links}</div>
    <div class="recipe-cooked-row"><p class="recipe-cooked-note">${escapeHtml(cookedText(saved.id))}</p>${ratingStars(saved, true)}</div>
    ${dietLine(saved, true)}
    ${recipePhoto(recipe, 'recipe-page-photo')}
    ${renderTranslationPanel(recipe)}
    ${renderSharePanel(recipe)}
    <div class="recipe-page">
      <section class="section-block recipe-page-side"><div class="section-heading"><div><h2>${t('Ingredients')}</h2><span class="muted">${ingredients.length ? (missing.length ? tp(missing.length, '{count} missing', '{count} missing') : t('All in stock')) : ''}</span></div>${ingredients.length ? servingsControl : ''}</div>${ingredientList}</section>
      <section class="section-block recipe-page-main"><div class="section-heading"><div><h2>${t('Method')}</h2><span class="muted">${number ? tp(number, '{count} step', '{count} steps') : ''}</span></div></div>${toolRow}${method}</section>
    </div>
    ${renderRecipeNotes(saved)}${printFooter(safeSourceUrl)}`;
}

// Translating recipes between Dutch and English with DeepL. In the browser the server calls DeepL (it blocks
// direct browser calls and keeps the key); in the Android app the phone calls DeepL with the key saved on it.
// A translation is shown first and can then be saved as a new recipe, so the original stays as it was.
const DEEPL_PHONE_KEY = 'goodstock-deepl-v1';
let recipeTranslation = null; // { recipeId, target, loading, error, result }

function phoneDeeplKey() {
  try { return localStorage.getItem(DEEPL_PHONE_KEY) || ''; } catch { return ''; }
}

async function phoneDeepl(path, key, body) {
  const { deeplUrl, deeplHeaders, deeplErrorMessage, deeplErrorTemplate } = window.GoodstockDeepl;
  let response;
  try {
    const answer = body
      ? await nativeCall('httpSend', 'POST', deeplUrl(key, path), JSON.stringify(deeplHeaders(key)), JSON.stringify(body))
      : await nativeCall('httpRequest', deeplUrl(key, path), JSON.stringify(deeplHeaders(key)));
    response = JSON.parse(answer);
  } catch {
    throw new Error(N_('Could not reach DeepL. Check that the phone is online.'));
  }
  if (response.status >= 400) throw Object.assign(new Error(deeplErrorMessage(response.status)), { local: localMessage(deeplErrorTemplate(response.status)) });
  return JSON.parse(response.body);
}

async function translateTexts(texts, target, source = '') {
  if (STANDALONE) {
    const key = phoneDeeplKey();
    if (!key) throw new Error(N_('Add a DeepL API key in Settings to translate recipes.'));
    const { deeplChunks, deeplRequestBody } = window.GoodstockDeepl;
    const translated = [];
    for (const chunk of deeplChunks(texts)) {
      const result = await phoneDeepl('/translate', key, deeplRequestBody(chunk, target, source));
      translated.push(...(result.translations || []).map((entry) => entry.text));
    }
    return translated;
  }
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texts, target, source }),
  }).catch(() => { throw new Error(N_('Could not reach the app server.')); });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw serverError(result, N_('Translation failed.'));
  return result.texts || [];
}

// The recipe's language: saved on translated copies, otherwise judged by its script and common small words.
const RECIPE_LANGUAGE_WORDS = {
  en: /\s(?:the|and|of|with|add|until|minutes|into|to|your|salt|pepper|onion|eggs|milk|butter|in the)\s/g,
  nl: /\s(?:de|het|een|en|van|met|voeg|toe|snijd|bak|kook|minuten|tot|op|je|zout|peper|ui|eieren|melk|boter|in de)\s/g,
  de: /\s(?:der|die|das|und|mit|minuten|bis|ein|eine|den|dem|zugeben|salz|pfeffer|zwiebel|eier|milch|butter|im)\s/g,
  fr: /\s(?:le|la|les|et|du|des|avec|ajouter|ajoutez|minutes|jusqu'à|une|sel|poivre|oignon|oeufs|œufs|lait|beurre|dans)\s/g,
  es: /\s(?:el|la|los|las|y|del|con|añadir|añade|minutos|hasta|una|sal|pimienta|cebolla|huevos|leche|mantequilla|en el)\s/g,
  it: /\s(?:il|lo|la|gli|e|del|della|con|aggiungere|aggiungete|minuti|fino|una|sale|pepe|cipolla|uova|latte|burro|nel)\s/g,
  pt: /\s(?:o|os|as|e|do|da|com|adicione|minutos|até|uma|sal|pimenta|cebola|ovos|leite|manteiga|no)\s/g,
  ro: /\s(?:și|cu|în|de|la|pe|minute|adaugă|sare|piper|ceapă|ouă|lapte|unt|până)\s/g,
  pl: /\s(?:i|z|w|na|do|się|minut|dodaj|sól|pieprz|cebula|jajka|mleko|masło|aż)\s/g,
  tr: /\s(?:ve|ile|bir|için|dakika|ekle|ekleyin|tuz|biber|soğan|yumurta|süt|tereyağı|kadar)\s/g,
  da: /\s(?:og|af|til|et|minutter|tilsæt|indtil|hak|steg|peber|løg|æg|mælk|smør|gryde|ovnen|lidt)\s/g,
  sv: /\s(?:och|av|till|ett|minuter|tillsätt|tills|hacka|stek|peppar|lök|ägg|mjölk|smör|kastrull|ugnen|lite)\s/g,
};

function recipeLanguage(recipe) {
  if (recipe.language && LANGUAGES.some((language) => language.code === recipe.language)) return recipe.language;
  return textLanguage([recipe.name, recipe.description, ...(recipe.ingredients || []), ...recipeInstructions(recipe)].join(' '));
}

function textLanguage(value) {
  const text = ` ${String(value || '').toLowerCase()} `;
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[一-鿿]/.test(text)) return 'zh';
  if (/[Ѐ-ӿ]/.test(text)) return 'ru';
  if (/[؀-ۿ]/.test(text)) return 'ar';
  if (/[֐-׿]/.test(text)) return 'he';
  let best = 'en';
  let bestCount = 0;
  for (const code of Object.keys(RECIPE_LANGUAGE_WORDS)) {
    const count = (text.match(RECIPE_LANGUAGE_WORDS[code]) || []).length;
    if (count > bestCount) { best = code; bestCount = count; }
  }
  return best;
}

// "Translate" offers every app language except the recipe's own. English and the app's language go hand in hand: a
// recipe in another language starts at the app's language, one already in it starts at English. An English recipe
// in an English app starts at the browser's own language when that is one of the app's, or else asks.
function recipeTranslationTarget(recipe) {
  const source = recipeLanguage(recipe);
  if (source !== currentLanguage) return currentLanguage;
  if (source !== 'en') return 'en';
  const preferred = (navigator.languages || [navigator.language || '']).map((code) => String(code).slice(0, 2).toLowerCase());
  return preferred.find((code) => code !== 'en' && LANGUAGES.some((language) => language.code === code)) || '';
}

function chooseRecipeTranslation(id) {
  recipeTranslation = { recipeId: id, choosing: true };
  render();
}

async function startRecipeTranslation(id, chosen) {
  const recipe = recipeById(id);
  if (!recipe) return;
  const source = recipeLanguage(recipe);
  const target = LANGUAGES.some((language) => language.code === chosen) && chosen !== source ? chosen : recipeTranslationTarget(recipe);
  if (!target) return;
  const ingredients = recipe.ingredients || [];
  const steps = recipeInstructions(recipe).map((text) => String(text).trim()).filter(Boolean);
  const texts = [recipe.name, recipe.description || '', ...ingredients, ...steps];
  recipeTranslation = { recipeId: recipe.id, target, loading: true };
  render();
  try {
    const translated = await translateTexts(texts, target, source);
    if (translated.length !== texts.length) throw new Error(t('DeepL returned an incomplete translation.'));
    recipeTranslation = {
      recipeId: recipe.id,
      target,
      result: {
        name: translated[0],
        description: translated[1],
        ingredients: translated.slice(2, 2 + ingredients.length),
        instructions: translated.slice(2 + ingredients.length),
      },
    };
  } catch (error) {
    const message = error?.message || N_('Translation failed.');
    recipeTranslation = { recipeId: recipe.id, target, error: errorText(error, message), needsKey: /API key|DeepL API/.test(message) };
  }
  if (activeView === 'recipe' && recipePageId === recipe.id) render();
}

function saveRecipeTranslation() {
  const original = recipeById(recipeTranslation?.recipeId);
  const result = recipeTranslation?.result;
  if (!original || !result) return;
  const copy = metricRecipe({
    id: `my-${makeId()}`,
    name: result.name || original.name,
    description: result.description || '',
    ingredients: result.ingredients,
    instructions: result.instructions,
    source: 'Translated',
    sourceUrl: original.sourceUrl || '',
    language: recipeTranslation.target,
    translatedFrom: original.id,
    ...(original.photo ? { photo: original.photo } : {}),
  });
  state.recipes.unshift(copy);
  recipeTranslation = null;
  persist();
  openRecipePage(copy.id);
}

function renderRecipeTranslation(recipe) {
  const current = recipeTranslation?.recipeId === recipe.id ? recipeTranslation : null;
  // A hosting phone has no DeepL proxy.
  if (HOSTED) return '';
  if (!current) return `<button class="text-button" type="button" data-action="translate-choose" data-id="${escapeHtml(recipe.id)}">${t('Translate')} ⇄</button>`;
  return '';
}

function renderTranslationPanel(recipe) {
  const current = recipeTranslation?.recipeId === recipe.id ? recipeTranslation : null;
  if (!current) return '';
  if (current.choosing) {
    const source = recipeLanguage(recipe);
    const target = recipeTranslationTarget(recipe);
    const options = (target ? '' : `<option value="" selected disabled>${t('Choose a language')}</option>`) + LANGUAGES.filter((language) => language.code !== source)
      .map((language) => `<option value="${language.code}"${language.code === target ? ' selected' : ''}>${escapeHtml(language.name)}</option>`).join('');
    return `<section class="translation-panel translation-choose"><label class="translation-status" for="translation-target">${t('Translate into')}</label><div class="translation-actions"><select id="translation-target">${options}</select><button class="button button-small button-primary" type="button" data-action="translate-recipe" data-id="${escapeHtml(recipe.id)}">${t('Translate')}</button><button class="button button-small button-quiet" type="button" data-action="translation-discard">${t('Close')}</button></div></section>`;
  }
  const label = escapeHtml(languageName(current.target));
  if (current.loading) return `<section class="translation-panel"><p class="translation-status">${t('Translating to {language}…', { language: label })}</p></section>`;
  if (current.error) {
    return `<section class="translation-panel is-error"><p class="translation-status">${escapeHtml(current.error)}</p><div class="translation-actions">${current.needsKey ?`<button class="button button-small button-outline" type="button" data-action="deepl-help">${t('How to get a key')}</button><button class="button button-small button-outline" type="button" data-action="open-settings" data-open="deepl-settings">${t('Open Settings')}</button>` : ''}<button class="button button-small button-outline" type="button" data-action="translate-recipe" data-id="${escapeHtml(recipe.id)}">${t('Try again')}</button><button class="button button-small button-quiet" type="button" data-action="translation-discard">${t('Close')}</button></div></section>`;
  }
  const { name, description, ingredients, instructions } = current.result;
  let number = 0;
  return `<section class="translation-panel">
      <div class="translation-heading"><span class="eyebrow">${t('TRANSLATION')} · ${label.toUpperCase()}</span><div class="translation-actions"><button class="button button-small button-primary" type="button" data-action="translation-save">${t('Save as a new recipe')}</button><button class="button button-small button-quiet" type="button" data-action="translation-discard">${t('Discard')}</button></div></div>
      <h2>${escapeHtml(name)}</h2>
      ${description ? `<p class="muted">${escapeHtml(description)}</p>` : ''}
      <div class="translation-columns">
        <div><h3>${t('Ingredients')}</h3><ul>${ingredients.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></div>
        <div><h3>${t('Method')}</h3>${instructions.map((line) => (isStepHeading(line) ? `<h4>${escapeHtml(line)}</h4>` : `<p><b>${++number}.</b> ${escapeHtml(line)}</p>`)).join('')}</div>
      </div>
      <p class="field-hint">${t('Translated by DeepL. Amounts and steps keep their order; check it, then save it as a new recipe. The original stays as it is.')}</p>
    </section>`;
}

// Sharing one recipe (0.34): as text anyone can read (Import → "Fill in from text" reads it back), or as a small
// .goodstock-recipe file that Import opens as it is, photo and steps included.
const RECIPE_FILE_EXTENSION = '.goodstock-recipe';
let recipeSharing = null; // { recipeId, status }

function recipeShareText(recipe) {
  let number = 0;
  const steps = recipeInstructions(recipe).map((line) => (isStepHeading(line) ? `\n${line}` : `${++number}. ${line}`));
  const parts = [recipe.name, recipe.description || '', '', t('Ingredients'), ...(recipe.ingredients || []).map((line) => `- ${line}`), '', t('Method'), ...steps];
  if (/^https?:\/\//i.test(recipe.sourceUrl || '')) parts.push('', recipe.sourceUrl);
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function recipeFileContent(recipe) {
  const shared = { name: recipe.name, description: recipe.description || '', ingredients: recipe.ingredients || [], instructions: recipeInstructions(recipe) };
  if (recipe.servings) shared.servings = recipe.servings;
  if (safePhoto(recipe.photo)) shared.photo = recipe.photo;
  if (/^https?:\/\//i.test(recipe.sourceUrl || '')) shared.sourceUrl = recipe.sourceUrl;
  return JSON.stringify({ app: 'goodstock', kind: 'recipe', version: 1, recipe: shared }, null, 1);
}

// A shared recipe from a file or pasted text, or null when it isn't one.
function readRecipeFile(text) {
  try {
    const data = JSON.parse(text);
    const recipe = data && data.app === 'goodstock' && data.kind === 'recipe' && data.recipe;
    if (!recipe || !recipe.name) return null;
    const lines = (value) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);
    return { name: String(recipe.name), description: String(recipe.description || ''), ingredients: lines(recipe.ingredients), instructions: lines(recipe.instructions), servings: Number(recipe.servings) || undefined, photo: safePhoto(recipe.photo) ? recipe.photo : '', sourceUrl: /^https?:\/\//i.test(recipe.sourceUrl || '') ? recipe.sourceUrl : '' };
  } catch { return null; }
}

const recipeFileName = (recipe) => `${String(recipe.name).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'recipe'}${RECIPE_FILE_EXTENSION}`;

async function shareRecipe(id, how) {
  const recipe = recipeById(id);
  if (!recipe) return;
  let status = '';
  try {
    if (how === 'text') {
      const text = recipeShareText(recipe);
      if (STANDALONE) nativeApp.share(text);
      else if (navigator.share) await navigator.share({ title: recipe.name, text });
      else { await navigator.clipboard.writeText(text); status = t('Copied. Paste it into a message.'); }
    } else {
      const name = recipeFileName(recipe);
      const content = recipeFileContent(recipe);
      if (STANDALONE) { await nativeCall('saveFile', name, content); status = t('Saved.'); }
      else {
        const file = new File([content], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ title: recipe.name, files: [file] });
        else {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(file);
          link.download = name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 10000);
          status = t('Downloaded {name}.', { name });
        }
      }
    }
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    status = error && error.message === 'cancelled' ? '' : t('Could not share the recipe.');
  }
  recipeSharing = { recipeId: id, status };
  render();
}

function renderSharePanel(recipe) {
  if (!recipeSharing || recipeSharing.recipeId !== recipe.id) return '';
  const id = escapeHtml(recipe.id);
  return `<section class="translation-panel share-panel"><p class="translation-status">${t('Share this recipe')}</p><p class="field-hint">${t('As text it can be read anywhere; the recipe file opens in Goodstock with its photo and steps (New recipe → Import).')}</p><div class="translation-actions"><button class="button button-small button-primary" type="button" data-action="share-recipe-text" data-id="${id}">${t('Send as text')}</button><button class="button button-small button-outline" type="button" data-action="share-recipe-file" data-id="${id}">${t('Save the recipe file')}</button><button class="button button-small button-quiet" type="button" data-action="share-recipe-close">${t('Close')}</button></div>${recipeSharing.status ? `<p class="field-hint" role="status">${escapeHtml(recipeSharing.status)}</p>` : ''}</section>`;
}

// Settings: the DeepL key, tested before it is saved.
function setDeeplNote(text, kind = '') {
  const note = $('#deepl-note');
  note.textContent = text;
  note.className = `settings-note${kind ? ` is-${kind}` : ''}`;
}

async function loadDeeplSettings() {
  const form = $('#settings-form');
  form.elements.deeplKey.value = '';
  if (STANDALONE) {
    const key = phoneDeeplKey();
    form.elements.deeplKey.placeholder = key ? t('Saved. Leave empty to keep it.') : t('Paste your DeepL API key');
    $('#deepl-disconnect').hidden = !key;
    setDeeplNote(key ? t('Connected. Recipes can be translated into your language.') : t('Not set up. Needed to translate recipes.'), key ? 'connected' : '');
    return;
  }
  try {
    const status = await (await fetch('/api/translate/status')).json();
    form.elements.deeplKey.placeholder = status.configured ? t('Saved. Leave empty to keep it.') : t('Paste your DeepL API key');
    $('#deepl-disconnect').hidden = status.source !== 'settings';
    setDeeplNote(status.configured ? connectedText(deeplUsage(status.usage), status.source === 'environment') : t('Not set up. Needed to translate recipes.'), status.configured ? 'connected' : '');
  } catch {
    setDeeplNote(t('Translation status is unavailable while offline.'));
  }
}

async function saveDeeplSettings() {
  const form = $('#settings-form');
  const apiKey = form.elements.deeplKey.value.trim();
  if (!apiKey) { setDeeplNote(t('Paste your DeepL API key first.'), 'error'); form.elements.deeplKey.focus(); return; }
  setDeeplNote(t('Testing the key…'));
  try {
    let usage = '';
    if (STANDALONE) {
      usage = window.GoodstockDeepl.deeplUsageText(await phoneDeepl('/usage', apiKey));
      localStorage.setItem(DEEPL_PHONE_KEY, apiKey);
    } else {
      const response = await fetch('/api/translate/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw serverError(result, N_('Could not save the DeepL key.'));
      usage = result.usage || '';
    }
    await loadDeeplSettings();
    setDeeplNote(connectedText(deeplUsage(usage)), 'connected');
    // A "no key" error on the recipe page no longer applies.
    if (recipeTranslation?.error) { recipeTranslation = null; render(); }
  } catch (error) {
    setDeeplNote(errorText(error, 'Could not save the DeepL key.'), 'error');
  }
}

// "Connected: 1,234 of 500,000 characters used this month (set in Portainer)." in the chosen language.
function deeplUsage(text) {
  const match = /^([\d,.\s]+) of ([\d,.\s]+) characters used this month$/.exec(String(text || ''));
  return match ? t('{used} of {limit} characters used this month', { used: match[1], limit: match[2] }) : String(text || '');
}

function connectedText(detail, fromEnvironment = false) {
  const text = detail ? t('Connected: {detail}', { detail }) : t('Connected');
  return `${text}${fromEnvironment ? ` ${t('(set in Portainer)')}` : ''}.`;
}

async function disconnectDeepl() {
  if (!window.confirm(t('Remove the DeepL key? Recipes you already translated stay.'))) return;
  if (STANDALONE) localStorage.removeItem(DEEPL_PHONE_KEY);
  else await fetch('/api/translate/config', { method: 'DELETE' }).catch(() => {});
  await loadDeeplSettings();
}

// Favourites (a ★ saved with the recipe, so the household shares them) and how often a recipe was cooked, from the
// meals marked "Cooked ✓" in the plan (the same history the recipe ideas use).
const FAVOURITES_FILTER_KEY = 'goodstock-favourites-filter-v1';
let favouritesOnly = (() => { try { return localStorage.getItem(FAVOURITES_FILTER_KEY) === 'true'; } catch { return false; } })();

// With a label on the recipe page ("★ Favourite"), only the star on recipe cards.
function favouriteButton(recipe, withLabel = false) {
  const on = Boolean(recipe.favourite);
  const hint = on ? t('Remove from favourites') : t('Add to favourites');
  const label = withLabel ? ` ${on ? t('Favourite') : t('Add to favourites')}` : '';
  return `<button class="favourite-button ${withLabel ? 'with-label' : ''} ${on ? 'is-on' : ''}" type="button" data-action="toggle-favourite" data-id="${escapeHtml(recipe.id)}" aria-pressed="${on}" title="${hint}"${withLabel ? '' : ` aria-label="${hint}"`}><span aria-hidden="true">${on ? '★' : '☆'}</span>${label}</button>`;
}

function toggleFavourite(id) {
  const recipe = recipeById(id);
  if (!recipe) return;
  if (recipe.favourite) delete recipe.favourite; else recipe.favourite = true;
  persist();
}

function cookedStats(recipeId) {
  const today = dateKey(new Date());
  const dates = state.plan.filter((entry) => entry.cooked && entry.recipeId === recipeId && entry.date <= today).map((entry) => entry.date).sort();
  return { count: dates.length, last: dates[dates.length - 1] || '' };
}

function cookedText(recipeId) {
  const { count, last } = cookedStats(recipeId);
  if (!count) return t('Not cooked yet');
  const days = Math.round((dateFromKey(dateKey(new Date())) - dateFromKey(last)) / DAY_MS);
  const when = days <= 0 ? t('today') : days === 1 ? t('yesterday') : tp(days, '{count} day ago', '{count} days ago');
  return tp(count, 'Cooked once, last {when}', 'Cooked {count} times, last {when}', { when });
}

// Ratings and notes (0.56). A rating (1–5) is saved as recipe.rating, shared like the favourite; tapping the same star
// again clears it. Notes ("less salt next time") are a list of their own (state.recipeNotes: { id, recipeId, date,
// text }), so notes written on two devices at once merge one by one instead of one recipe copy winning.
const NOTE_MAX_LENGTH = 500;

function ratingStars(recipe, withLabel = false) {
  const rating = Number(recipe.rating) || 0;
  const stars = [1, 2, 3, 4, 5].map((value) => `<button class="rating-star ${value <= rating ? 'is-on' : ''}" type="button" data-action="rate-recipe" data-id="${escapeHtml(recipe.id)}" data-value="${value}" aria-pressed="${value === rating}" aria-label="${tp(value, '{count} star', '{count} stars')}"><span aria-hidden="true">${value <= rating ? '★' : '☆'}</span></button>`).join('');
  const label = withLabel ? `<span class="rating-label">${rating ? t('Your rating') : t('Rate it')}</span>` : '';
  return `<div class="recipe-rating" role="group" data-rating-for="${escapeHtml(recipe.id)}" aria-label="${rating ? t('Rated {rating} of 5', { rating }) : t('Rate this recipe')}">${label}${stars}</div>`;
}

// Recipe cards only show a rating, read-only.
function ratingText(recipe) {
  const rating = Number(recipe.rating) || 0;
  if (!rating) return '';
  return `<p class="recipe-card-rating"><span aria-hidden="true">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span><span class="visually-hidden">${t('Rated {rating} of 5', { rating })}</span></p>`;
}

function rateRecipe(id, value) {
  const recipe = recipeById(id);
  if (!recipe || !(value >= 1 && value <= 5)) return;
  if (Number(recipe.rating) === value) delete recipe.rating; else recipe.rating = value;
  // Cook mode is a dialog the page render doesn't redraw: update its stars in place.
  for (const group of $$('#steps-dialog [data-rating-for], #cook-dialog [data-rating-for]')) {
    if (group.dataset.ratingFor === id) group.outerHTML = ratingStars(recipe, true);
  }
  persist();
}

function recipeNotes(recipeId) {
  return state.recipeNotes.filter((note) => note.recipeId === recipeId).sort((first, second) => String(second.date).localeCompare(String(first.date)));
}

function addRecipeNote(recipeId, text) {
  const clean = String(text || '').trim().slice(0, NOTE_MAX_LENGTH);
  if (!clean || !recipeById(recipeId)) return false;
  state.recipeNotes.unshift({ id: makeId(), recipeId, date: dateKey(new Date()), text: clean });
  return true;
}

function deleteRecipeNote(id) {
  const note = state.recipeNotes.find((entry) => entry.id === id);
  if (!note) return;
  withUndo(t('Note deleted'), ['recipeNotes'], () => {
    state.recipeNotes = state.recipeNotes.filter((entry) => entry.id !== id);
  });
}

function noteList(notes, withDelete = true) {
  return `<ul class="recipe-notes">${notes.map((note) => `<li><time datetime="${escapeHtml(note.date)}">${escapeHtml(dateFromKey(note.date) ? expirationDateText(note.date) : '')}</time><p>${escapeHtml(note.text)}</p>${withDelete ? `<button class="text-button recipe-note-delete" type="button" data-action="delete-recipe-note" data-id="${escapeHtml(note.id)}" aria-label="${t('Delete note')}">${t('Delete')}</button>` : ''}</li>`).join('')}</ul>`;
}

function renderRecipeNotes(recipe) {
  const notes = recipeNotes(recipe.id);
  return `<section class="section-block recipe-notes-block"><div class="section-heading"><div><h2>${t('Notes')}</h2><span class="muted">${notes.length ? tp(notes.length, '{count} note', '{count} notes') : t('What to remember next time')}</span></div></div>
    ${notes.length ? noteList(notes) : ''}
    <form class="recipe-note-form" id="recipe-note-form" data-id="${escapeHtml(recipe.id)}"><textarea name="text" rows="2" maxlength="${NOTE_MAX_LENGTH}" placeholder="${t('Less salt next time, the kids loved it…')}" aria-label="${t('New note')}"></textarea><button class="button button-outline button-small" type="submit">${t('Add note')}</button></form></section>`;
}

// Allergens and diets (0.49), from the ingredient lines: the catalog entry a line is about, and words for common
// allergens the catalog doesn't have, in the app's languages (accents dropped, matched at the start of a word; Chinese
// and Japanese anywhere). Only a hint: a recipe's text can always hide something, and the page says so.
const ALLERGENS = {
  gluten: { catalog: ['bread', 'flour', 'pasta', 'oats', 'soy-sauce'], words: ['wheat', 'tarwe', 'weizen', 'trigo', 'grano', 'frumento', 'пшениц', 'grau', 'pszen', 'bugday', 'قمح', 'חיטה', '小麦', 'barley', 'gerst', 'orge', 'cebada', 'orzo', 'cevada', 'ячмен', 'rye', 'rogge', 'roggen', 'seigle', 'centeno', 'segale', 'centeio', 'рож', 'couscous', 'bulgur', 'semolina', 'griesmeel', 'griess', 'semoule', 'semola', 'spelt', 'dinkel', 'epeautre', 'noodle', 'noedel', 'nudel', 'nouille', 'fideo', 'breadcrumb', 'paneermeel', 'paniermehl', 'chapelure', 'pan rallado', 'pangrattato', 'panko', 'tortilla', 'pita', 'cracker', 'beschuit', 'udon', 'ramen', 'うどん', '面条', '面粉', '麺', '小麦粉'] },
  milk: { catalog: ['milk', 'butter', 'cheese', 'yogurt', 'cream', 'parmesan'], words: ['mozzarella', 'ricotta', 'feta', 'mascarpone', 'ghee', 'buttermilk', 'karnemelk', 'quark', 'kwark', 'creme fraiche', 'crème fraîche', 'sour cream', 'zure room', 'kefir', 'paneer', 'gouda', 'cheddar', 'brie', 'halloumi', 'cottage', 'сливк', 'сыр', 'творог', 'kaas', 'fromage', 'queso', 'formaggio', 'queijo', 'käse', 'kase', 'panna', 'sahne', 'smetana', '奶酪', '奶油', 'チーズ', '生クリーム', 'iaurt', 'brânză', 'smântân', 'peynir', 'yoğurt', 'jogurt', 'śmietan', 'جبن', 'زبدة', 'גבינה', 'חמאה'] },
  eggs: { catalog: ['egg'], words: ['mayonnaise', 'mayo', 'meringue', 'eidooier', 'eiwit', 'yolk', '蛋', '卵'] },
  nuts: { catalog: [], words: ['almond', 'amandel', 'mandel', 'amande', 'almendra', 'mandorl', 'amendoa', 'migdal', 'migdał', 'badem', 'миндал', 'لوز', 'שקד', '杏仁', 'アーモンド', 'walnut', 'walnoot', 'walnuss', 'noix', 'nuez', 'nueces', 'noce', 'noci', 'noz', 'nozes', 'nuca', 'orzech', 'ceviz', 'грецк', 'орех', 'جوز', 'אגוז', '核桃', 'くるみ', 'hazelnut', 'hazelnoot', 'haselnuss', 'noisette', 'avellana', 'nocciol', 'avela', 'alun', 'fındık', 'fundu', 'фундук', 'بندق', '榛', 'ヘーゼルナッツ', 'cashew', 'cajou', 'anacard', 'caju', 'кешью', 'كاجو', 'קשיו', '腰果', 'カシュー', 'pecan', 'pistachio', 'pistache', 'pistazie', 'pistacho', 'pistacchi', 'fistic', 'fisztaszk', 'antep', 'фисташ', 'فستق', 'פיסטוק', '开心果', 'ピスタチオ', 'macadamia', 'pine nut', 'pijnboompit', 'pinienkern', 'pignon', 'pinon', 'pinoli', 'nuts', 'noten', 'nusse'] },
  peanuts: { catalog: ['peanut-butter'], words: ['peanut', 'pinda', 'erdnuss', 'cacahuete', 'cacahuète', 'arachide', 'arachid', 'amendoim', 'alune', 'orzeszki ziemne', 'yer fıstığı', 'арахис', 'فول سوداني', 'בוטנ', '花生', 'ピーナッツ'] },
  fish: { catalog: ['salmon', 'tuna'], words: ['fish', 'vis', 'fisch', 'poisson', 'pescado', 'pesce', 'peixe', 'peste', 'ryba', 'balık', 'рыб', 'سمك', 'דג', '鱼', '魚', 'cod', 'kabeljauw', 'kabeljau', 'cabillaud', 'bacalao', 'merluzz', 'bacalhau', 'треск', 'anchov', 'ansjovis', 'sardel', 'anchois', 'anchoa', 'acciug', 'alici', 'anchova', 'sardin', 'haddock', 'schelvis', 'trout', 'forel', 'forelle', 'truite', 'trucha', 'trota', 'mackerel', 'makreel', 'makrele', 'maquereau', 'caballa', 'sgombr', 'herring', 'haring', 'hering', 'hareng', 'arenque', 'aringa', 'tilapia', 'pollock', 'koolvis', 'zalm', 'lachs', 'saumon', 'salmón', 'salmone', 'salmão', 'tonijn', 'thon', 'atún', 'tonno', 'atum', 'thunfisch', 'лосос', 'тунец', '三文鱼', '金枪鱼', 'サーモン', 'ツナ', 'fish sauce', 'vissaus'] },
  shellfish: { catalog: ['shrimp'], words: ['prawn', 'garnaal', 'garnalen', 'garnele', 'crevette', 'gamba', 'camaron', 'gamber', 'camarao', 'creveti', 'krewetk', 'karides', 'креветк', 'روبيان', 'جمبري', 'שרימפס', '虾', 'えび', 'エビ', 'crab', 'krab', 'krabbe', 'crabe', 'cangrejo', 'granchio', 'caranguejo', 'краб', 'lobster', 'kreeft', 'hummer', 'homard', 'langosta', 'aragost', 'lagosta', 'mussel', 'mossel', 'muschel', 'moule', 'mejillon', 'cozz', 'mexilhao', 'мидии', 'clam', 'vongol', 'almeja', 'oyster', 'oester', 'auster', 'huître', 'ostra', 'scallop', 'sint-jakobsschelp', 'jakobsmuschel', 'saint-jacques', 'vieira', 'capesant', 'squid', 'inktvis', 'calamar', 'octopus', 'pulpo', 'polpo', 'kalmar'] },
  soy: { catalog: ['soy-sauce'], words: ['soy', 'soja', 'soia', 'sojowy', 'tofu', 'tempeh', 'edamame', 'miso', 'соев', 'тофу', 'صويا', 'סויה', '豆腐', '大豆', '酱油', '醤油', '味噌'] },
  sesame: { catalog: [], words: ['sesam', 'sesame', 'sésamo', 'sesamo', 'susan', 'sezam', 'susam', 'кунжут', 'سمسم', 'שומשום', '芝麻', 'ごま', '胡麻', 'tahini', 'tahin', 'طحينة', 'טחינה'] },
  celery: { catalog: ['celery'], words: ['celeriac', 'knolselderij', 'knollensellerie', 'celeri-rave', 'apionabo'] },
  mustard: { catalog: [], words: ['mustard', 'mosterd', 'senf', 'moutarde', 'mostaza', 'senape', 'mostarda', 'mustar', 'musztard', 'hardal', 'горчиц', 'خردل', 'חרדל', '芥末', 'マスタード', 'からし'] },
  meat: { catalog: ['chicken', 'beef', 'minced-beef', 'bacon'], words: ['ham', 'pork', 'varken', 'schwein', 'porc', 'cerdo', 'maiale', 'porco', 'porc', 'wieprz', 'domuz', 'свинин', '猪肉', '豚肉', 'lamb', 'lams', 'lamm', 'agneau', 'cordero', 'agnello', 'cordeiro', 'jagni', 'kuzu', 'баранин', 'ягнят', 'sausage', 'worst', 'wurst', 'saucisse', 'salchich', 'salsicc', 'linguica', 'carnat', 'kiełbas', 'sucuk', 'колбас', 'сосиск', 'chorizo', 'turkey', 'kalkoen', 'pute', 'truthahn', 'dinde', 'pavo', 'tacchino', 'peru', 'curcan', 'indyk', 'hindi', 'индейк', 'duck', 'eend', 'ente', 'canard', 'pato', 'anatra', 'kaczk', 'ördek', 'утк', 'veal', 'kalfs', 'kalb', 'veau', 'ternera', 'vitello', 'vitela', 'cielęc', 'телятин', 'gelatin', 'gelatine', 'prosciutto', 'salami', 'pancetta', 'gehakt', 'hackfleisch', 'meat', 'vlees', 'fleisch', 'viande', 'carne', 'mięs', 'мяс', 'لحم', 'בשר', 'kip', 'huhn', 'hähnchen', 'poulet', 'pollo', 'frango', 'pui', 'kurczak', 'tavuk', 'куриц', 'دجاج', 'עוף', '鸡肉', '鶏肉', 'rund', 'boeuf', 'manzo', 'carne bovina', 'wołow', 'говядин', '牛肉', 'spek', 'speck', 'lard', 'tocino', 'bacon', 'бекон'] },
  honey: { catalog: ['honey'], words: ['honing', 'miel', 'miele', 'miere', 'miod', 'мед', 'мёд', 'عسل', 'דבש', '蜂蜜', 'はちみつ'] },
};
const ALLERGEN_NAMES = { gluten: N_('gluten'), milk: N_('milk'), eggs: N_('eggs'), nuts: N_('nuts'), peanuts: N_('peanuts'), fish: N_('fish'), shellfish: N_('shellfish'), soy: N_('soy'), sesame: N_('sesame'), celery: N_('celery'), mustard: N_('mustard') };
// "coconut milk", "almond drink": not dairy (the almond still counts as a nut).
const PLANT_MILK = /(coconut|kokos|coco|almond|amandel|mandel|amande|almendra|oat|haver|hafer|avoine|avena|soy|soja|rice|rijst|reis|riz|arroz)[ -]?(milk|melk|milch|lait|leche|latte|leite|drink|drank)/;
// Nutmeg and coconut are not tree nuts.
const NOT_NUTS = /nutmeg|nootmuskaat|muskatnuss|muscade|moscada|moscata|noix de coco|coconut|kokos|coco/g;
const foldText = (text) => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const CJK_WORD = /[぀-ヿ㐀-鿿]/;
let allergenPatterns = null;
const recipeContentsCache = new Map();

function allergenPattern(words) {
  const escape = (word) => foldText(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plain = words.filter((word) => !CJK_WORD.test(word)).map(escape);
  const cjk = words.filter((word) => CJK_WORD.test(word)).map(escape);
  return new RegExp([plain.length ? `(?:^|[^\\p{L}])(?:${plain.join('|')})` : '', ...cjk].filter(Boolean).join('|'), 'u');
}

// What a recipe contains, as ALLERGENS keys (including meat and honey, for the diets).
function recipeContents(recipe) {
  const lines = recipe.ingredients || [];
  const key = lines.join('\n');
  if (recipeContentsCache.has(key)) return recipeContentsCache.get(key);
  if (!allergenPatterns) allergenPatterns = Object.fromEntries(Object.entries(ALLERGENS).map(([name, { words }]) => [name, allergenPattern(words)]));
  const found = new Set();
  for (const line of lines) {
    const folded = foldText(line);
    const plantMilk = PLANT_MILK.test(folded);
    const text = plantMilk ? folded.replace(PLANT_MILK, '$1 drink') : folded;
    const record = ingredientRecord(line);
    for (const [name, { catalog }] of Object.entries(ALLERGENS)) {
      if (name === 'milk' && plantMilk) continue;
      if ((record && catalog.includes(record.id)) || allergenPatterns[name].test(name === 'nuts' ? text.replace(NOT_NUTS, ' ') : text)) found.add(name);
    }
  }
  if (recipeContentsCache.size > 2000) recipeContentsCache.clear();
  recipeContentsCache.set(key, found);
  return found;
}

function recipeDiet(recipe) {
  const contents = recipeContents(recipe);
  if (!(recipe.ingredients || []).length || ['meat', 'fish', 'shellfish'].some((name) => contents.has(name))) return '';
  return ['milk', 'eggs', 'honey'].some((name) => contents.has(name)) ? 'vegetarian' : 'vegan';
}

function recipeAllergens(recipe) {
  const contents = recipeContents(recipe);
  return Object.keys(ALLERGEN_NAMES).filter((name) => contents.has(name));
}

// "Vegetarian · Contains: gluten, milk" on cards and the recipe page.
function dietLine(recipe, withHint = false) {
  const diet = recipeDiet(recipe);
  const allergens = recipeAllergens(recipe);
  if (!diet && !allergens.length) return '';
  const parts = [diet === 'vegan' ? t('Vegan') : diet === 'vegetarian' ? t('Vegetarian') : '', allergens.length ? t('Contains: {items}', { items: allergens.map((name) => t(ALLERGEN_NAMES[name])).join(', ') }) : ''].filter(Boolean);
  const hint = t('A hint from the ingredient names. Check the packaging when it matters.');
  return `<p class="recipe-diet"${withHint ? '' : ` title="${hint}"`}>${diet ? `<span class="diet-tag">${escapeHtml(parts.shift())}</span>` : ''}${escapeHtml(parts.join(''))}${withHint ? `<small>${hint}</small>` : ''}</p>`;
}

// Recipe filters for diets and allergens, per browser like the favourites filter.
const DIET_FILTERS = { vegetarian: N_('Vegetarian'), vegan: N_('Vegan'), 'no-gluten': N_('Without gluten'), 'no-milk': N_('Without milk'), 'no-nuts': N_('Without nuts') };
const DIET_FILTER_KEY = 'goodstock-diet-filter-v1';
let dietFilters = (() => { try { return JSON.parse(localStorage.getItem(DIET_FILTER_KEY) || '[]').filter((name) => name in DIET_FILTERS); } catch { return []; } })();

function toggleDietFilter(name) {
  dietFilters = dietFilters.includes(name) ? dietFilters.filter((other) => other !== name) : [...dietFilters, name];
  try { localStorage.setItem(DIET_FILTER_KEY, JSON.stringify(dietFilters)); } catch { /* Per browser only. */ }
  render();
}

function passesDietFilters(recipe) {
  const contents = recipeContents(recipe);
  const diet = recipeDiet(recipe);
  return dietFilters.every((name) => (name === 'vegetarian' ? Boolean(diet)
    : name === 'vegan' ? diet === 'vegan'
      : name === 'no-gluten' ? !contents.has('gluten')
        : name === 'no-milk' ? !contents.has('milk')
          : !contents.has('nuts') && !contents.has('peanuts')));
}

function recipeCard(recipe, isRemote = false) {
  const missing = missingIngredients(recipe);
  const status = missing.length === 0 ? t('You have everything') : tp(missing.length, '{count} missing: {items}', '{count} missing: {items}', { items: `${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}` });
  const planned = currentWeekPlans().some((entry) => entry.recipeId === recipe.id);
  const button = isRemote
    ? `<button class="button button-small button-dark" data-action="import-recipe" data-id="${escapeHtml(recipe.slug || recipe.id)}">${t('Add to library')} <span aria-hidden="true">＋</span></button>`
    : `<button class="button button-small ${planned ? 'button-outline' : 'button-dark'}" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">${planned ? t('Plan another day') : t('Plan this week')} <span aria-hidden="true">→</span></button>`;
  return `<article class="recipe-card${safePhoto(recipe.photo) ? ' has-photo' : ''}">${recipePhoto(recipe, 'recipe-card-photo')}<div class="recipe-card-top"><span class="recipe-source">${escapeHtml(sourceLabel(recipe.source))}</span><span class="recipe-ingredient-count">${tp(recipe.ingredients?.length || 0, '{count} INGREDIENT', '{count} INGREDIENTS')}</span>${isRemote ? '' : favouriteButton(recipe)}</div><h3><button class="recipe-title-link recipe-card-title" type="button" data-action="view-recipe" data-id="${escapeHtml(isRemote ? recipe.slug || recipe.id : recipe.id)}" data-remote="${isRemote}" title="${t('Show recipe')}">${escapeHtml(recipe.name)}</button></h3><p>${escapeHtml(recipe.description || t('A recipe from your collection.'))}</p>${isRemote ? '' : `${ratingText(recipe)}${dietLine(recipe)}`}<div class="recipe-missing ${missing.length ? 'has-missing' : ''}"><span aria-hidden="true">${missing.length ? '◷' : '✓'}</span>${escapeHtml(status)}</div><div class="recipe-card-bottom">${button}</div></article>`;
}

function renderRecipes() {
  const hasFavourites = state.recipes.some((recipe) => recipe.favourite);
  const onlyFavourites = favouritesOnly && hasFavourites;
  const localRecipes = state.recipes.filter((recipe) => (!onlyFavourites || recipe.favourite) && passesDietFilters(recipe) && matchesSearch(recipeQuery, `${recipe.name} ${recipe.description || ''} ${(recipe.ingredients || []).join(' ')}`, recipe.ingredients || []));
  // Closest to ready first; between equals, the best rated.
  const sorted = [...localRecipes].sort((first, second) => missingIngredients(first).length - missingIngredients(second).length || (Number(second.rating) || 0) - (Number(first.rating) || 0));
  const actions = `<div class="recipe-heading-actions"><button class="button button-primary" data-action="new-recipe">＋ ${t('New recipe')}</button><button class="button button-outline" data-action="open-recipe-import">${t('Import')} <span aria-hidden="true">↓</span></button></div>`;
  return `${pageHeading(t('FROM YOUR SHELF'), t('What sounds good?'), t('Find something to make with what you have, or a few things you could grab.'), actions)}
    <form class="recipe-search" id="recipe-search-form"><span aria-hidden="true">⌕</span><input id="recipe-search" value="${escapeHtml(recipeQuery)}" placeholder="${t('Search recipes or ingredients')}" aria-label="${t('Search recipes or ingredients')}"/><button class="button button-primary" type="submit">${t('Search my recipes')}</button><button class="button button-outline search-online-button" type="button" data-action="search-online" ${recipeQuery.trim() ? '' : 'hidden'}>${t('Search online')} <span aria-hidden="true">↗</span></button></form>
    ${renderIdeas()}
    ${mealieConfigured ? `<button class="button button-outline stock-search-button" data-action="search-stocked">${t('Find with my inventory')} <span aria-hidden="true">↗</span></button>` : ''}
    <div class="recipe-results-heading"><div><span class="eyebrow">${t('YOUR RECIPE BOX')}</span><h2>${onlyFavourites ? t('Favourites') : t('Closest to ready')}</h2></div><div class="recipe-results-tools">${hasFavourites ? `<button class="favourites-filter ${onlyFavourites ? 'active' : ''}" type="button" data-action="favourites-filter" aria-pressed="${onlyFavourites}">★ ${t('Favourites')}</button>` : ''}<span class="muted">${tp(sorted.length, '{count} recipe', '{count} recipes')}</span></div></div>
    ${state.recipes.length ? `<div class="diet-filters" role="group" aria-label="${t('Diets and allergens')}">${Object.entries(DIET_FILTERS).map(([name, label]) => `<button class="diet-filter ${dietFilters.includes(name) ? 'active' : ''}" type="button" data-action="diet-filter" data-filter="${name}" aria-pressed="${dietFilters.includes(name)}">${t(label)}</button>`).join('')}</div>` : ''}
    <div class="recipe-grid">${sorted.length ? sorted.map((recipe) => recipeCard(recipe)).join('') : `<p class="muted">${t('No recipes match that search.')}</p>`}</div>
    ${mealieConfigured ? `<div class="recipe-results-heading remote-heading"><div><span class="eyebrow">${t('MEALIE LIBRARY')}</span><h2>${mealieResults.length ? t('From Mealie') : t('Search your recipes')}</h2></div><span class="muted">${t('Connected')}</span></div><div class="recipe-grid">${mealieResults.map((recipe) => recipeCard(recipe, true)).join('')}</div>` : STANDALONE || HOSTED ? "" : `<div class="integration-note"><span class="integration-mark">M</span><p><strong>${t('Already using Mealie?')}</strong><br/>${t('Connect it in Settings to search and import your recipe library here.')}</p><button class="button button-small button-outline" type="button" data-action="open-settings" data-open="mealie-settings">${t('Connect')}</button></div>`}`;
}

function mealieRecipeLink(recipe, className, label) {
  const href = recipe.source === 'Mealie' && recipe.slug ? mealieOpenUrl(recipe.slug) : '';
  return href
    ? `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${t('Open recipe in Mealie')}">${label} <span aria-hidden="true">↗</span></a>`
    : '';
}

async function openRecipeDialog(id, isRemote, planId = '') {
  let recipe = isRemote ? mealieResults.find((entry) => entry.id === id || entry.slug === id) : recipeById(id);
  if (!recipe) return;
  if (planId) recipe = scaledRecipe(recipe, planScale(state.plan.find((entry) => entry.id === planId)));
  if (isRemote && !recipe.ingredients?.length && recipe.slug) {
    try {
      recipe = metricRecipe(await mealieRecipe(recipe.slug));
    } catch { /* Show the search-result details when Mealie is unavailable. */ }
  }
  $('#recipe-dialog-source').textContent = sourceLabel(recipe.source).toUpperCase();
  $('#recipe-dialog-title').textContent = recipe.name;
  $('#recipe-dialog-description').textContent = recipe.description || '';
  $('#recipe-dialog-description').hidden = !recipe.description;
  const ingredients = recipe.ingredients || [];
  $('#recipe-dialog-steps').hidden = true;
  $('#recipe-dialog-ingredients').innerHTML = ingredients.length
    ? ingredients.map((ingredient) => {
      const item = matchingInventory(ingredient);
      return `<li class="${item ? 'in-stock' : 'not-stocked'}"><span aria-hidden="true">${item ? '✓' : '○'}</span><span>${escapeHtml(ingredient)}</span><small>${inStockText(item)}</small></li>`;
    }).join('')
    : `<li class="not-stocked"><span></span><span>${t('No ingredients listed.')}</span></li>`;
  const planAction = planId
    ? ''
    : isRemote
      ? `<button class="button button-primary" type="button" data-action="import-recipe" data-id="${escapeHtml(recipe.slug || recipe.id)}">${t('Add to library')}</button>`
      : `<button class="button button-primary" type="button" data-action="plan-recipe" data-id="${escapeHtml(recipe.id)}">${t('Plan this week')}</button>`;
  if (planId) {
    const missing = missingIngredients(recipe).length;
    $('#recipe-dialog-source').textContent = `${t('REVIEW')} · ${missing ? tp(missing, '{count} MISSING', '{count} MISSING') : t('ALL IN STOCK')}`;
  }
  recipeDialogRecipe = recipe;
  recipeDialogPlanId = planId;
  const safeSourceUrl = /^https?:\/\//i.test(recipe.sourceUrl || '') ? recipe.sourceUrl : '';
  const manage = isRemote ? '' : `<button class="button button-quiet" type="button" data-action="view-recipe" data-id="${escapeHtml(recipe.id)}">${t('Full recipe')}</button><button class="button button-quiet" type="button" data-action="edit-recipe" data-id="${escapeHtml(recipe.id)}">${t('Edit')}</button><button class="button button-quiet recipe-delete-button" type="button" data-action="delete-recipe" data-id="${escapeHtml(recipe.id)}">${t('Delete')}</button>`;
  const original = safeSourceUrl ? `<a class="button button-quiet" href="${escapeHtml(safeSourceUrl)}" target="_blank" rel="noopener noreferrer">${t('Original')} <span aria-hidden="true">↗</span></a>` : '';
  $('#recipe-dialog-actions').innerHTML = `${manage}${original}${mealieRecipeLink(recipe, 'button button-quiet mealie-button', t('Open in Mealie'))}<button class="button button-outline" type="button" data-action="start-steps" data-source="recipe-dialog">${t('Step by step')} <span aria-hidden="true">▶</span></button>${planAction}`;
  const dialog = $('#recipe-dialog');
  if (!dialog.open) dialog.showModal();
}
