#!/usr/bin/env bash
# Keep test APKs installed until their app-scoped screenshots have been collected.
set -euo pipefail
review_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$review_root/android"
mkdir -p native-review
adb shell settings put system system_locales zh-CN
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
python3 - <<'PY'
import json,re
from pathlib import Path
root=Path('native-review');text=(root/'instrumentation.txt').read_text()
m=re.search(r'\bOK \((\d+) tests?\)',text)
images=list((root/'NativeUiReview').glob('*.png'))
result={'environment':'Android Emulator API 34, native instrumentation','testsPassed':int(m[1]) if m else 0,'screenshots':len(images),'hardware':False}
(root/'validation.json').write_text(json.dumps(result,indent=2)+'\n')
assert m and int(m[1]) == 2, 'Native test runner did not report both tests passing'
assert len(images) >= 60, 'Native screenshot collection is incomplete'
print(result)
PY
