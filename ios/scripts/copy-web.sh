#!/bin/bash
# Xcode build phase: copies the web app from the repository root into the app bundle's "web" folder, and sets the
# app version from the "Goodstock vX.Y.Z" label in index.html (build number X·10000 + Y·100 + Z, like the APK).
# Keep the file list in step with webFiles in android/app/build.gradle.
set -euo pipefail

ROOT="${SRCROOT}/.."
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/web"

rm -rf "$DEST"
mkdir -p "$DEST/fonts" "$DEST/lang"
for file in index.html i18n.js app.js kitchen-tools.js kitchen-reference.js recipe-import.mjs mealie.mjs deepl.mjs styles.css ingredients.json manifest.webmanifest logo.svg; do
  cp "$ROOT/$file" "$DEST/"
done
cp "$ROOT"/fonts/*.woff2 "$ROOT/fonts/fonts.css" "$DEST/fonts/"
cp "$ROOT"/lang/*.js "$DEST/lang/"

LABEL=$(grep -oE 'Goodstock v[0-9]+\.[0-9]+(\.[0-9]+)?' "$ROOT/index.html" | head -1 | sed 's/Goodstock v//')
IFS=. read -r MAJOR MINOR PATCH <<< "$LABEL"
PATCH=${PATCH:-0}
BUILD=$((MAJOR * 10000 + MINOR * 100 + PATCH))
PLIST="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $MAJOR.$MINOR.$PATCH" -c "Set :CFBundleVersion $BUILD" "$PLIST"
echo "Goodstock web app $MAJOR.$MINOR.$PATCH ($BUILD) copied to the app bundle"
