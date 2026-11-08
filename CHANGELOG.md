# Changelog

What changed in each version of Goodstock Kitchen, newest first. Every change bumps the patch number (v4.9.1 → v4.9.2); each X.Y.0 version is a release on GitHub, with the Android APK, the desktop apps and the iOS `.ipa` attached.

## v4.9 — quality and reliability

- **v4.9.3** README brought up to date; this changelog.
- **v4.9.2** Two tests no longer depend on the time of day or on a slow computer.
- **v4.9.1** Second round of QA fixes.
  - Server and sync: PIN limits work per device behind the HTTPS proxy (`TRUST_PROXY`); too many wrong PINs slow logins down instead of locking everyone out; recipe import and photo fetches stay on the address they checked; security headers; daily and safety backups kept apart (14 and 10); a safety copy before every restore; folder sync survives full browser storage.
  - App: edited items keep their optional fields; invalid dates and huge amounts are refused; Plan this week plans the current week; QR lists show your units and only unticked items; scaled amounts are rounded; the converter reads typed units such as `350F`.
  - Layout: fallbacks for the Chrome 81 kitchen tablet, the undo bar no longer covers timers, Cyrillic fonts, 44 px touch targets.
- **v4.9.0** A deep test of every feature, layout and language found about 80 bugs; this release fixes them.
  - Server: parallel saves no longer lose changes; PIN limits hold under parallel requests; recipe import and photo fetches are size-capped and refuse private addresses; the calendar feed scales servings and uses local dates.
  - App: a first visit that can't reach the server no longer adds the sample kitchen to the shared one; renaming a location keeps its items; butter no longer counts as buttermilk; Put away, Cooked and the shopping list use the right items and amounts; the Use soon panel is much faster.
  - Cook mode: amounts land on the right ingredient (milk / coconut milk), fraction and compound times get timers, the oven heads-up only appears for oven temperatures.
  - Languages: Tagalog completed, "Open day" in every language, translated labels and page title.

## v4.8 — Tagalog

- **v4.8.0** Tagalog as an interface language, with ingredient names, units, cook-mode times and voice commands. Recipe pages show how much you are short ("Potatoes: 1 kg short") and follow the servings.

## v4.7 — sort the recipe box

- **v4.7.0** A Sort menu on the Recipes page: closest to ready, A to Z, best rated, cooked most, cooked lately, not cooked in a while, newest first, fewest ingredients. Remembered per browser.

## v4.6 — ratings, more languages, browsers on a hosting device

- **v4.6.2** Danish and Swedish. Mealie is offered by the Docker server only. A phone or computer that hosts the kitchen now also serves the app, so any browser on the Wi-Fi can open it and sign in with the PIN.
- **v4.6.1** Rate recipes with one to five stars and write notes on them ("less salt next time"); notes from two devices are both kept.
- **v4.6.0** Release of the v4.5 changes below.

## v4.5 — everyday fixes

- **v4.5.5** Use some of an item (150 g off 1 kg leaves 850 g), friendly amounts (850 g, 1.5 kg), a cleaner recipe picker on the shopping list.
- **v4.5.4** Text size Small / Normal / Large; units picked from a list, with imperial display and entry in Settings; a Running low filter; an Add item dialog on the shopping list; search online (TheMealDB) next to your own recipes, with a preview.
- **v4.5.2** Report a problem or send an idea by email from Settings.
- **v4.5.0** Release of the v4.0 changes below.

## v4.0 — old tablets and the kitchen screen

- **v4.0.18** A little surprise behind the signature.
- **v4.0.15** Old cooking history folds into monthly totals, and Settings shows how big the kitchen is and shrinks large photos.
- **v4.0.13** The meal plan as a calendar feed your phone or computer can subscribe to.
- **v4.0.12** Share a recipe page into Goodstock on Android.
- **v4.0.11** What waste costs: optional prices, remembered per product, and a rough total for the shopping list.
- **v4.0.10** The shopping list learns the order of your shop.
- **v4.0.8** Diets and allergens on recipes, with filters.
- **v4.0.7** Use by and best before dates.
- **v4.0.6** Fill the empty days of the week in one tap.
- **v4.0.5** Kitchen screen: a large, always-on view for a wall or counter tablet.
- **v4.0.0–v4.0.4** Old tablets: file picking, read aloud and right-to-left on Android 4.4, old browsers on the server version get the old-tablet page, a lighter old-tablet build, checked on Android 4.4 on GitHub.

## v3.3 — learning from your kitchen

- **v3.3.20–v3.3.23** The Android app runs on old tablets (Android 4.4+), with fonts, icons and dark mode.
- **v3.3.17** Accessibility check: readable contrast in light and dark.
- **v3.3.16** A static check for code Chrome 81 can't run.
- **v3.3.15** An optional second copy of the server backups (`BACKUP_COPY_PATH`).
- **v3.3.14** A kitchen summary for Home Assistant and dashboards (`/api/summary`).
- **v3.3.11–v3.3.13** Android home-screen widget; the desktop app keeps hosting from the tray and can start with the computer; update check in the Android app.
- **v3.3.8–v3.3.10** Share a recipe as text or a file; print from the phone apps; recipe photos kept in the phone and desktop apps.
- **v3.3.4–v3.3.7** Thaw reminders the evening before; recipe ideas for a Use soon item; stocktake one place at a time; shelf lives learned from what gets thrown away.
- **v3.3.3** The shopping list counts amounts and only adds what is short.
- **v3.3.1–v3.3.2** Cooking terms in your language; Translate asks which language.

## v3.2 — staples, photos and HTTPS

- **v3.2.13** Arabic and Hebrew.
- **v3.2.11** Right-to-left layout.
- **v3.2.10** Amounts in the steps for Russian, Polish, Romanian, Turkish, Chinese and Japanese.
- **v3.2.7–v3.2.9** Optional HTTPS with Caddy; automatic server backups; optional autoheal.
- **v3.2.6** Favourites, and how often a recipe was cooked.
- **v3.2.3–v3.2.5** Recipe photos; print a recipe or the shopping list; faster week planning.
- **v3.2.1–v3.2.2** Barcodes in Put away and scan to use up; the shared shopping list in supermarket groups.
- **v3.2.0** Staples, opened and frozen dates, leftovers, a waste overview, search across languages.

## v3.0 and v3.1 — sharing without a server

- **v3.1.1** Release notes on every version tag.
- **v3.0.4** Hosting keeps running on Android; reminders survive a restart.
- **v3.0.2** Remove an item or clear the inventory; share the kitchen through a shared folder or by hosting it on the Wi-Fi.

## v2 — apps and languages

- **v2.1.70** Desktop app for Windows, macOS and Linux.
- **v2.1.66** Recipe ideas from the web, based on what you cooked.
- **v2.1.61–v2.1.64** A test suite on GitHub, the client split into files, a Docker health check, Romanian, Polish and Turkish.
- **v2.1.51** Optional household PIN for the server version.
- **v2.1.41–v2.1.49** Phone apps that sync with the home server, barcode scanning, daily use-soon reminders, hands-free cook mode, servings and scaling, a grouped shopping list, undo, text size, automatic backups.
- **v2.1.21–v2.1.26** Cook mode, step amounts, the ingredient catalog and kitchen tools in all languages.
- **v2.1.2** iPhone and iPad app.
- **v2.1.1** The interface in ten languages.
- **v2.1.0** A live shared kitchen on the Docker server, and a standalone Android APK.
- **v2.0** Timers tab, recipe editor and import, DeepL translation, the Tools tab.

## v1 — the first kitchen

- **v1.5** Wipe confirmation, clearer step amounts.
- **v1.2** Step-by-step cook mode, Mealie links.
- **v1.0** Inventory with expiry estimates, meal plan, shopping list, Docker and Portainer setup.
