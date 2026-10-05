# Goodstock for Windows, macOS and Linux

A standalone desktop app, like the phone apps: Goodstock in its own window, with everything (inventory, recipes,
plans, shopping list) kept on this computer. No server is needed. Use **Settings → Back up** to save a copy, or
**Automatic weekly backup** to keep the newest four in a folder you choose (for example OneDrive or Dropbox). To
share one kitchen with the household instead, connect it to your Goodstock server under **Settings → Home server**.

Built with [Electron](https://www.electronjs.org/): `main.js` opens the window and answers the page's
`window.GoodstockNative` calls (from `preload.js`), the same methods as the Android and iOS bridges.

## Downloads

`.github/workflows/desktop.yml` builds all three on every push to `main` or `experiments`. Download them from the
run's **Artifacts**; a `v*` tag also attaches them to the GitHub release.

- **Windows:** `Goodstock-vX.Y.Z-windows-portable.exe` runs as it is, from anywhere (a USB stick too).
  `Goodstock-vX.Y.Z-windows-setup.exe` installs it with a Start menu entry; Windows only shows Goodstock's
  notifications for the installed version. The files are not signed, so SmartScreen says "Windows protected your
  PC" the first time: **More info → Run anyway**.
- **Linux:** `Goodstock-vX.Y.Z-linux-x86_64.AppImage`: `chmod +x` it and run it.
- **macOS:** `Goodstock-vX.Y.Z-mac.dmg` (Apple silicon and Intel). Drag Goodstock to Applications. It is not
  notarized, so the first time macOS refuses to open it: **System Settings → Privacy & Security → Open Anyway**.

## What works differently from the browser version

- Timers ring in the window; when Goodstock is in the background they also show a notification and flash the
  taskbar button. Use-soon reminders are notifications while the app is open.
- Recipe links, Mealie, DeepL and the home server are reached by the app itself, so there are no browser limits.
- **Share list** copies the shopping list for pasting into a message (macOS shows its share menu).
- Barcodes are typed in; there is no camera scanner.
- Data lives in the app's own storage in the user profile (`%APPDATA%\Goodstock`, `~/Library/Application Support/Goodstock`,
  `~/.config/Goodstock`), the same for the portable and installed Windows versions.

## Build locally

- **Run from the source** (needs Node 22): `cd desktop && npm install && npm start`.
- **Windows and Linux files with Docker** (from the repository root, in WSL or Linux): `bash desktop/build.sh`. The
  files land in `dist/desktop/`. The Mac app needs a Mac, so GitHub builds it.

`prepare.mjs` copies the web files into `desktop/web` before each build (keep its list in step with `webFiles` in
`android/app/build.gradle` and `ios/scripts/copy-web.sh`) and reads the version from the `Goodstock vX.Y.Z` label in
`index.html`.
