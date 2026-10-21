#!/usr/bin/env bash
# The old-tablet page on an Android 4.4 emulator (0.42): installs a debug APK (built after tools/build-legacy.mjs),
# opens it, forwards the WebView's DevTools to localhost:9222 and runs tests/legacy-device/smoke.mjs, which fails on
# any script error and saves screenshots in dist/test/legacy/. Needs adb with a running emulator, and Node with the
# dev dependencies. GitHub runs it in the job "old-tablet" (.github/workflows/android.yml); locally,
# `bash android/test-apk.sh <apk> 19` does the same in Docker.
# Usage: bash android/legacy-check.sh path/to/app-debug.apk
set -euo pipefail
APK="$1"
PKG=com.donefear.goodstock
adb wait-for-device
echo "Android $(adb shell getprop ro.build.version.release | tr -d '\r'), $(adb shell dumpsys package com.android.webview | grep -m1 versionName | tr -d '\r ' || true)"
adb install -r "$APK" | tail -1
adb shell am start -n "$PKG/.MainActivity" > /dev/null
# The WebView's DevTools socket appears once the page has started (debug builds only).
socket=''
for i in $(seq 1 60); do
  socket=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1 || true)
  [ -n "$socket" ] && break
  sleep 2
done
[ -n "$socket" ] || { echo "FAIL: the app's WebView never offered DevTools"; echo "::error title=Old tablet::the app's WebView never offered DevTools"; exit 1; }
adb forward tcp:9222 "localabstract:$socket" > /dev/null
node tests/legacy-device/smoke.mjs 9222
