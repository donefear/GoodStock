# Goodstock tests

`npm test` runs everything: the translation check, the page tests in `tests/page/` (run inside the real app in
Chromium) and the end-to-end tests in `tests/e2e/`, each against its own fresh server with an empty data folder, so
your kitchen is never touched. `node tests/run.mjs pin sync` runs only the tests whose names contain those words;
`VERBOSE=1` prints what each test saw. GitHub runs the suite on every push (`.github/workflows/tests.yml`).

Without Node on the computer, run it in Docker (from the repository folder):

    docker run --rm --user root -v "$PWD":/app -v goodstock-test-cache:/root/.cache -w /app \
      ghcr.io/puppeteer/puppeteer:latest sh -c "npm install --no-audit --no-fund && node tests/run.mjs"

The suite uses a current Chromium. The kitchen tablet runs Chrome 81, so after bigger changes also open the app on
the tablet (or in Chromium 80 through puppeteer 2.1.1, which needs its own small script because its API is older).

Writing tests:

- A page test is the body of an async function that runs in the app page and returns `{ fail: [...], log: [...] }`;
  app functions and `state` are available as globals.
- An end-to-end test exports `default async ({ browser, base, phoneShim }) => ({ fail, log, skip })`. `base` is
  the server address; `phoneShim` is a script for `page.evaluateOnNewDocument` that turns the page into the phone
  app (see `tests/helpers/phone-shim.js`).
