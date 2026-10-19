# Goodstock for Android

A standalone APK: the web app's files are bundled inside, so it runs with no server and keeps its data on the phone.

Runs on Android 5.0 (2014) and newer. On Android 5–7, keep **Android System WebView** (or Chrome) up to date in the Play Store; the app runs inside it.

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

`bash android/test-apk.sh [apk] [api]` boots a headless Android emulator in Docker (needs /dev/kvm, which WSL2 has), installs the APK, opens it and saves a screenshot and log in `dist/test/`. For example `22` is Android 5.1 with its original WebView 39 (shows the update notice), `30` is Android 11 (runs the app).

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
