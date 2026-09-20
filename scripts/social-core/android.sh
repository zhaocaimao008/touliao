#!/usr/bin/env bash
set -euo pipefail
mkdir -p android/social-core-evidence
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb devices -l > android/social-core-evidence/devices.txt
failed=0
for method in social001RealComposerAccountIsolation social008OpenContactsReconcileInvalidation social011CacheWaitsForServerPolicy; do
  adb shell am instrument -w -e class "com.touliao.app.review.NativeUIReviewTest#$method" com.touliao.app.test/com.touliao.app.review.ReviewRunner > "android/social-core-evidence/$method.txt"
  cat "android/social-core-evidence/$method.txt"
  if ! grep -q 'OK (1 test)' "android/social-core-evidence/$method.txt"; then failed=1; fi
done
adb pull /sdcard/Android/data/com.touliao.app/files/NativeUiReview android/social-core-evidence/ || true
exit "$failed"
