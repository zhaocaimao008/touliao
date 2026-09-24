#!/usr/bin/env python3
"""Verify the release APK against the installed-channel baseline before publication."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

CERTIFICATE = "345e9485b4220e607c40afee304f16ca00f87d6f080184423defc0ea1e85983c"
BUILD_TOOLS = "34.0.0"


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def sdk_tool(name):
    for root in [os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT")]:
        if root:
            candidate = Path(root) / "build-tools" / BUILD_TOOLS / name
            require(candidate.is_file(), f"Required release SDK tool missing: {candidate}")
            return str(candidate)
    found = shutil.which(name)
    require(found, f"Required SDK tool missing: {name}")
    return found


def certificate(signature, apk):
    certs = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$", signature, re.M)
    require(certs == [CERTIFICATE], f"APK signer mismatch for {apk}: expected {CERTIFICATE}, got {certs}; tool={sdk_tool('apksigner')}")
    return certs[0]


def inspect(apk):
    command = [sdk_tool("apksigner"), "verify", "--verbose", "--print-certs"]
    signature = subprocess.check_output(command + [str(apk)], text=True)
    cert = certificate(signature, apk)
    for scheme in [2, 3]:
        require(re.search(rf"Verified using v{scheme} scheme.*: true", signature), f"Missing APK v{scheme} signature")
    # For minSdk >= 24, normal verification uses v2/v3 and reports v1=false
    # even when a valid JAR signature is present. Verify that signature separately.
    jar_signature = subprocess.check_output(command + ["--min-sdk-version", "23", "--max-sdk-version", "23", str(apk)], text=True)
    require(certificate(jar_signature, apk) == cert, "JAR and APK signing certificates differ")
    require(re.search(r"Verified using v1 scheme.*: true", jar_signature), "Missing or invalid APK v1 signature")
    badging = subprocess.check_output([sdk_tool("aapt"), "dump", "badging", str(apk)], text=True)
    match = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
    require(match, "Cannot read APK identity")
    require("application-debuggable" not in badging, "Debug APK cannot be published")
    abis = re.search(r"^native-code: (.+)$", badging, re.M)
    return {
        "package": match[1], "versionCode": int(match[2]), "versionName": match[3],
        "sha256": hashlib.sha256(apk.read_bytes()).hexdigest(), "bytes": apk.stat().st_size,
        "certificateSha256": cert, "abis": sorted(re.findall(r"'([^']+)'", abis[1])) if abis else [],
        "v1": True, "v2": True, "v3": True, "verificationBuildTools": BUILD_TOOLS,
    }


def release_notes(path, version_name, previous_notes):
    """每次发版必须提供本版本的更新说明（App 更新弹窗原样展示给用户），不得沿用上一版文案。"""
    data = json.loads(Path(path).read_text())
    require(data.get("versionName") == version_name,
            f"android/release-notes.json 的 versionName 必须是 {version_name}，请为本次发版更新说明")
    notes = data.get("notes")
    require(isinstance(notes, str) and notes.strip(), "更新说明不能为空")
    require(len(notes) <= 200, "更新说明不超过 200 字")
    require(notes.strip() != (previous_notes or "").strip(), "更新说明与上一版相同，请写本版本的改动")
    return notes.strip()


def version(value):
    require(re.fullmatch(r"\d+\.\d+\.\d+", value), "Release version must be numeric x.y.z")
    return tuple(map(int, value.split(".")))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apk", type=Path, required=True)
    p.add_argument("--baseline-apk", type=Path, required=True)
    p.add_argument("--baseline-manifest", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--notes", type=Path, default=Path("android/release-notes.json"))
    args = p.parse_args()
    previous = json.loads(args.baseline_manifest.read_text())
    old = inspect(args.baseline_apk)
    new = inspect(args.apk)
    require(old["sha256"] == previous["sha256"], "Baseline APK differs from live update manifest")
    require(old["versionCode"] == previous["versionCode"] and old["versionName"] == previous["versionName"], "Baseline version mismatch")
    require(old["package"] == new["package"] == "com.touliao.app", "Application ID must remain unchanged")
    require(new["versionCode"] > old["versionCode"], "versionCode must increase")
    require(version(new["versionName"]) > version(old["versionName"]), "versionName must increase")
    require(set(old["abis"]).issubset(new["abis"]), "Existing supported ABIs must remain available")
    require(new["v1"], "Formal release requires the configured v1/v2/v3 signature schemes")
    gradle = Path("android/app/build.gradle.kts").read_text()
    require(re.search(r'versionName\s*=\s*"([^"]+)"', gradle)[1] == new["versionName"], "APK and Gradle versionName differ")
    require(int(re.search(r"versionCode\s*=\s*(\d+)", gradle)[1]) == new["versionCode"], "APK and Gradle versionCode differ")
    ref = os.environ.get("GITHUB_REF_NAME", "")
    if ref.startswith("android-v"):
        require(ref == "android-v" + new["versionName"], "Android tag and APK versions differ")
    with zipfile.ZipFile(args.apk) as z:
        require(z.testzip() is None, "APK ZIP integrity failed")
        dex = b"".join(z.read(name) for name in z.namelist() if re.fullmatch(r"classes\d*\.dex", name))
        for marker in [b"native-review.invalid", b"UiReviewActivity", b"ReviewRunner"]:
            require(marker not in dex, "Review-only classes or endpoints found in release APK")
        require(b"https://touliao.cc" in dex, "Production service default missing")
        require(not any(name.endswith("fixtures.json") for name in z.namelist()), "Test fixtures included in release APK")
    notes = release_notes(args.notes, new["versionName"], previous.get("notes"))
    args.output.mkdir(parents=True, exist_ok=True)
    result = {"previous": old, "release": new, "signerMatches": True, "upgradeVersionIncreases": True,
              "releaseConfiguration": True, "productionEndpoint": "https://touliao.cc", "commit": os.environ.get("GITHUB_SHA", "")}
    (args.output / "verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    manifest = {"versionCode": new["versionCode"], "versionName": new["versionName"],
                "url": f"https://touliao.cc/downloads/touliao-android-{new['versionName']}.apk",
                "notes": notes,
                "sha256": new["sha256"]}
    (args.output / "new-version.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
