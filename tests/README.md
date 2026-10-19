# Goodstock tests

`npm test` runs everything: the translation check, the version check, a static check for code the kitchen tablet's Chrome 81 can't run (`tools/check-chrome81.mjs`) (the `sw.js` cache name matches the
`index.html` label, see `npm run bump`), the page tests in `tests/page/` (run inside the real app in
Chromium) and the end-to-end tests in `tests/e2e/`, each against its own fresh server with an empty data folder, so
your kitchen is never touched. `node tests/run.mjs pin sync` runs only the tests whose names contain those words;
`VERBOSE=1` prints what each test saw. GitHub runs the suite on every push (`.github/workflows/tests.yml`).

Without Node on the computer, run it in Docker (from the repository folder):

    docker run --rm --user root -v "$PWD":/app -v goodstock-test-cache:/root/.cache -w /app \
      ghcr.io/puppeteer/puppeteer:latest sh -c "npm install --no-audit --no-fund && node tests/run.mjs"

The suite uses a current Chromium. The kitchen tablet runs Chrome 81, so `tests/chrome80/run.cjs` also opens every
page, the main dialogs and cook mode in Chromium 80 (puppeteer 2.1.1, in its own folder because its API is older),
and fails on any script error. GitHub runs it as "Kitchen tablet (Chromium 80)". Locally:

    cd tests/chrome80 && npm install && node run.cjs

In Docker it needs a Debian image (`node:22-bookworm`) with Chromium's libraries (libnss3, libgbm1, libgtk-3-0,
libasound2…). The optional HTTPS service has its own check, `bash tools/check-https.sh`.

Writing tests:

- A page test is the body of an async function that runs in the app page and returns `{ fail: [...], log: [...] }`;
  app functions and `state` are available as globals.
- An end-to-end test exports `default async ({ browser, base, phoneShim }) => ({ fail, log, skip })`. `base` is
  the server address; `phoneShim` is a script for `page.evaluateOnNewDocument` that turns the page into the phone
  app (see `tests/helpers/phone-shim.js`).
