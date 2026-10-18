#!/usr/bin/env bash
# Checks the Android parts that only show up on a real system, on a running emulator with adb (GitHub Actions:
# .github/workflows/android.yml, job "emulator"). Exits 1 when something is wrong.
#   1. HostService runs as a foreground service with its notification, wake lock and Wi-Fi lock;
#   2. it stays with the app in the background, and Stop releases everything;
#   3. after Android kills the app, the service comes back and the kitchen host answers again (reported only:
#      Android 12+ may refuse a background restart, and the app then resumes hosting when opened);
#   4. BootReceiver schedules a saved use-soon reminder again after a "restart";
#   5. nothing crashes.
# Usage: bash android/ci-emulator-check.sh path/to/app-debug.apk   (a debug build: the check uses run-as)
# No pipefail: "dumpsys … | grep -q" stops reading at the first match, and the broken pipe would count as a miss.
set -u
APK="$1"
PKG=com.donefear.goodstock
FAILED=0
# Each result is also a GitHub annotation, readable on the run page and through the API without logging in.
fail() { echo "FAIL: $*"; echo "::error title=Emulator check::$*"; FAILED=1; }
note() { echo "note: $*"; echo "::warning title=Emulator check::$*"; }
pass() { echo "ok:   $*"; echo "::notice title=Emulator check::$*"; }
sh_() { adb shell "$@" | tr -d '\r'; }
service() { sh_ dumpsys activity services "$PKG/.HostService"; }

adb root > /dev/null 2>&1; sleep 3; adb wait-for-device
echo "Android $(sh_ getprop ro.build.version.release) (API $(sh_ getprop ro.build.version.sdk))"
adb install -r "$APK" | tail -1
sh_ pm grant "$PKG" android.permission.POST_NOTIFICATIONS > /dev/null 2>&1
adb logcat -c
sh_ am start -W -n "$PKG/.MainActivity" > /dev/null
sleep 10

# A hosted kitchen as KitchenHost saves it: PIN, token and notification text; the service resumes it after a restart.
sh_ am force-stop "$PKG"
HOST_PREFS="<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map><string name=\"pin\">123456</string><string name=\"token\">citoken</string><string name=\"noticeTitle\">Sharing your kitchen</string><string name=\"noticeText\">CI check</string></map>"
sh_ "run-as $PKG sh -c 'mkdir -p shared_prefs && echo $(printf '%s' "$HOST_PREFS" | base64 -w0) | base64 -d > shared_prefs/goodstock-kitchen-host.xml'"
sh_ am start -W -n "$PKG/.MainActivity" > /dev/null
sleep 8

echo "== 1. Start the hosting service"
sh_ am start-foreground-service -n "$PKG/.HostService" --es title "Sharing your kitchen" --es text "CI check" > /dev/null
sleep 4
service | grep -q 'isForeground=true' && pass "HostService is a foreground service" || fail "HostService is not in the foreground"
sh_ dumpsys notification --noredact | grep -qE "channel=hosting|mId='hosting'" && pass "the hosting notification is shown" || fail "no hosting notification"
sh_ dumpsys power | grep -q 'goodstock:host' && pass "wake lock held" || fail "no wake lock"
sh_ dumpsys wifi | grep -q 'goodstock:host' && pass "Wi-Fi lock held" || note "Wi-Fi lock not listed (the emulator may have no Wi-Fi)"

echo "== 2. App in the background for 30 s"
sh_ input keyevent KEYCODE_HOME
sleep 30
service | grep -q 'isForeground=true' && pass "still in the foreground after 30 s in the background" || fail "the service stopped in the background"

echo "== 3. Android kills the app"
PID=$(sh_ pidof "$PKG")
if [ -n "$PID" ]; then
  sh_ kill -9 "$PID"
  back=""
  for i in $(seq 1 40); do
    sleep 3
    if service | grep -q 'isForeground=true'; then back=1; break; fi
  done
  if [ -n "$back" ]; then
    adb forward tcp:8486 tcp:8486 > /dev/null
    sleep 3
    if curl -fsS --max-time 5 http://127.0.0.1:8486/api/health | grep -q '"host":true'; then pass "restarted after being killed; the host answers again"
    else note "the service restarted but the host did not answer on 8486"; fi
    adb forward --remove tcp:8486 > /dev/null 2>&1
  else
    note "Android did not restart the service within 2 minutes (it resumes when Goodstock is opened)"
  fi
else
  fail "no app process to kill"
fi

echo "== 4. Stop"
sh_ am stopservice -n "$PKG/.HostService" > /dev/null
sleep 3
service | grep -q 'ServiceRecord' && fail "HostService still runs after stop" || pass "stopped"
sh_ dumpsys power | grep -q 'goodstock:host' && fail "wake lock still held after stop" || pass "wake lock released"

echo "== 5. Phone restart with a saved reminder"
sh_ am force-stop "$PKG"
AT=$(( ($(date +%s) + 3600) * 1000 ))
REMINDER_PREFS="<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map><string name=\"list\">[{&quot;id&quot;:&quot;ci-reminder&quot;,&quot;at&quot;:$AT,&quot;title&quot;:&quot;Use soon&quot;,&quot;text&quot;:&quot;Milk&quot;}]</string></map>"
sh_ "run-as $PKG sh -c 'echo $(printf '%s' "$REMINDER_PREFS" | base64 -w0) | base64 -d > shared_prefs/goodstock-reminders.xml'"
# 0x20 = FLAG_INCLUDE_STOPPED_PACKAGES: after a real boot the app is not in the stopped state that force-stop leaves.
sh_ am broadcast -a android.intent.action.BOOT_COMPLETED -f 0x20 -n "$PKG/.BootReceiver" > /dev/null
sleep 5
sh_ dumpsys alarm | grep -q "$PKG.REMINDER" && pass "the reminder is scheduled again after the restart" || fail "the reminder was not scheduled again"

echo "== 6. Crashes"
CRASHES=$(adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime.*$PKG|Process: $PKG" | head -20)
if [ -n "$CRASHES" ]; then fail "the app crashed: $(adb logcat -d | grep -A6 "FATAL EXCEPTION" | head -8 | tr "
" " ")"; echo "$CRASHES"; adb logcat -d | grep -A25 'FATAL EXCEPTION' | head -60; else pass "no crashes"; fi

exit $FAILED
