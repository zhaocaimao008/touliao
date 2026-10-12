#!/usr/bin/env bash
set -euo pipefail
previous=${1:?Previous production APK required}
release=${2:?New signed APK required}
output=${3:-android-startup-evidence}
mkdir -p "$output"
# Root is used solely to create a marker in this disposable emulator's app storage.
test "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1
adb root
adb wait-for-device
# 预检：两个 APK 带的原生库 ABI 必须有一个在模拟器 abilist 里，否则 adb install 只会报
# INSTALL_FAILED_NO_MATCHING_ABIS。正式包是 ARM-only 时需要带 ARM 翻译的镜像（见 android-release.yml）。
abilist=$(adb shell getprop ro.product.cpu.abilist | tr -d '\r')
echo "Emulator ABIs: $abilist"
for apk_path in "$previous" "$release"; do
  python3 - "$apk_path" "$abilist" <<'PY'
import sys, zipfile
apk, supported = sys.argv[1], [a for a in sys.argv[2].split(',') if a]
with zipfile.ZipFile(apk) as z:
    abis = sorted({n.split('/')[1] for n in z.namelist() if n.startswith('lib/') and n.count('/') >= 2})
if abis and not set(abis) & set(supported):
    sys.exit(f"{apk}: native ABIs {abis} not runnable on this emulator ({supported}); "
             "use an image with ARM translation (API 30+ google_apis x86_64)")
print(f"{apk}: ABIs {abis or ['none']} OK on {supported}")
PY
done
bash scripts/android-startup-smoke.sh "$previous" "$output/before"
if [ -f scripts/legacy-update/ApkSignatureCompatProbe.java ]; then
  bash scripts/legacy-update/run-signature-compat-probe.sh "$previous" "$release" "$output"
fi
adb shell am force-stop com.touliao.app
uid_before=$(adb shell stat -c '%u' /data/user/0/com.touliao.app | tr -d '\r')
[[ "$uid_before" =~ ^[0-9]+$ ]]
first_before=$(adb shell dumpsys package com.touliao.app | sed -n 's/^[[:space:]]*firstInstallTime=//p' | tr -d '\r' | head -1)
test -n "$first_before"
marker=$(openssl rand -hex 24)
adb shell "mkdir -p /data/user/0/com.touliao.app/files; echo '$marker' > /data/user/0/com.touliao.app/files/.release-upgrade-proof; chown $uid_before:$uid_before /data/user/0/com.touliao.app/files/.release-upgrade-proof; restorecon /data/user/0/com.touliao.app/files/.release-upgrade-proof"
bash scripts/android-startup-smoke.sh "$release" "$output/after"
test "$(adb shell cat /data/user/0/com.touliao.app/files/.release-upgrade-proof | tr -d '\r')" = "$marker"
uid_after=$(adb shell stat -c '%u' /data/user/0/com.touliao.app | tr -d '\r')
first_after=$(adb shell dumpsys package com.touliao.app | sed -n 's/^[[:space:]]*firstInstallTime=//p' | tr -d '\r' | head -1)
test "$uid_before" = "$uid_after"
test "$first_before" = "$first_after"
adb shell dumpsys package com.touliao.app > "$output/installed-package.txt"
python3 - "$output" "${SMOKE_ENVIRONMENT:-Android API 29 native emulator}" "${SMOKE_ARM_TRANSLATION:-false}" "$abilist" <<'PY'
import json,sys
from pathlib import Path
result = {'environment':sys.argv[2],'previousApkViaArmTranslation':sys.argv[3]=='true',
          'emulatorAbis':sys.argv[4],'oldAndNewReleaseStartup':'passed',
          'adbInstallReplace':'passed','applicationUidPreserved':True,'firstInstallTimePreserved':True,
          'appPrivateFilePreserved':True,'productionLoginOrUserDatabaseExercised':False,'physicalDevice':False}
Path(sys.argv[1], 'upgrade.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
PY
