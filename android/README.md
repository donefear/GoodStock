# Goodstock for Android

A standalone APK: the web app's files are bundled inside, so it runs with no server and keeps its data on the phone.

Runs on Android 4.4 (2013) and newer. The app runs inside **Android System WebView**; keep it (or Chrome) up to date in the Play Store where you can.

**Old tablets.** A WebView older than Chrome 80 (Android 4.4 is stuck at Chrome 30–33, and many Android 5–7 devices can no longer update from the Play Store) gets a second copy of the app, made for old browser engines: `legacy/`, built by `tools/build-legacy.mjs` before the APK (Babel to ES5, polyfills, CSS grid turned into flexbox, .woff fonts with the icon symbols from `fonts/legacy` because old Android fonts lack them; see the comments there). `MainActivity` picks it by itself. Data is the same as in the normal app. What differs there: on Android 4.4 itself there is no barcode scanning, shared folder, backup folder or hosting (those need Android 5.0). Light and dark themes, the mirrored layout for Arabic and Hebrew, and read aloud work as in the normal app. Files to restore, recipe files and photos are picked through the app (Android's own picker), since the old WebView can't open one.

## What differs from the server version

- **Data lives on the phone.** Use **Settings → Back up** to save a file, and **Restore** to load it on another phone. A household without a server can share one kitchen under **Settings → Connections**:
  - **Shared folder:** pick the same folder on each device. It must be a folder that a sync app keeps in step, such as Syncthing, Dropbox, OneDrive, or the Google Drive desktop app on a computer. Google Drive's own Android app cannot share a folder this way.
  - **Host this kitchen:** the phone runs a small home server on the Wi-Fi (port 8486). The others join with its address and PIN. While hosting, a foreground service (`HostService`, with a lasting notification, a wake lock and a Wi-Fi lock) keeps it answering with the screen off or the app in the background, and Android restarts it if it stops the app. Use a phone that stays at home on the charger. Some makers (Samsung, Xiaomi…) still close background apps: set Goodstock's battery use to Unrestricted.
- **Timers are real Android alarms.** They ring with the app in the background or the screen off, and keep ringing until you open or dismiss them.
- **Use-soon reminders** are Android notifications. They and running timers are scheduled again after the phone restarts (`BootReceiver`), without opening the app.
- **Recipe links** are fetched by the phone itself. Some sites block this; pasting the recipe text always works.
- **The shopping list** is shared through the Android share sheet instead of a QR code.
- **Home-screen widget:** long-press the home screen → Widgets → Goodstock. It shows what to use soon (with dates) and how much is on the shopping list, in the app's language; tapping opens that page. The app updates it whenever the kitchen changes (`KitchenWidget`).
- **Print** a recipe or the shopping list through Android's print service, which can also save a PDF.
- **Share into Goodstock:** Goodstock is in the share menu. A recipe link from the browser opens Import with it; other text (a recipe, or a list from a message) asks whether to fill in a recipe or put each line on the shopping list.
- **Updates:** once a day the app checks GitHub for a newer release (Settings → Your data → Updates) and links to it; download the `.apk` and open it. It installs over your app only when both are signed with the same key, so GitHub builds need the signing secrets below.
- **Translation** uses DeepL: add your DeepL API key in **Settings** (saved on the phone).
- **Mealie is optional.** Connect it in **Settings**; the connection is saved on the phone, and the phone must be able to reach your Mealie server. Without it, add recipes with **New recipe** or **Import** on the Recipes page.

## Build locally (Docker)

From the repository root, in WSL or Linux:

```sh
bash android/build-apk.sh          # release APK -> dist/Goodstock-vX.Y.Z.apk
bash android/build-apk.sh debug    # debug APK   -> dist/Goodstock-vX.Y.Z-debug.apk
```

The first run downloads the Android SDK and Gradle into a Docker image (about 2 GB). The version comes from the `Goodstock vX.Y.Z` label in `index.html`; every change bumps the last number.

## Test in an emulator

`bash android/test-apk.sh [apk] [api]` boots a headless Android emulator in Docker (needs /dev/kvm, which WSL2 has), installs the APK, opens it and saves a screenshot and log in `dist/test/`. For example `19` is Android 4.4 with its WebView 30 and `22` is Android 5.1 with its original WebView 39 (both run the legacy page), `30` is Android 11 (runs the normal app). Without `/dev/kvm` the emulator runs in software, slower. On Android 4.4–6 a debug APK also gets the old-tablet check (`android/legacy-check.sh`, `tests/legacy-device/smoke.mjs`): every page, the main dialogs, cook mode, another language and dark mode through the WebView's DevTools, with screenshots in `dist/test/legacy/`. GitHub runs it on Android 4.4 for every push (job "old-tablet").

## Build on GitHub

`.github/workflows/android.yml` builds the APK on every push to `main` or `experiments` and on tags `v*`. Download it from the run's **Artifacts**. A tag also attaches the APK to its GitHub release.

## Signing

Android only installs an update over an existing app if both are signed with the same key. Keep one release key and use it everywhere:

- **Locally:** put the key's details in `android/signing.env` (git-ignored):

  ```sh
  GOODSTOCK_KEYSTORE_FILE=android/goodstock-release.jks
  GOODSTOCK_KEYSTORE_PASSWORD=...
  GOODSTOCK_KEY_ALIAS=goodstock
  GOODSTOCK_KEY_PASSWORD=...
  ```

- **On GitHub:** add the repository secrets `GOODSTOCK_KEYSTORE_BASE64` (the `.jks` file, base64-encoded), `GOODSTOCK_KEYSTORE_PASSWORD`, `GOODSTOCK_KEY_ALIAS` and `GOODSTOCK_KEY_PASSWORD`.

With the key in place, debug and release builds are both signed with it, so any newer build installs straight over the app on the phone and keeps its data. Every change bumps the patch version (`vX.Y.Z` in `index.html`), which raises the APK's version code too.

Without a key, builds are signed with a debug key: they install, but an APK signed differently cannot update them without uninstalling first, which deletes the app's data. Back up first.

Never commit the `.jks` file or `signing.env`. If the key is lost, installed copies can't be updated any more.

## Install

Copy the APK to the phone and open it. Android asks to allow installing from that source (browser or file manager) the first time.
