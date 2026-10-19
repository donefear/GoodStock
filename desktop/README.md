# Goodstock for Windows, macOS and Linux

A standalone desktop app, like the phone apps: Goodstock in its own window, with everything (inventory, recipes,
plans, shopping list) kept on this computer. No server is needed. Use **Settings → Back up** to save a copy, or
**Automatic weekly backup** to keep the newest four in a folder you choose (for example OneDrive or Dropbox). To
share one kitchen with the household instead, go to **Settings → Connections**. There you can connect to your
Goodstock server (**Home server**), sync through a **Shared folder** (Google Drive, OneDrive, Dropbox, iCloud Drive or
Syncthing), or **Host this kitchen**. Hosting makes this computer the home server on your Wi-Fi (port 8486), and the
phones join with the address and PIN it shows. Windows asks once whether to let Goodstock through the firewall:
allow it on private networks.

Built with [Electron](https://www.electronjs.org/): `main.js` opens the window and answers the page's
`window.GoodstockNative` calls (from `preload.js`), the same methods as the Android and iOS bridges.

## Downloads

`.github/workflows/desktop.yml` builds all three on every push to `main` or `experiments`. Download them from the
run's **Artifacts**; a `v*` tag also attaches them to the GitHub release.

- **Windows:** `Goodstock-vX.Y.Z-windows-portable.exe` runs as it is, from anywhere (a USB stick too).
  `Goodstock-vX.Y.Z-windows-setup.exe` installs it with a Start menu entry; Windows only shows Goodstock's
  notifications for the installed version. Unless the build was signed (see **Signed builds** below), SmartScreen
  says "Windows protected your PC" the first time: **More info → Run anyway**.
- **Linux:** `Goodstock-vX.Y.Z-linux-x86_64.AppImage`: `chmod +x` it and run it.
- **macOS:** `Goodstock-vX.Y.Z-mac.dmg` (Apple silicon and Intel). Drag Goodstock to Applications. Unless it was signed and
  notarized, the first time macOS refuses to open it: **System Settings → Privacy & Security → Open Anyway**.

## What works differently from the browser version

- Timers ring in the window; when Goodstock is in the background they also show a notification and flash the
  taskbar button. Use-soon reminders are notifications while the app is open.
- Recipe links, Mealie, DeepL and the home server are reached by the app itself, so there are no browser limits.
- **Share list** copies the shopping list for pasting into a message (macOS shows its share menu).
- Barcodes are typed in; there is no camera scanner.
- **Settings → Your data → Updates** checks GitHub once a day for a newer release (the X.Y.0 versions) and shows a
  download link and a dot on the Settings button when there is one. Nothing is downloaded or installed by itself;
  untick **Check once a day** to stop it, **Check now** checks straight away.
- Data lives in the app's own storage in the user profile (`%APPDATA%\Goodstock`, `~/Library/Application Support/Goodstock`,
  `~/.config/Goodstock`), the same for the portable and installed Windows versions.

## Build locally

- **Run from the source** (needs Node 22): `cd desktop && npm install && npm start`.
- **Windows and Linux files with Docker** (from the repository root, in WSL or Linux): `bash desktop/build.sh`. The
  files land in `dist/desktop/`. The Mac app needs a Mac, so GitHub builds it.

`prepare.mjs` copies the web files into `desktop/web` before each build (keep its list in step with `webFiles` in
`android/app/build.gradle` and `ios/scripts/copy-web.sh`) and reads the version from the `Goodstock vX.Y.Z` label in
`index.html`.

## Signed builds

Only worth it when people outside the household install the app. Without a certificate the builds are unsigned
and Windows and macOS warn on first start, as described above. `.github/workflows/desktop.yml` signs automatically
once these repository secrets exist (GitHub → Settings → Secrets and variables → Actions); nothing else changes.

- **Windows** (code-signing certificate as a `.pfx` file): `WIN_CSC_LINK` (the file as base64, `base64 -w0 cert.pfx`)
  and `WIN_CSC_KEY_PASSWORD`. Both `.exe` files are signed. Certificates bought since 2023 usually live on a hardware
  key or in a cloud service (for example Azure Trusted Signing) and can't be exported as a `.pfx`; those need
  electron-builder's `win.azureSignOptions` or a custom `win.signtoolOptions` instead, which isn't set up here.
  SmartScreen still warns about a new certificate until it has built up a reputation.
- **macOS** (Apple Developer Program): `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD`, a "Developer ID Application"
  certificate exported from Keychain as `.p12` (base64), and for notarization `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com) and `APPLE_TEAM_ID`. Signed and notarized, the `.dmg`
  opens without the Privacy & Security step.

The build log says which it did ("Signing the Mac app and notarizing it", "No signing certificate: an unsigned
build"). Without secrets the Mac app keeps its ad-hoc signature, which Apple silicon needs to start at all.
