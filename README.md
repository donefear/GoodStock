# Goodstock Kitchen

A touch-friendly kitchen planner with inventory, weekly meals, a shopping list, and optional Mealie recipe search. Besides the server version below, there are standalone phone apps for Android (`android/`) and iPhone/iPad (`ios/`, see `ios/README.md`). The Node service uses only built-in modules; state is stored in a persistent JSON file in the mounted `/data` volume. The browser keeps a local copy and queues the latest changes while offline.

## Deploy in Portainer

1. Put this project folder somewhere Portainer can access, or push it to a Git repository.
2. In Portainer, choose **Stacks** and deploy from that Git repository. Set the repository path to this project folder and the Compose path to `docker-compose.yml` (Portainer's default filename), so it can build the included `Dockerfile`.
3. Optionally set `MEALIE_URL` and `MEALIE_API_KEY` in the stack environment. `MEALIE_URL` is the address reachable from the container, for example `http://mealie:9000` when both containers share a Docker network.
4. Deploy the stack and open `http://<your-server-ip>:8484` on the tablet or another browser.

The named `goodstock-data` volume keeps inventory and planning data across container updates. Back up that volume with your normal Docker backup process. An optional household PIN (Settings → Household PIN) locks the kitchen API: each device unlocks once and stays unlocked for a year; the PIN is stored hashed in `/data/auth.json`. Still, do not publish the app directly to the internet without HTTPS in front of it; it is meant for a home network.

## Mealie

When both environment variables are set, the Recipes view searches Mealie and lets you import recipes into Goodstock. Planned Mealie recipes in This week get a **Mealie ↗** link. If `MEALIE_URL` is an internal Docker address, set `MEALIE_PUBLIC_URL` to the address browsers use, for example `http://192.168.1.10:9925`. Goodstock owns the inventory, weekly plan, and shopping list; imported recipes are stored in its own data volume.

## Ingredients

The bundled `ingredients.json` catalog names common ingredients in all the app's languages. When adding inventory, the name in the app's language is suggested along with English and Dutch, and recipe availability checks match across languages (a Spanish "harina" finds the "Flour" in stock). The catalog is included in the offline app cache.

## Languages

Goodstock's menus and buttons come in English, Dutch, Spanish, French, German, Italian, Portuguese (Brazil), Russian, Chinese (simplified), Japanese, Romanian, Polish and Turkish. Pick one under **Settings → Language**; the choice is kept per device, so people sharing one kitchen can each use their own language. Without a choice, the device's language is used when Goodstock has it, otherwise English.

Recipes keep the language they were written in. A recipe in another language shows **Translate to …** on its page: with a DeepL key set in Settings, it translates into the app's language and saves the result as a new recipe. Kitchen data you type yourself (item names, storage locations) is never translated.

Translations live in `lang/<code>.js`, keyed by the English text. After changing or adding interface text, run `node lang/check-translations.mjs` to list what each language is missing.

## Expiration reminders

Set an optional expiration date when adding or editing inventory. Common perishables get a storage-specific shelf-life estimate when added; dates are marked as estimates and the package date can override them. Stable pantry items are left blank. Items due within three days (and overdue items) appear in the Inventory **Use soon** panel with saved recipes that use them. Browser notifications are optional, require HTTPS and permission, and are checked daily while Goodstock is open; the in-app panel works without notifications. Estimates are general guidance, not food-safety guarantees.

## Shopping list on a phone

Choose **Share to phone** on the shopping list and scan the QR code with the phone camera. It downloads a plain-text copy; checked items are marked. The random link expires after 30 minutes and works while the phone can reach the Goodstock server, normally on the same home network. QR generation runs in the container using the `qrcode` package; rebuilding the image installs this dependency.

## Offline behavior

After the first online visit, the browser caches the app shell and keeps the latest kitchen state on that device. Inventory and planning remain viewable offline. Changes are saved locally and the newest state is sent to the server after connectivity returns. Keep a single household tablet as the active editor; simultaneous edits from multiple devices are last-write-wins in this first version.