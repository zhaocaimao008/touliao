#!/usr/bin/env bash
# A build-only path: no upload, review submission, provisioning mutation, or deployment.
set -euo pipefail
umask 077
: "${PREP_DIR:?Missing preparation directory}"
: "${APP_VERSION:?Missing iOS version}"
REPO_DIR="$(pwd)"
EVIDENCE_DIR="$PREP_DIR/evidence"
PRIVATE_DIR="$PREP_DIR/private"
mkdir -p "$EVIDENCE_DIR" "$PRIVATE_DIR"

case "${1:?Missing stage}" in
  setup)
    [[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
    XCODE_APP=$(python3 -c 'from pathlib import Path; import re; apps=list(Path("/Applications").glob("Xcode_26*.app")); assert apps, "Xcode 26 is required"; print(max(apps,key=lambda p:tuple(map(int,re.findall(r"\d+",p.name)))))')
    sudo xcode-select -s "$XCODE_APP/Contents/Developer"
    xcodebuild -version | tee "$EVIDENCE_DIR/xcode-version.txt"
    xcrun --sdk iphoneos --show-sdk-version | tee "$EVIDENCE_DIR/iphoneos-sdk.txt"
    git rev-parse HEAD > "$EVIDENCE_DIR/source-commit.txt"
    brew install xcodegen
    (cd ios && xcodegen generate)
    python3 -m venv "$PRIVATE_DIR/venv"
    "$PRIVATE_DIR/venv/bin/pip" install --quiet pyjwt cryptography
    xcodebuild -resolvePackageDependencies -project ios/Touliao.xcodeproj -scheme Touliao | tee "$EVIDENCE_DIR/resolve.log"
    xcodebuild -list -json -project ios/Touliao.xcodeproj > "$EVIDENCE_DIR/schemes.json"
    ;;
  credentials)
    "$PRIVATE_DIR/venv/bin/python" ios/release-preparation/verify.py credentials
    KEYCHAIN_PATH="$PRIVATE_DIR/signing.keychain-db"
    security create-keychain -p "$IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
    security unlock-keychain -p "$IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
    security set-keychain-settings -t 21600 -l "$KEYCHAIN_PATH"
    security list-keychains -d user -s "$KEYCHAIN_PATH" "$HOME/Library/Keychains/login.keychain-db"
    security import "$PRIVATE_DIR/distribution.p12" -k "$KEYCHAIN_PATH" -P "$IOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
    security set-key-partition-list -S apple-tool:,apple: -s -k "$IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null
    security find-identity -v -p codesigning "$KEYCHAIN_PATH" > "$EVIDENCE_DIR/signing-identities.txt"
    PROFILE_UUID=$("$PRIVATE_DIR/venv/bin/python" -c 'import os,plistlib; print(plistlib.load(open(os.environ["PREP_DIR"]+"/private/profile.plist","rb"))["UUID"])')
    mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
    cp "$PRIVATE_DIR/distribution.mobileprovision" "$HOME/Library/MobileDevice/Provisioning Profiles/$PROFILE_UUID.mobileprovision"
    printf '%s' "$HOME/Library/MobileDevice/Provisioning Profiles/$PROFILE_UUID.mobileprovision" > "$PRIVATE_DIR/installed-profile-path"
    ;;
  simulator)
    xcodebuild clean build -project ios/Touliao.xcodeproj -scheme Touliao -destination 'generic/platform=iOS Simulator' -configuration Debug -derivedDataPath "$PREP_DIR/simulator-data" CODE_SIGNING_ALLOWED=NO | tee "$EVIDENCE_DIR/simulator-build.log"
    SIMULATOR_ID=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; devices=[d for runtime,ds in json.load(sys.stdin)["devices"].items() if "iOS" in runtime for d in ds if d["name"].startswith("iPhone")]; assert devices,"No iPhone simulator"; print(devices[-1]["udid"])')
    xcrun simctl boot "$SIMULATOR_ID"
    xcrun simctl bootstatus "$SIMULATOR_ID" -b
    xcrun simctl list devices booted -j > "$EVIDENCE_DIR/simulator.json"
    xcodebuild test -project ios/Touliao.xcodeproj -scheme Touliao -destination "platform=iOS Simulator,id=$SIMULATOR_ID" -configuration Debug -derivedDataPath "$PREP_DIR/simulator-data" -parallel-testing-enabled NO -test-timeouts-enabled YES -default-test-execution-time-allowance 300 -maximum-test-execution-time-allowance 300 -only-testing:TouliaoTests -resultBundlePath "$EVIDENCE_DIR/SimulatorTests.xcresult" CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= CODE_SIGN_ENTITLEMENTS="$REPO_DIR/scripts/native-review/Simulator.entitlements" | tee "$EVIDENCE_DIR/simulator-tests.log"
    ;;
  build)
    xcodebuild clean build -project ios/Touliao.xcodeproj -scheme Touliao -configuration Release -destination 'generic/platform=iOS' -derivedDataPath "$PREP_DIR/device-data" MARKETING_VERSION="$APP_VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" | tee "$EVIDENCE_DIR/release-build.log"
    ;;
  archive)
    xcodebuild archive -project ios/Touliao.xcodeproj -scheme Touliao -configuration Release -destination 'generic/platform=iOS' -derivedDataPath "$PREP_DIR/device-data" -archivePath "$PREP_DIR/Touliao.xcarchive" MARKETING_VERSION="$APP_VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" | tee "$EVIDENCE_DIR/archive.log"
    ;;
  export)
    "$PRIVATE_DIR/venv/bin/python" ios/release-preparation/verify.py archive
    xcodebuild -exportArchive -archivePath "$PREP_DIR/Touliao.xcarchive" -exportPath "$EVIDENCE_DIR/export" -exportOptionsPlist ios/release-preparation/ExportOptions.plist | tee "$EVIDENCE_DIR/export.log"
    cp ios/release-preparation/ExportOptions.plist "$EVIDENCE_DIR/ExportOptions.plist"
    "$PRIVATE_DIR/venv/bin/python" ios/release-preparation/verify.py ipa
    ;;
  validate)
    IPA_PATH=$(find "$EVIDENCE_DIR/export" -maxdepth 1 -name '*.ipa' -print -quit)
    test -n "$IPA_PATH"
    API_PRIVATE_KEYS_DIR="$PRIVATE_DIR/api-keys" xcrun altool --validate-app -f "$IPA_PATH" --type ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" | tee "$EVIDENCE_DIR/apple-validation.log"
    printf '{"appleValidationPassed":true,"uploaded":false,"submittedForReview":false}\n' > "$EVIDENCE_DIR/apple-validation.json"
    ;;
  cleanup)
    if [ -f "$PRIVATE_DIR/installed-profile-path" ]; then
      rm -f "$(cat "$PRIVATE_DIR/installed-profile-path")"
    fi
    if [ -f "$PRIVATE_DIR/signing.keychain-db" ]; then
      security delete-keychain "$PRIVATE_DIR/signing.keychain-db"
    fi
    rm -rf "$PRIVATE_DIR"
    ;;
  *) echo "Unknown stage" >&2; exit 2 ;;
esac
