#!/usr/bin/env bash
# Upload an existing approved IPA; external Beta review is explicitly opt-in.
set -euo pipefail
umask 077
: "${UPLOAD_DIR:?}"
mkdir -p "$UPLOAD_DIR/private" "$UPLOAD_DIR/evidence"
case "${1:?Missing stage}" in
  setup)
    XCODE_APP=$(python3 -c 'from pathlib import Path; import re; apps=list(Path("/Applications").glob("Xcode_26*.app")); assert apps; print(max(apps,key=lambda p:tuple(map(int,re.findall(r"\d+",p.name)))))')
    sudo xcode-select -s "$XCODE_APP/Contents/Developer"
    xcodebuild -version > "$UPLOAD_DIR/evidence/xcode-version.txt"
    python3 -m venv "$UPLOAD_DIR/private/venv"
    "$UPLOAD_DIR/private/venv/bin/pip" install --quiet pyjwt cryptography
    gh run view "$PREPARED_RUN_ID" -R "$GITHUB_REPOSITORY" --json headSha,conclusion,event,workflowName,url > "$UPLOAD_DIR/evidence/source-run.json"
    "$UPLOAD_DIR/private/venv/bin/python" ios/release-preparation/upload-prepared.py verify
    "$UPLOAD_DIR/private/venv/bin/python" ios/release-preparation/upload-prepared.py check
    ;;
  upload)
    API_PRIVATE_KEYS_DIR="$UPLOAD_DIR/private/api-keys" xcrun altool --upload-app \
      -f "$IPA_PATH" --type ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" \
      2>&1 | tee "$UPLOAD_DIR/evidence/upload.log"
    printf '{"uploadCommandSucceeded":true,"submittedForReview":false}\n' > "$UPLOAD_DIR/evidence/upload-command.json"
    ;;
  wait)
    "$UPLOAD_DIR/private/venv/bin/python" -u ios/release-preparation/upload-prepared.py wait
    ;;
  beta-review)
    test "${PREPARED_BETA_REVIEW:-false}" = true
    "$UPLOAD_DIR/private/venv/bin/python" -u ios/release-preparation/upload-prepared.py beta-review
    ;;
  *) echo 'Unknown upload stage' >&2; exit 2 ;;
esac
