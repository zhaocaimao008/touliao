#!/usr/bin/env bash
# The emulator action runs each script entry in a new shell; keep state in one process.
set -euo pipefail
review_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$review_root/android"
adb shell settings put system system_locales zh-CN
review_exit=0
./gradlew connectedDebugAndroidTest --no-daemon || review_exit=$?
mkdir -p native-review
adb pull /sdcard/Android/data/com.touliao.app/files/NativeUiReview native-review/ || true
adb logcat -d > native-review/logcat.txt || true
exit "$review_exit"
