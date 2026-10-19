# Goodstock Kitchen

**A touch-friendly kitchen companion for the whole household.** Goodstock keeps track of what's in your fridge, freezer and pantry, plans the week's meals, writes the shopping list, and walks you through recipes one step at a time. It's built for a tablet on the kitchen wall, and it works just as well on a phone or laptop.

It comes in three forms:

| | What it is | Best for |
|---|---|---|
| **Server version** | A small Docker container that serves the app to every browser on your home network | One shared kitchen for the whole household, live on every device |
| **Android app** | A standalone APK with everything on the phone (`android/`) | Using Goodstock without a server, or carrying your home kitchen with you |
| **iPhone / iPad app** | The same standalone app for iOS 16.4+ (`ios/`) | The same, on Apple devices |
| **Desktop app** | The same standalone app for Windows, macOS and Linux (`desktop/`) | A kitchen laptop or PC without running a server |

The phone apps can also connect to your home server and stay in sync with it. Without a server, they can share one kitchen through a shared folder, or one of them can host it on the Wi-Fi (see [Phone apps](#phone-apps)).

---

## Features

### 🥫 Inventory
- **Everything you have, by location**: Fridge, Freezer, Pantry and any storage spots you add. You can see it as a **list** or as a visual **map** of your kitchen.
- **Smart ingredient names.** A catalog of common ingredients in all 15 languages suggests names as you type. Recipes and search match across languages, so a Spanish "harina" finds the "Flour" in stock.
- **Expiry dates, estimated for you.** Common perishables get a shelf-life estimate for their storage type. A date from the package always overrides the estimate.
- **Opened and frozen.** "Opened today" shortens the date for things that keep less once open (milk, a can of tomatoes). Freezer items remember the day they were frozen, and their estimate counts from then.
- **Use soon panel.** Shows items that expire within three days, and anything overdue, together with saved recipes that use them.
- **Staples.** Give an item a "Keep at least" amount, and it goes on the shopping list by itself when it runs low.
- **Less waste.** When you remove an item you can say whether it was used up or thrown away. A small "This month" card shows the count and what was thrown away most.
- **Barcode scanning** in the phone apps (and Chrome on a phone over HTTPS) fills in a product's name and pack size when you add it or put the shopping away. Scan something from the cupboard on the Inventory page to use one, mark it used up or thrown away, or add it if it isn't there yet; the barcode is remembered with the item.
- **Reminders.** In the browser you get notifications while the app is open. The phone apps send a daily "use soon" notification even when the app is closed.

### 📖 Recipes
- **Your own recipe box.** Write a recipe, paste one as text, or **import from a website**. Most recipe sites work, because Goodstock reads the recipe data built into their pages.
- **Full recipe pages** with ingredients, the kitchen tools you'll need, and numbered steps that have amounts written in ("Add **200 g** flour…").
- **Photos.** Imported recipes keep their photo, and you can add one to your own (a small copy is saved with the recipe, so it works offline). Mealie recipes show their Mealie photo.
- **Servings and scaling.** Make a recipe for 2 or for 8 and every amount changes with it.
- **Metric throughout.** Pounds, ounces and °F are converted automatically. Cups and spoons stay as written.
- **What you have.** Every recipe page marks which ingredients are in stock and how many are missing.
- **Favourites.** Star the recipes your household loves and filter on them. Each recipe page says how often you cooked it and when you last did.
- **Recipe translation** with DeepL into any of the app's languages (your own is picked first) saves a translated copy of a recipe.
- **Mealie integration (optional).** Search your [Mealie](https://mealie.io) recipe server and import recipes from it.
- **Recipe ideas from the web (experimental).** Goodstock suggests new recipes from [TheMealDB](https://www.themealdb.com) based on what you've cooked lately and what's about to expire. Each suggestion says why it was picked.

### 👩‍🍳 Step-by-step cook mode
- **One action at a time.** Recipes are split into short, single-action steps, with big buttons that work with messy hands.
- **Get ready first.** You start with an ingredient checklist and a tools checklist, each with a **Select all** button. The ingredient checklist shows where each item is stored.
- **Timers built in.** "Simmer for 10 minutes" turns into a timer button. Timers keep running and ring even if you leave cook mode.
- **Oven heads-up.** Goodstock tells you to preheat early, before you reach the step that needs the oven.
- **Hands-free.** 🔊 **Read aloud** speaks each step, and 🎙 **voice commands** ("next", "back", "repeat", "start timer") move you through the recipe.
- **Picks up where you left off** if you close it halfway through.
- **"Cooked ✓"** takes the amounts you used out of your inventory. You can adjust each amount first, and put the leftovers in the fridge with three days to eat them.

### 📅 This week
- **Plan meals by day.** Pick recipes for the week, with servings for each meal. **Repeat last week** in one tap, or **copy a day** to another day. Recipes that use something from Use soon are suggested first.
- **One tap builds the shopping list** from the week's plan. It only adds what you don't already have.

### 🛒 Shopping list
- **Grouped in supermarket order**: vegetables, fruit, bakery, dairy and so on.
- **Put it away.** Checked items go into the inventory in one step.
- **Share to phone.** Scan a QR code to download the list onto your phone (server version). The phone apps use the normal share menu. The shared list keeps the supermarket groups as headings.
- **Print it** for the fridge door or for someone shopping without a phone: just the unchecked items, with tick boxes. Recipe pages print cleanly too (browser and desktop app).

### 🧰 Kitchen tools
- **Timers.** Several named timers at once.
- **Converter.** Weights, volumes, cups to grams for common ingredients, temperatures and gas marks.
- **Cooking terms.** A glossary (julienne, blanch, deglaze …), each term with a button that finds a how-to video.

### 🌍 Languages
The interface is available in **English, Dutch, Spanish, French, German, Italian, Portuguese (Brazil), Russian, Chinese (simplified), Japanese, Romanian, Polish, Turkish, Arabic and Hebrew**, the last two right to left. The language is chosen per device, so people sharing one kitchen can each use their own. Without a choice, Goodstock uses the device's language when it has it.

### ✨ Everyday comforts
- **Shared, live kitchen.** Every device on the server sees changes right away. If two people edit at once, both changes are merged item by item, so nothing is lost.
- **Works offline.** The app keeps working without a connection and syncs when it's back.
- **Undo** instead of "are you sure?" pop-ups.
- **Light and dark themes**, and **Large / Extra large text** for a tablet across the room.
- **Household PIN (optional).** Locks the server version so only your devices can use it.
- **Backups.** Export and import your whole kitchen as a file. The phone apps can also make an automatic weekly backup to a folder you choose, such as Google Drive or iCloud. The server keeps a daily copy by itself (and one before any change that removes most of the kitchen), ready to restore from Settings → Your data.

---

## Install the server version

### Docker Compose
```sh
docker compose -f docker-compose.yml up --build -d
```
Then open `http://localhost:8484`, or `http://<server-ip>:8484` from another device on your network.

### Portainer
1. Push this project to a Git repository that Portainer can reach.
2. In Portainer, go to **Stacks** → **Add stack** → **Repository**. Use `docker-compose.yml` as the Compose path, so Portainer builds the included `Dockerfile`.
3. Deploy, then open `http://<server-ip>:8484` on the tablet.

Your kitchen data lives in the `goodstock-data` volume (`/data` in the container). It survives updates, and you can back it up like any other Docker volume. The container has a health check at `/api/health`.

### Without Docker
```sh
npm install
PORT=8080 DATA_DIR=./data npm start
```

### Optional settings
You can set everything in the app under **Settings**. The environment variables below are optional defaults.

| Variable | Purpose |
|---|---|
| `MEALIE_URL`, `MEALIE_API_KEY` | Connect a Mealie recipe server. Use an address the container can reach, for example `http://mealie:9000`. |
| `MEALIE_PUBLIC_URL` | The Mealie address browsers use, if it differs from `MEALIE_URL`. |
| `DEEPL_API_KEY` | Turns on recipe translation. A free DeepL key is enough. |

API keys set in Settings are stored on the server and are never sent back to the browser.

### HTTPS (optional)
Browsers keep some features off on a plain `http://` address other than `localhost`: 🎤 voice commands, system notifications, barcode scanning in a phone's browser, and the offline app. The Compose file has an optional `https` service ([Caddy](https://caddyserver.com)) that turns them all on:

1. Start it with the `https` profile, and give it the address your devices use:
   ```sh
   COMPOSE_PROFILES=https HTTPS_HOST=192.168.1.20 docker compose -f docker-compose.yml up --build -d
   ```
   In Portainer, add `COMPOSE_PROFILES=https` and `HTTPS_HOST=192.168.1.20` as environment variables of the stack.
2. On each device, open `http://192.168.1.20:8485/goodstock-root.crt` and install the certificate. It is your server's own small certificate authority, made the first time the service starts and kept in the `goodstock-https` volume.
   - **Android:** Settings → Security → Encryption & credentials → Install a certificate → CA certificate (on Android 4.4: Settings → Security → Install from storage).
   - **iPhone / iPad:** open the downloaded profile in Settings, install it, then turn it on under General → About → Certificate Trust Settings.
   - **Windows:** open the file → Install Certificate → Local Machine → "Trusted Root Certification Authorities". **macOS:** add it to Keychain Access and set it to Always Trust.
3. Open `https://192.168.1.20:8443`.

With a domain name that points at your home (ports 80 and 443 forwarded to 8485 and 8443), set `HTTPS_CERT` to your email address instead: Caddy then gets a free Let's Encrypt certificate, and nothing needs to be installed on the devices. Plain `http://<server-ip>:8484` keeps working next to it, for the phone apps' Home server connection and for anything that can't install the certificate. `bash tools/check-https.sh` tests the setup in Docker.

### Restart when unhealthy (optional)
Docker restarts Goodstock when it stops, but not when it hangs while still running. Add the `autoheal` profile (`COMPOSE_PROFILES=autoheal`, or `https,autoheal` together with HTTPS) and a small [autoheal](https://github.com/willfarrell/docker-autoheal) container restarts Goodstock whenever its health check fails. It uses the Docker socket and only touches containers labelled `autoheal-goodstock`.

> **Security note:** Goodstock is made for a trusted home network. Even with a household PIN and HTTPS, don't expose it directly to the internet.

## Phone apps

- **Android:** see [android/README.md](android/README.md). It runs on Android 5.0+ and builds in Docker, so no Android Studio is needed.
- **iPhone / iPad:** see [ios/README.md](ios/README.md). It runs on iOS 16.4+ and builds on a Mac with Xcode. The project is generated with XcodeGen.
- **Windows, macOS, Linux:** see [desktop/README.md](desktop/README.md). An Electron app (portable `.exe` or installer, `.dmg`, AppImage), built on GitHub or with `bash desktop/build.sh` in Docker. It checks GitHub once a day for a newer version (Settings → Your data → Updates) and never installs anything by itself.

The apps hold the whole kitchen on the device and need no server. A household can still share one kitchen, under **Settings → Connections**:

- **Home server:** connect to your Goodstock server.
- **Shared folder** (Android, iPhone, desktop): every device picks the same folder that a sync app keeps in step (iCloud Drive, Syncthing, Dropbox, OneDrive, Google Drive on a computer). Each device writes its own file there and merges in the others' changes, item by item. No device has to be switched on at the same time as another.
- **Host this kitchen** (Android, desktop): one device becomes the home server on your Wi-Fi. The others connect under Home server with the address and PIN it shows, and stay in step instantly while Goodstock runs on the host. On Android, hosting keeps running in the background, with a notification, until you stop it.

## Browser support

The web app is kept compatible with **Chrome 81**, so an old Android 4.4 tablet can still serve as the kitchen screen. Newer browsers, including Safari, Firefox and Edge, work as well.

---

## For developers

Goodstock is plain HTML, CSS and JavaScript, with no framework and no build step. The server is a single Node.js file, and its only runtime dependency is `qrcode`.

| Path | What's in it |
|---|---|
| `index.html`, `styles.css` | The page and its responsive light/dark styles |
| `app/*.js` | The client: `core` (state, ingredients, quantities), `sync`, `views` (the other pages and dialogs), `recipes`, `cook`, `ideas` and `actions` |
| `server.mjs` | Static files, the shared-state API with live updates, and proxies for Mealie, DeepL, recipe import and TheMealDB |
| `i18n.js`, `lang/*.js` | Interface translations, keyed by the English text |
| `ingredients.json` | The multilingual ingredient catalog with shelf-life estimates |
| `kitchen-reference.js`, `kitchen-tools.js` | Converter data, the cooking-terms glossary and kitchen-tool detection |
| `recipe-import.mjs`, `mealie.mjs`, `deepl.mjs` | Code shared by the server and the phone apps |
| `android/`, `ios/`, `desktop/` | The phone apps and the desktop app |
| `tests/` | The test suite |

### Tests
```sh
npm test
```
This runs the translation check, page tests and end-to-end tests in a headless browser against fresh servers. GitHub Actions runs the suite on every push, and also builds the Android APK, the iOS app and the desktop apps. See [tests/README.md](tests/README.md) for a Docker command to use when Node isn't installed.

### Adding interface text
Write it in English inside `t('…')`, then run `node lang/check-translations.mjs`. It lists the lines each language is missing.

### Right-to-left languages
The layout is ready for Arabic, Hebrew and other right-to-left languages: give the language `dir: 'rtl'` in `LANGUAGES` (`i18n.js`) and the page mirrors itself. In `styles.css`, use `margin-inline-start` and similar logical properties instead of left and right; positioned elements get a `[dir="rtl"]` rule at the end of the file. `tests/e2e/rtl-layout.mjs` checks every view in a right-to-left stand-in language.

### Versioning
Every change bumps the patch number in the `Goodstock vX.Y.Z` label in `index.html` and the cache name in `sw.js`: `npm run bump` does both (`npm run bump -- minor` for a new X.Y.0), and `npm test` fails if they don't match. The phone apps take their version from that label.

Every X.Y.0 version is also backed up with `bash tools/backup-version.sh` (Git Bash or WSL). It tags the commit `vX.Y.0` and pushes the tag, so GitHub writes the release notes (the changes since the previous tag, and which file to download; `.github/workflows/release.yml`) and attaches the APK, desktop apps and iOS `.ipa` to that release. It also saves the source as a zip, plus any local builds, in `backups/vX.Y.0/` (not committed). To add the iOS `.ipa` to an older release, run the *iOS app* workflow by hand on GitHub and enter the tag.

---

*Expiry estimates are general guidance, not food-safety guarantees. When in doubt, trust the package date and your nose.*
