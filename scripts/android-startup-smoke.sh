#!/usr/bin/env bash
set -euo pipefail
apk=${1:?APK path required}
output=${2:-android-startup-evidence}
mkdir -p "$output"
adb install -r "$apk"
adb logcat -c
adb shell am start -W -n com.touliao.app/.MainActivity
ready=0
for attempt in $(seq 1 30); do
  adb shell uiautomator dump /sdcard/touliao-startup.xml >/dev/null
  adb exec-out cat /sdcard/touliao-startup.xml > "$output/window.xml"
  if grep -q 'login-phone-input' "$output/window.xml" && grep -q 'login-password-input' "$output/window.xml"; then
    ready=1
    break
  fi
  sleep 2
done
adb logcat -d > "$output/logcat.txt"
adb exec-out screencap -p > "$output/login.png"
test "$ready" -eq 1
adb shell pidof com.touliao.app
if grep -E 'FATAL EXCEPTION|Fatal signal|ANR in com.touliao.app' "$output/logcat.txt"; then
  echo 'Application startup crashed or became unresponsive' >&2
  exit 1
fi
echo 'Installed APK launched and rendered both native login inputs.'
