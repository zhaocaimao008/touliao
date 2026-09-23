#!/usr/bin/env bash
set -euo pipefail
apk=${1:?Verified signed release APK required}
evidence=${2:-android-release-evidence}
test -n "${DEPLOY_SSH_KEY:-}"
test -n "${DEPLOY_USER:-}"
test "${DEPLOY_HOST:-}" = '13.212.117.22'
run_id="${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
[[ "$run_id" =~ ^[0-9]+-[0-9]+$ ]]
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["versionName"])' "$evidence/new-version.json")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
key="$RUNNER_TEMP/touliao-release-deploy-key"
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" > "$key"
ssh_args=(-i "$key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$GITHUB_WORKSPACE/deploy/ssh_known_hosts")
remote="$DEPLOY_USER@$DEPLOY_HOST"
stage="/var/www/downloads/.android-stage-$run_id"
name="touliao-android-$version.apk"
before_apk=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["previous"]["sha256"])' "$evidence/verification.json")
before_manifest=$(sha256sum "$evidence/previous-version.json" | cut -d' ' -f1)
new_sha=$(sha256sum "$apk" | cut -d' ' -f1)
ssh "${ssh_args[@]}" "$remote" "mkdir -p '$stage'"
scp "${ssh_args[@]}" "$apk" "$remote:$stage/new.apk"
scp "${ssh_args[@]}" "$evidence/new-version.json" "$remote:$stage/new-version.json"
scp "${ssh_args[@]}" scripts/publish-android-downloads.py "$remote:$stage/publish.py"
# Expose the immutable version URL and verify it before changing the update pointer.
ssh "${ssh_args[@]}" "$remote" python3 - "$stage" "$name" "$new_sha" <<'PY'
import hashlib,os,shutil,sys
from pathlib import Path
stage,name,expected=Path(sys.argv[1]),sys.argv[2],sys.argv[3]
root=stage.parent; target=root/name
def digest(p):
    result=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):result.update(chunk)
    return result.hexdigest()
assert digest(stage/'new.apk')==expected, 'Uploaded APK digest mismatch'
os.chmod(stage/'new-version.json',0o644)
if target.exists():
    assert digest(target)==expected, 'Existing version URL contains another binary'
else:
    pending=stage/'versioned.apk';shutil.copy2(stage/'new.apk',pending);os.chmod(pending,0o644);os.link(pending,target)
PY
curl --fail --silent --show-error --retry 3 --max-time 240 "https://touliao.cc/downloads/$name" -o "$RUNNER_TEMP/versioned.apk"
cmp "$apk" "$RUNNER_TEMP/versioned.apk"
ssh "${ssh_args[@]}" "$remote" "python3 '$stage/publish.py' --stage '$stage' --run-id '$run_id' --expected-apk '$before_apk' --expected-manifest '$before_manifest' --commit '$GITHUB_SHA'" > "$evidence/publication.json"
rollback_on_error() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo 'Public verification failed; restoring the saved Android update entries.' >&2
    ssh "${ssh_args[@]}" "$remote" "python3 '$stage/publish.py' --run-id '$run_id' --rollback" > "$evidence/rollback.json" || echo 'Automatic rollback could not complete; inspect publication receipt.' >&2
  fi
  rm -f "$key"
  exit "$code"
}
trap rollback_on_error EXIT
curl --fail --silent --show-error --retry 3 --max-time 240 https://touliao.cc/downloads/touliao-android-latest.apk -o "$RUNNER_TEMP/published.apk"
cmp "$apk" "$RUNNER_TEMP/published.apk"
curl --fail --silent --show-error --retry 3 --max-time 45 https://touliao.cc/downloads/touliao-android-version.json -o "$evidence/published-version.json"
cmp "$evidence/new-version.json" "$evidence/published-version.json"
echo "Published and verified Android $version: https://touliao.cc/downloads/$name"
