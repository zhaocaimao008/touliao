#!/usr/bin/env bash
set -euo pipefail
previous=${1:?Old signed APK required}
release=${2:?Candidate signed APK required}
output=${3:?Evidence directory required}
test "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 29
mkdir -p "$output/compat-probe/classes"
javac -source 8 -target 8 -cp "$ANDROID_HOME/platforms/android-34/android.jar" -d "$output/compat-probe/classes" scripts/legacy-update/ApkSignatureCompatProbe.java
jar cf "$output/compat-probe/classes.jar" -C "$output/compat-probe/classes" .
"$ANDROID_HOME/build-tools/34.0.0/d8" --min-api 29 --output "$output/compat-probe/probe.jar" "$output/compat-probe/classes.jar"
python3 - "$release" "$output/compat-probe/tampered.apk" <<'PY'
import sys,zipfile
from pathlib import Path
p=Path(sys.argv[1]);data=bytearray(p.read_bytes())
with zipfile.ZipFile(p) as z:offset=z.getinfo('classes.dex').header_offset+100
data[offset]^=1;Path(sys.argv[2]).write_bytes(data)
PY
adb push "$previous" /data/local/tmp/touliao-probe-old.apk
adb push "$release" /data/local/tmp/touliao-probe-new.apk
adb push "$output/compat-probe/tampered.apk" /data/local/tmp/touliao-probe-tampered.apk
adb push "$output/compat-probe/probe.jar" /data/local/tmp/touliao-probe.jar
adb shell 'CLASSPATH=/data/local/tmp/touliao-probe.jar app_process / ApkSignatureCompatProbe /data/local/tmp/touliao-probe-old.apk /data/local/tmp/touliao-probe-new.apk /data/local/tmp/touliao-probe-tampered.apk' > "$output/signature-compatibility.json"
python3 - "$output/signature-compatibility.json" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);lines=p.read_text().splitlines();result=json.loads(next(x for x in lines if x.startswith('{')))
assert result['fixedVerifierAcceptedSameSigner'] and not result['fixedVerifierAcceptedTamperedApk']
p.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
PY
rm -f "$output/compat-probe/tampered.apk"
