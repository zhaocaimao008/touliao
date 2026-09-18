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
bash scripts/android-startup-smoke.sh "$previous" "$output/before"
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
python3 - "$output" <<'PY'
import json,sys
from pathlib import Path
result = {'environment':'Android API 29 native emulator','oldAndNewReleaseStartup':'passed',
          'adbInstallReplace':'passed','applicationUidPreserved':True,'firstInstallTimePreserved':True,
          'appPrivateFilePreserved':True,'productionLoginOrUserDatabaseExercised':False,'physicalDevice':False}
Path(sys.argv[1], 'upgrade.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
PY
