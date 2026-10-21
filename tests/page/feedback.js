const fail = []; const log = [];
const links = document.querySelectorAll('#settings-dialog [data-feedback]');
if (links.length !== 2) fail.push(`expected 2 feedback links in Settings, found ${links.length}`);
for (const [code, kind, prompt] of [['en', 'problem', 'What happened'], ['nl', 'idea', 'Je idee']]) {
  await setLanguage(code);
  const mail = new URL(feedbackMailto(kind));
  const subject = mail.searchParams.get('subject');
  const body = mail.searchParams.get('body');
  log.push(`${code} ${kind}: ${subject}`);
  if (mail.protocol !== 'mailto:' || mail.pathname !== 'donefear.space@gmail.com') fail.push(`${code}: sent to ${mail.protocol}${mail.pathname}`);
  if (subject !== `Goodstock ${kind} (v${appVersion()})`) fail.push(`${code}: subject "${subject}"`);
  if (!body.startsWith(prompt)) fail.push(`${code}: body does not start with "${prompt}": ${body.slice(0, 40)}`);
  if (!body.includes(`Goodstock v${appVersion()}`) || !body.includes(code)) fail.push(`${code}: body lacks version or language`);
}
await setLanguage('en');
return { fail, log };
