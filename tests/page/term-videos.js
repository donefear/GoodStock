const fail = []; const log = [];
const want = { en: 'how to Blanch cooking technique', nl: 'Blancheren kooktechniek', de: 'Kochtechnik', ja: '調理法' };
for (const code of Object.keys(want)) {
  await setLanguage(code);
  toolsTab = 'terms'; termsQuery = 'blan'; activeView = 'tools'; render();
  const link = document.querySelector('#terms-list .term-card a');
  const query = link ? new URL(link.href).searchParams.get('search_query') : '';
  log.push(`${code}: ${query}`);
  if (!query.includes(want[code])) fail.push(`${code}: search "${query}" does not contain "${want[code]}"`);
}
await setLanguage('en');
return { fail, log };
