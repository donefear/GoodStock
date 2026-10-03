# Goodstock for iPhone and iPad

A standalone app, like the Android APK: the web app from the repository root runs inside the app, with no server.
Everything (inventory, recipes, plans, shopping list) is kept on the device. Use **Settings → Back up** to save a copy
to Files or iCloud Drive, and **Restore** to bring it back on a new phone.

Needs iOS 16.4 or newer (any iPhone from the iPhone 8 onward, updated).

## Put it on your iPhone (Mac with Xcode)

1. Install Xcode from the Mac App Store and open it once so it finishes installing.
2. Open `ios/Goodstock.xcodeproj` in Xcode.
3. Click the **Goodstock** project in the left sidebar, then the **Goodstock** target, then **Signing & Capabilities**.
   Under **Team**, choose your Apple ID (Xcode → Settings → Accounts → **+** to add it the first time). If Xcode
   says the bundle identifier is taken, change `com.donefear.goodstock` to something of your own, like
   `com.yourname.goodstock`.
4. Connect the iPhone with a cable, unlock it, and tap **Trust** if it asks. Choose the iPhone in the device menu at
   the top of Xcode, then press **Run** (▶).
5. The first time only, on the iPhone: **Settings → Privacy & Security → Developer Mode** → on (the phone restarts),
   and **Settings → General → VPN & Device Management** → your Apple ID → **Trust**.

With a free Apple ID the app stops opening after 7 days; connect the phone and press **Run** again to renew it (your
data stays). With a paid Apple Developer account it lasts a year, and you can also share it through TestFlight.

## What works differently from the browser version

- Timers ring as notifications when Goodstock is in the background or the screen is locked. Allow notifications
  when asked (or in **Settings → Goodstock → Notifications**).
- Mealie connects straight from the phone, so the phone must reach your Mealie server (home Wi-Fi). iOS asks once
  for permission to use the local network.
- DeepL translation uses the key saved on the phone in Goodstock's Settings.
- Links to recipe sites, DeepL and YouTube open in a Safari sheet.

## Working on it

- The Xcode project is generated from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen). After
  changing `project.yml`, run `xcodegen generate` in this folder (`brew install xcodegen` once). Changes made only in
  Xcode's project settings are lost the next time it is generated.
- The web files are copied into the app by `scripts/copy-web.sh` at every build, so changes to `app.js`,
  `index.html`, `lang/` and the rest are picked up by simply building again. Keep its file list in step with
  `webFiles` in `android/app/build.gradle`.
- The app version comes from the `Goodstock vX.Y.Z` label in `index.html`, like the APK.
- `Goodstock/NativeBridge.swift` provides `window.GoodstockNative` with the same methods as the Android bridge;
  `app.js` uses it when `STANDALONE` is true.
- In a Debug build, Safari on the Mac can inspect the page: Safari → Develop → your iPhone → Goodstock.
- GitHub Actions (`.github/workflows/ios.yml`) builds the app for the simulator on every push that touches it, as a
  check that it still compiles.
