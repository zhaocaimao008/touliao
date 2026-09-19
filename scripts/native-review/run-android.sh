#!/usr/bin/env bash
# Keep test APKs installed until their app-scoped screenshots have been collected.
set -euo pipefail
review_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$review_root/android"
mkdir -p native-review
adb shell settings put system system_locales zh-CN
adb shell settings put secure show_ime_with_hard_keyboard 1
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb devices -l > native-review/devices.txt
adb shell getprop ro.product.model > native-review/device-model.txt
adb shell getprop ro.build.version.sdk > native-review/api-level.txt
git rev-parse HEAD > native-review/review-commit.txt
adb shell am instrument -w -e class com.touliao.app.review.NativeUIReviewTest \
  com.touliao.app.test/com.touliao.app.review.ReviewRunner | tee native-review/instrumentation.txt
adb pull /sdcard/Android/data/com.touliao.app/files/NativeUiReview native-review/ || true
adb logcat -d > native-review/logcat.txt || true
python3 ../scripts/native-review/verify-android.py
