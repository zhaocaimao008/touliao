#!/usr/bin/env bash
set -euo pipefail
mode=${1:?publish or rollback}
approval=${3:-8127}
case "$approval" in
  8127) version=8.1.27 ;;
  8129) version=8.1.29 ;;
  *) echo 'Exact user-approved release required' >&2; exit 1 ;;
esac
installer="touliao-$version-setup.exe"
evidence=windows-publication-evidence
mkdir -p "$evidence"
test "${DEPLOY_HOST:?}" = 13.212.117.22
test -n "${DEPLOY_USER:?}"
test -n "${DEPLOY_SSH_KEY:?}"
run_id="${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
[[ "$run_id" =~ ^[0-9]+-[0-9]+$ ]]
key="$RUNNER_TEMP/windows-$approval-deploy-key"
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" > "$key"
ssh_args=(-i "$key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$GITHUB_WORKSPACE/deploy/ssh_known_hosts")
remote="$DEPLOY_USER@$DEPLOY_HOST"
stage="/var/www/downloads/.windows-stage-$run_id"
activated=false
finish() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$activated" = true ]; then
    ssh "${ssh_args[@]}" "$remote" "python3 '$stage/publish.py' --run-id '$run_id' --mode rollback" > "$evidence/rollback.json" || echo 'Rollback failed; inspect publication receipt.' >&2
  fi
  rm -f "$key"
  exit "$status"
}
trap finish EXIT
if [ "$mode" = rollback ]; then
  ssh "${ssh_args[@]}" "$remote" "python3 '$stage/publish.py' --run-id '$run_id' --mode rollback" > "$evidence/rollback.json"
  exit 0
fi
test "$mode" = publish
artifact=${2:?Verified artifact directory required}
node scripts/verify-windows-8127.cjs "$artifact" "$approval" > "$evidence/verification.json"
ssh "${ssh_args[@]}" "$remote" "mkdir -p '$stage'"
for name in latest.yml latest.yml.sig "$installer" "$installer.blockmap"; do
  scp "${ssh_args[@]}" "$artifact/$name" "$remote:$stage/$name"
done
scp "${ssh_args[@]}" "scripts/windows-$approval-publication.json" "$remote:$stage/spec.json"
scp "${ssh_args[@]}" scripts/publish-windows-downloads.py "$remote:$stage/publish.py"
ssh "${ssh_args[@]}" "$remote" "python3 '$stage/publish.py' --stage '$stage' --run-id '$run_id' --mode stage" > "$evidence/staging.json"
verify_public() {
  url=$1
  expected=$2
  curl --fail --silent --show-error --retry 3 --max-time 240 "$url" -o "$RUNNER_TEMP/windows-$approval-received"
  cmp "$expected" "$RUNNER_TEMP/windows-$approval-received"
}
base=https://touliao.cc/downloads
verify_public "$base/updates/$installer" "$artifact/$installer"
verify_public "$base/updates/$installer.blockmap" "$artifact/$installer.blockmap"
ssh "${ssh_args[@]}" "$remote" "python3 '$stage/publish.py' --stage '$stage' --run-id '$run_id' --mode activate" > "$evidence/publication.json"
activated=true
for name in latest.yml latest.yml.sig; do
  verify_public "$base/updates/$name" "$artifact/$name"
done
verify_public "$base/touliao-windows-latest.exe" "$artifact/$installer"
verify_public "$base/touliao-windows-latest-setup.exe" "$artifact/$installer"
printf '{"publicFilesByteIdentical":true,"version":"%s","platform":"windows"}\n' "$version" > "$evidence/public-verification.json"
