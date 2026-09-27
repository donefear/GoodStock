#!/usr/bin/env bash
# Installs and opens an APK in a headless Android emulator, then saves a screenshot and the app's log lines.
# Usage from the repository root (WSL/Linux with /dev/kvm):  bash android/test-apk.sh [apk] [api] [tag]
#   e.g. bash android/test-apk.sh dist/Goodstock-v2.0.10-debug.apk 22 default
# The first run for an Android version downloads its system image (several hundred MB).
set -euo pipefail
cd "$(dirname "$0")/.."
APK="${1:-$(ls -t dist/*-debug.apk | head -1)}"
API="${2:-22}"
TAG="${3:-default}"
IMAGE="goodstock-emulator-$API"
NAME="gs-emu-$API"
docker build -q -t goodstock-android-build -f android/Dockerfile.build android > /dev/null
docker build -q --build-arg API="$API" --build-arg TAG="$TAG" -t "$IMAGE" -f android/Dockerfile.emulator android > /dev/null
mkdir -p dist/test
docker rm -f "$NAME" > /dev/null 2>&1 || true
docker run -d --name "$NAME" --device /dev/kvm -v "$PWD":/src "$IMAGE" \
  emulator -avd test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot > /dev/null
trap 'docker rm -f "$NAME" > /dev/null 2>&1 || true' EXIT
run() { docker exec "$NAME" bash -c "$1"; }
for i in $(seq 1 150); do
  [ "$(run 'timeout 5 adb shell getprop sys.boot_completed 2>/dev/null' | tr -d '\r')" = 1 ] && break
  sleep 2
done
echo "Android $(run 'adb shell getprop ro.build.version.release' | tr -d '\r') (API $API), WebView $(run 'adb shell dumpsys package com.android.webview 2>/dev/null; adb shell dumpsys package com.google.android.webview 2>/dev/null' | grep -m1 versionName | tr -d '\r ' | cut -d= -f2)"
run "adb install -r '/src/$APK'" | tail -1
run 'adb logcat -c'
run 'adb shell am start -n com.donefear.goodstock/.MainActivity' > /dev/null
sleep 20
run "adb exec-out screencap -p > '/src/dist/test/screen-api$API.png'"
run "adb logcat -d | grep -iE 'goodstock|CONSOLE|AndroidRuntime|FATAL|WebViewAssetLoader|net::' | tail -60" > "dist/test/log-api$API.txt" || true
echo "Screenshot: dist/test/screen-api$API.png, log: dist/test/log-api$API.txt"
