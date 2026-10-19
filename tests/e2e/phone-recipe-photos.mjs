// Phone apps (0.33): an imported recipe's photo is downloaded through the bridge and kept as a small JPEG; when that
// fails, or an older app has no fetchImage, the web address stays.
export default async function run({ browser, base, phoneShim }) {
  const fail = [];
  const log = [];
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.evaluateOnNewDocument(phoneShim);
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2' });
  const result = await page.evaluate(async () => {
    const kept = await importedPhoto('https://example.com/cake.png');
    const failed = await importedPhoto('https://example.com/fail.png');
    const fetchImage = window.GoodstockNative.fetchImage;
    delete window.GoodstockNative.fetchImage;
    const older = await importedPhoto('https://example.com/old.png');
    window.GoodstockNative.fetchImage = fetchImage;
    return { kept: kept.slice(0, 30), safe: safePhoto(kept), failed, older, asked: window.__images };
  });
  log.push(JSON.stringify(result));
  if (!/^data:image\/jpeg;base64,/.test(result.kept) || !result.safe) fail.push('the photo was not kept as a small JPEG');
  if (result.failed !== 'https://example.com/fail.png') fail.push('a failed download should keep the web address');
  if (result.older !== 'https://example.com/old.png') fail.push('an app without fetchImage should keep the web address');
  await page.close();
  return { fail, log };
}
