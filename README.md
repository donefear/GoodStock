# Goodstock Kitchen

**A touch-friendly kitchen companion for the whole household.** Goodstock keeps track of what's in your fridge, freezer and pantry, plans the week's meals, writes the shopping list, and walks you through recipes one step at a time. It's built for a tablet on the kitchen wall, and it works just as well on a phone or laptop.

It comes in three forms:

| | What it is | Best for |
|---|---|---|
| **Server version** | A small Docker container that serves the app to every browser on your home network | One shared kitchen for the whole household, live on every device |
| **Android app** | A standalone APK with everything on the phone (`android/`) | Using Goodstock without a server, or carrying your home kitchen with you |
| **iPhone / iPad app** | The same standalone app for iOS 16.4+ (`ios/`) | The same, on Apple devices |

The phone apps can also connect to your home server and stay in sync with it.

---

## Features

### 🥫 Inventory
- **Everything you have, by location**: Fridge, Freezer, Pantry and any storage spots you add. You can see it as a **list** or as a visual **map** of your kitchen.
- **Smart ingredient names.** A catalog of common ingredients in all 13 languages suggests names as you type. Recipes match across languages, so a Spanish "harina" finds the "Flour" in stock.
- **Expiry dates, estimated for you.** Common perishables get a shelf-life estimate for their storage type. A date from the package always overrides the estimate.
- **Use soon panel.** Shows items that expire within three days, and anything overdue, together with saved recipes that use them.
- **Barcode scanning** in the phone apps fills in a product's name when you add it.
- **Reminders.** In the browser you get notifications while the app is open. The phone apps send a daily "use soon" notification even when the app is closed.

### 📖 Recipes
- **Your own recipe box.** Write a recipe, paste one as text, or **import from a website**. Most recipe sites work, because Goodstock reads the recipe data built into their pages.
- **Full recipe pages** with ingredients, the kitchen tools you'll need, and numbered steps that have amounts written in ("Add **200 g** flour…").
- **Servings and scaling.** Make a recipe for 2 or for 8 and every amount changes with it.
- **Metric throughout.** Pounds, ounces and °F are converted automatically. Cups and spoons stay as written.
- **What you have.** Every recipe page marks which ingredients are in stock and how many are missing.
- **One-tap translation** with DeepL saves a translated copy of a recipe in your language.
- **Mealie integration (optional).** Search your [Mealie](https://mealie.io) recipe server and import recipes from it.
- **Recipe ideas from the web (experimental).** Goodstock suggests new recipes from [TheMealDB](https://www.themealdb.com) based on what you've cooked lately and what's about to expire. Each suggestion says why it was picked.

### 👩‍🍳 Step-by-step cook mode
- **One action at a time.** Recipes are split into short, single-action steps, with big buttons that work with messy hands.
- **Get ready first.** You start with an ingredient checklist and a tools checklist, each with a **Select all** button. The ingredient checklist shows where each item is stored.
- **Timers built in.** "Simmer for 10 minutes" turns into a timer button. Timers keep running and ring even if you leave cook mode.
- **Oven heads-up.** Goodstock tells you to preheat early, before you reach the step that needs the oven.
- **Hands-free.** 🔊 **Read aloud** speaks each step, and 🎙 **voice commands** ("next", "back", "repeat", "start timer") move you through the recipe.
- **Picks up where you left off** if you close it halfway through.
- **"Cooked ✓"** takes the amounts you used out of your inventory. You can adjust each amount first.

### 📅 This week
- **Plan meals by day.** Pick recipes for the week, with servings for each meal.
- **One tap builds the shopping list** from the week's plan. It only adds what you don't already have.

### 🛒 Shopping list
- **Grouped in supermarket order**: vegetables, fruit, bakery, dairy and so on.
- **Put it away.** Checked items go into the inventory in one step.
- **Share to phone.** Scan a QR code to download the list onto your phone (server version). The phone apps use the normal share menu.

### 🧰 Kitchen tools
- **Timers.** Several named timers at once.
- **Converter.** Weights, volumes, cups to grams for common ingredients, temperatures and gas marks.
- **Cooking terms.** A glossary (julienne, blanch, deglaze …), each term with a button that finds a how-to video.

### 🌍 Languages
The interface is available in **English, Dutch, Spanish, French, German, Italian, Portuguese (Brazil), Russian, Chinese (simplified), Japanese, Romanian, Polish and Turkish**. The language is chosen per device, so people sharing one kitchen can each use their own. Without a choice, Goodstock uses the device's language when it has it.

### ✨ Everyday comforts
- **Shared, live kitchen.** Every device on the server sees changes right away. If two people edit at once, both changes are merged item by item, so nothing is lost.
- **Works offline.** The app keeps working without a connection and syncs when it's back.
- **Undo** instead of "are you sure?" pop-ups.
- **Light and dark themes**, and **Large / Extra large text** for a tablet across the room.
- **Household PIN (optional).** Locks the server version so only your devices can use it.
- **Backups.** Export and import your whole kitchen as a file. The phone apps can also make an automatic weekly backup to a folder you choose, such as Google Drive or iCloud.

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

> **Security note:** Goodstock is made for a trusted home network. Even with a household PIN, don't expose it directly to the internet without HTTPS in front of it.

## Phone apps

- **Android:** see [android/README.md](android/README.md). It runs on Android 5.0+ and builds in Docker, so no Android Studio is needed.
- **iPhone / iPad:** see [ios/README.md](ios/README.md). It runs on iOS 16.4+ and builds on a Mac with Xcode. The project is generated with XcodeGen.

Both apps hold the whole kitchen on the device and need no server. To share a kitchen with your home server, use **Settings → Home server**.

## Browser support

The web app is kept compatible with **Chrome 81**, so an old Android 4.4 tablet can still serve as the kitchen screen. Newer browsers, including Safari, Firefox and Edge, work as well.

---

## For developers

Goodstock is plain HTML, CSS and JavaScript, with no framework and no build step. The server is a single Node.js file, and its only runtime dependency is `qrcode`.

| Path | What's in it |
|---|---|
| `index.html`, `styles.css` | The page and its responsive light/dark styles |
| `app/*.js` | The client: `core` (state, ingredients, quantities), `sync`, `views`, `cook`, `ideas` and `actions` |
| `server.mjs` | Static files, the shared-state API with live updates, and proxies for Mealie, DeepL, recipe import and TheMealDB |
| `i18n.js`, `lang/*.js` | Interface translations, keyed by the English text |
| `ingredients.json` | The multilingual ingredient catalog with shelf-life estimates |
| `kitchen-reference.js`, `kitchen-tools.js` | Converter data, the cooking-terms glossary and kitchen-tool detection |
| `recipe-import.mjs`, `mealie.mjs`, `deepl.mjs` | Code shared by the server and the phone apps |
| `android/`, `ios/` | The phone apps |
| `tests/` | The test suite |

### Tests
```sh
npm test
```
This runs the translation check, page tests and end-to-end tests in a headless browser against fresh servers. GitHub Actions runs the suite on every push, and also builds the Android APK and the iOS app. See [tests/README.md](tests/README.md) for a Docker command to use when Node isn't installed.

### Adding interface text
Write it in English inside `t('…')`, then run `node lang/check-translations.mjs`. It lists the lines each language is missing.

### Versioning
Every change bumps the patch number in the `Goodstock vX.Y.Z` label in `index.html` and the cache name in `sw.js`. The phone apps take their version from that label.

---

*Expiry estimates are general guidance, not food-safety guarantees. When in doubt, trust the package date and your nose.*
