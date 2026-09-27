# Goodstock for Android

A standalone APK: the web app's files are bundled inside, so it runs with no server and keeps its data on the phone.

Runs on Android 5.0 (2014) and newer. On Android 5–7, keep **Android System WebView** (or Chrome) up to date in the Play Store; the app runs inside it.

## What differs from the server version

- **Data lives on the phone.** Nothing syncs between devices. Use **Settings → Back up** to save a file, and **Restore** to load it on another phone.
- **Timers are real Android alarms.** They ring with the app in the background or the screen off, and keep ringing until you open or dismiss them.
- **Use-soon reminders** are Android notifications.
- **Recipe links** are fetched by the phone itself. Some sites block this; pasting the recipe text always works.
- **The shopping list** is shared through the Android share sheet instead of a QR code.
- **Translation** uses DeepL: add your DeepL API key in **Settings** (saved on the phone).
- **Mealie is optional.** Connect it in **Settings**; the connection is saved on the phone, and the phone must be able to reach your Mealie server. Without it, add recipes with **New recipe** or **Import** on the Recipes page.

## Build locally (Docker)

From the repository root, in WSL or Linux:

```sh
bash android/build-apk.sh          # release APK -> dist/Goodstock-vX.Y.Z.apk
bash android/build-apk.sh debug    # debug APK   -> dist/Goodstock-vX.Y.Z-debug.apk
```

The first run downloads the Android SDK and Gradle into a Docker image (about 2 GB). The version comes from the `Goodstock vX.Y.Z` label in `index.html`; every change bumps the last number.

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
