"""Verify existing signing material and built artifacts; ASC requests are GET only."""
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
import jwt

TEAM = "F2J52VX786"
BUNDLE = "com.touliao.app"
PREP = Path(os.environ["PREP_DIR"])
PRIVATE = PREP / "private"
EVIDENCE = PREP / "evidence"
VERSION = os.environ["APP_VERSION"]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def save(name, data):
    (EVIDENCE / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def command(*args):
    return subprocess.check_output(args)


def profile_at(path):
    return plistlib.loads(command("security", "cms", "-D", "-i", str(path)))


def check_profile(profile):
    ent = profile["Entitlements"]
    require(profile["ExpirationDate"] > dt.datetime.now(dt.timezone.utc).replace(tzinfo=None), "Provisioning profile expired")
    require(TEAM in profile["TeamIdentifier"], "Provisioning team mismatch")
    require(ent.get("application-identifier") == TEAM + "." + BUNDLE, "Provisioning bundle mismatch")
    require(ent.get("aps-environment") == "production", "Missing production push entitlement")
    require(ent.get("get-task-allow") is False, "Debug profile is not suitable for TestFlight")
    require(ent.get("beta-reports-active") is True, "Missing App Store beta entitlement")
    require(not profile.get("ProvisionedDevices") and not profile.get("ProvisionsAllDevices"), "Profile is not App Store distribution")


def credentials():
    names = ["IOS_CERTIFICATE_P12_BASE64", "IOS_CERTIFICATE_PASSWORD", "IOS_KEYCHAIN_PASSWORD", "IOS_PROVISIONING_PROFILE_BASE64", "ASC_API_KEY_BASE64", "ASC_KEY_ID", "ASC_ISSUER_ID"]
    missing = [name for name in names if not os.environ.get(name)]
    save("secret-presence.json", {"required": names, "missing": missing})
    require(not missing, "Missing secrets: " + ", ".join(missing))
    p12_data = base64.b64decode(os.environ["IOS_CERTIFICATE_P12_BASE64"], validate=True)
    key, cert, _ = pkcs12.load_key_and_certificates(p12_data, os.environ["IOS_CERTIFICATE_PASSWORD"].encode())
    require(key is not None and cert is not None, "Distribution certificate or private key missing from P12")
    now = dt.datetime.now(dt.timezone.utc)
    require(cert.not_valid_before_utc <= now < cert.not_valid_after_utc, "Distribution certificate not valid now")
    require(cert.subject.get_attributes_for_oid(NameOID.ORGANIZATIONAL_UNIT_NAME)[0].value == TEAM, "Certificate team mismatch")
    subject = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
    require("Distribution" in subject, "Certificate is not a distribution identity")
    require(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo) == cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo), "Private key mismatch")
    (PRIVATE / "distribution.p12").write_bytes(p12_data)
    profile_path = PRIVATE / "distribution.mobileprovision"
    profile_path.write_bytes(base64.b64decode(os.environ["IOS_PROVISIONING_PROFILE_BASE64"], validate=True))
    profile = profile_at(profile_path)
    check_profile(profile)
    require(profile["Name"] == "touliao_distribution", "Unexpected provisioning profile name")
    require(cert.public_bytes(serialization.Encoding.DER) in profile["DeveloperCertificates"], "Distribution certificate not included in provisioning profile")
    (PRIVATE / "profile.plist").write_bytes(plistlib.dumps(profile))
    api_key = base64.b64decode(os.environ["ASC_API_KEY_BASE64"], validate=True)
    asc_private = serialization.load_pem_private_key(api_key, password=None)
    require(isinstance(asc_private, ec.EllipticCurvePrivateKey) and isinstance(asc_private.curve, ec.SECP256R1), "ASC p8 is not an ES256 private key")
    api_dir = PRIVATE / "api-keys"
    api_dir.mkdir(exist_ok=True)
    (api_dir / ("AuthKey_" + os.environ["ASC_KEY_ID"] + ".p8")).write_bytes(api_key)
    token = jwt.encode({"iss": os.environ["ASC_ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 600, "aud": "appstoreconnect-v1"}, api_key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"]})

    def get(resource, params):
        url = "https://api.appstoreconnect.apple.com/v1/" + resource + "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token}, method="GET")
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)

    apps = get("apps", {"filter[bundleId]": BUNDLE, "limit": 2})["data"]
    require(len(apps) == 1, "ASC key cannot access the expected app")
    app = apps[0]
    builds = get("builds", {"filter[app]": app["id"], "sort": "-uploadedDate", "limit": 200, "include": "preReleaseVersion"})
    previous_numbers = [int(b["attributes"]["version"]) for b in builds["data"] if b["attributes"]["version"].isdigit()]
    latest_versions = [r["attributes"]["version"] for r in builds.get("included", []) if r["type"] == "preReleaseVersions"]
    version_tuple = lambda value: tuple(int(n) for n in value.split("."))
    require(all(version_tuple(VERSION) >= version_tuple(v) for v in latest_versions), "Requested version is older than an existing TestFlight train")
    build = max(int(time.time()), max(previous_numbers, default=0) + 1)
    with open(os.environ["GITHUB_ENV"], "a") as env:
        env.write(f"BUILD_NUMBER={build}\n")
    schemes = json.loads((EVIDENCE / "schemes.json").read_text())
    require("Touliao" in schemes["project"]["schemes"], "Touliao scheme missing")
    save("signing-preflight.json", {"teamId": TEAM, "bundleId": BUNDLE, "scheme": "Touliao", "version": VERSION, "buildNumber": str(build), "certificateSubject": subject, "certificateExpires": cert.not_valid_after_utc.isoformat(), "certificateSha256": cert.fingerprint(hashes.SHA256()).hex(), "profileName": profile["Name"], "profileExpires": profile["ExpirationDate"].isoformat(), "profileType": "App Store distribution", "pushEnvironment": "production", "privateKeyMatchesCertificate": True, "certificateMatchesProfile": True, "ascP8Valid": True, "ascReadAuthenticationPassed": True, "appId": app["id"], "recentBuildMaximum": max(previous_numbers, default=0), "existingVersions": sorted(set(latest_versions)), "ascRequests": "GET only"})
    print("Signing material, profile, scheme and read-only ASC access validated.")


def verify_bundle(app, label):
    subprocess.run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)], check=True)
    info = plistlib.loads((app / "Info.plist").read_bytes())
    ent = plistlib.loads(command("codesign", "-d", "--entitlements", ":-", str(app)))
    profile = profile_at(app / "embedded.mobileprovision")
    check_profile(profile)
    require(info["CFBundleIdentifier"] == BUNDLE, "Built bundle identifier mismatch")
    require(info["CFBundleShortVersionString"] == VERSION, "Built marketing version mismatch")
    require(info["CFBundleVersion"] == os.environ["BUILD_NUMBER"], "Built build number mismatch")
    require(ent.get("application-identifier") == TEAM + "." + BUNDLE and ent.get("com.apple.developer.team-identifier") == TEAM, "Code signing identity mismatch")
    require(ent.get("aps-environment") == "production", "Built app missing production push entitlement")
    require(ent.get("get-task-allow") is False, "Built app enables debugging")
    require(ent.get("beta-reports-active") is True, "Built app missing beta entitlement")
    for name, value in ent.items():
        allowed = profile["Entitlements"].get(name)
        if isinstance(value, list):
            import fnmatch
            require(isinstance(allowed, list) and all(any(fnmatch.fnmatchcase(v, a) for a in allowed) for v in value), "Entitlement not permitted: " + name)
        else:
            require(allowed == value, "Entitlement not permitted: " + name)
    privacy_keys = ["NSMicrophoneUsageDescription", "NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"]
    require(all(isinstance(info.get(k), str) and info[k].strip() for k in privacy_keys), "Missing microphone/camera/photo privacy description")
    require("remote-notification" in info.get("UIBackgroundModes", []), "Missing background notification mode")
    require(info.get("FirebaseAppDelegateProxyEnabled") is False, "Unexpected Firebase APNs delegate configuration")
    require(info.get("ITSAppUsesNonExemptEncryption") is False, "Export compliance declaration missing")
    require(info.get("DTPlatformName") == "iphoneos", "App is not an iOS device build")
    require(int(re.search(r"\d+", info["DTSDKName"])[0]) >= 26, "SDK older than iOS 26")
    arch = command("lipo", "-archs", str(app / info["CFBundleExecutable"])).decode().strip()
    require("arm64" in arch.split(), "Missing arm64 device executable")
    prefix = PRIVATE / (label + "-cert-")
    subprocess.run(["codesign", "-d", "--extract-certificates", str(prefix), str(app)], check=True)
    signing_cert = x509.load_der_x509_certificate(Path(str(prefix) + "0").read_bytes())
    require(signing_cert.public_bytes(serialization.Encoding.DER) in profile["DeveloperCertificates"], "App signer absent from profile")
    preflight = json.loads((EVIDENCE / "signing-preflight.json").read_text())
    require(signing_cert.fingerprint(hashes.SHA256()).hex() == preflight["certificateSha256"], "App signer differs from verified distribution certificate")
    result = {"signatureVerified": True, "certificateMatchesProfile": True, "bundleId": info["CFBundleIdentifier"], "version": info["CFBundleShortVersionString"], "buildNumber": info["CFBundleVersion"], "architectures": arch, "sdk": info["DTSDKName"], "minimumOSVersion": info["MinimumOSVersion"], "entitlements": ent, "privacyDescriptions": {k: info[k] for k in privacy_keys}, "backgroundModes": info["UIBackgroundModes"], "firebaseApnsDelegateConfigured": True, "pushConfigurationVerified": True, "livePushDeliveryTested": False, "uploaded": False}
    save(label + "-validation.json", result)
    print(label + " signature, identity, entitlements and privacy declarations validated.")
    return result


if __name__ == "__main__":
    stage = sys.argv[1]
    if stage == "credentials":
        credentials()
    elif stage == "archive":
        verify_bundle(PREP / "Touliao.xcarchive/Products/Applications/Touliao.app", "archive")
    elif stage == "ipa":
        ipas = list((EVIDENCE / "export").glob("*.ipa"))
        require(len(ipas) == 1, "Expected exactly one exported IPA")
        extracted = PRIVATE / "extracted-ipa"
        with zipfile.ZipFile(ipas[0]) as archive:
            archive.extractall(extracted)
        apps = list((extracted / "Payload").glob("*.app"))
        require(len(apps) == 1, "Expected exactly one app in IPA")
        result = verify_bundle(apps[0], "ipa")
        result.update({"ipaFile": ipas[0].name, "ipaBytes": ipas[0].stat().st_size, "ipaSha256": hashlib.sha256(ipas[0].read_bytes()).hexdigest()})
        save("ipa-validation.json", result)
    else:
        raise ValueError("Unknown stage")
