#!/usr/bin/env bash
# Builds the Goodstock APK inside Docker, so nothing but Docker is needed on this machine.
# Usage from the repository root (Linux, WSL or macOS):  bash android/build-apk.sh [release|debug]
# The APK lands in dist/. If android/signing.env exists, both debug and release APKs are signed with that key.
set -euo pipefail
cd "$(dirname "$0")/.."

TYPE="${1:-release}"
IMAGE=goodstock-android-build
docker build -q -t "$IMAGE" -f android/Dockerfile.build android > /dev/null

SIGNING=()
# Debug and release builds are both signed with the release key when it is available, so any build can update
# the app already on the phone.
if [ -f android/signing.env ]; then
  # shellcheck disable=SC1091
  source android/signing.env
  SIGNING=(
    -v "$(cd "$(dirname "$GOODSTOCK_KEYSTORE_FILE")" && pwd)/$(basename "$GOODSTOCK_KEYSTORE_FILE"):/keys/goodstock.jks:ro"
    -e GOODSTOCK_KEYSTORE=/keys/goodstock.jks
    -e GOODSTOCK_KEYSTORE_PASSWORD -e GOODSTOCK_KEY_ALIAS -e GOODSTOCK_KEY_PASSWORD
  )
  export GOODSTOCK_KEYSTORE_PASSWORD GOODSTOCK_KEY_ALIAS GOODSTOCK_KEY_PASSWORD
fi

TASK="assemble$(tr '[:lower:]' '[:upper:]' <<< "${TYPE:0:1}")${TYPE:1}"
# goodstock-android-home keeps Android's fallback debug key between builds (used only without signing.env).
docker run --rm \
  -v "$PWD":/src \
  -v goodstock-gradle-cache:/root/.gradle \
  -v goodstock-android-home:/root/.android \
  "${SIGNING[@]}" \
  "$IMAGE" gradle --no-daemon --quiet "$TASK"

VERSION=$(grep -oE 'Goodstock v[0-9]+\.[0-9]+(\.[0-9]+)?' index.html | head -1 | cut -d v -f 2)
SUFFIX=$([ "$TYPE" = release ] && echo "" || echo "-$TYPE")
mkdir -p dist
cp "android/app/build/outputs/apk/$TYPE/app-$TYPE.apk" "dist/Goodstock-v$VERSION$SUFFIX.apk"
echo "Built dist/Goodstock-v$VERSION$SUFFIX.apk"
