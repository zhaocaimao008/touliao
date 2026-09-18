#!/usr/bin/env python3
"""Prepare review materials; never publish them or imply old clients can load them."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--renderer', type=Path, required=True)
    p.add_argument('--android-apk', type=Path, required=True)
    p.add_argument('--android-manifest', type=Path, required=True)
    p.add_argument('--candidate-apk', type=Path)
    p.add_argument('--candidate-verification', type=Path)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    manifest = json.loads(a.android_manifest.read_text())
    assert (manifest['versionName'], manifest['versionCode']) == ('8.1.25', 82)
    assert digest(a.android_apk) == manifest['sha256']
    assert (a.renderer / 'index.html').is_file()
    assert not a.output.exists(), 'Choose a fresh output directory; existing materials are preserved'
    a.output.mkdir(parents=True)
    windows = a.output / 'windows'; windows.mkdir()
    android = a.output / 'android'; android.mkdir()
    entries = []
    bundle = windows / 'renderer-ui-candidate.zip'
    with zipfile.ZipFile(bundle, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for f in sorted(a.renderer.rglob('*')):
            if not f.is_file():
                continue
            assert not f.is_symlink()
            relative = f.relative_to(a.renderer).as_posix()
            info = zipfile.ZipInfo(relative, date_time=(2026, 9, 18, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, f.read_bytes())
            entries.append({'path': relative, 'bytes': f.stat().st_size, 'sha256': digest(f)})
    (windows / 'renderer-files.json').write_text(json.dumps(entries, indent=2) + '\n')
    apk = android / 'touliao-android-8.1.25.apk'
    shutil.copyfile(a.android_apk, apk)
    shutil.copyfile(a.android_manifest, android / 'existing-public-version.json')
    plan = {
        'schema': 'touliao-transition-review/1', 'publishAllowed': False,
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'compatibleLegacyHotUpdateVersions': [],
        'windows': {
            'payload': bundle.relative_to(a.output).as_posix(), 'sha256': digest(bundle),
            'kind': 'unsigned renderer build for review, not a legacy update package',
            'installed8.1.26CanLoadThis': False, 'newBootstrapInstallerIncluded': False,
            'requires': ['native signed resource loader', 'unchanged file origin and profile storage',
                         'Ed25519 signed compatible manifest', 'Windows Authenticode credentials',
                         'installed-client upgrade and loader rollback validation'],
            'futureScopeAfterBootstrap': ['compatible renderer HTML/CSS/JS/icons/fonts'],
        },
        'android': {
            'payload': apk.relative_to(a.output).as_posix(), 'sha256': digest(apk),
            'kind': 'already published whole APK, application-internal package upgrade only',
            'addsHotUpdateLoader': False, 'newBootstrapInstallerIncluded': False,
            'requires': ['future native data-only theme loader and signature verification',
                         'new same-signer higher-versionCode bootstrap APK',
                         'installed-client retention and loader rollback validation'],
            'futureMinimalScopeAfterBootstrap': ['bounded theme tokens', 'selection among bundled fonts and icons'],
            'stillRequiresApk': ['Compose layouts', 'Kotlin code', 'native libraries', 'permissions'],
        },
        'ios': {'modified': False, 'included': False, 'published': False},
    }
    assert bool(a.candidate_apk) == bool(a.candidate_verification), 'Candidate APK and verification must be supplied together'
    if a.candidate_apk:
        verification = json.loads(a.candidate_verification.read_text())
        candidate = verification['release']
        assert (candidate['versionName'], candidate['versionCode'], candidate['package']) == ('8.1.26', 83, 'com.touliao.app')
        assert digest(a.candidate_apk) == candidate['sha256']
        assert candidate['certificateSha256'] == '345e9485b4220e607c40afee304f16ca00f87d6f080184423defc0ea1e85983c'
        folder = android / 'unpublished-candidate'; folder.mkdir()
        target = folder / 'touliao-android-8.1.26.apk'
        shutil.copyfile(a.candidate_apk, target)
        shutil.copyfile(a.candidate_verification, folder / 'verification.json')
        plan['android']['unpublishedCandidate'] = {
            'payload': target.relative_to(a.output).as_posix(), 'sha256': candidate['sha256'],
            'versionCode': 83, 'versionName': '8.1.26', 'sourceCommit': verification['commit'],
            'publishAllowed': False, 'fix': 'Android 9/10 APK certificate collection; strict signer matching retained',
            'oldApi29InAppUpdaterCanInstallThis': False, 'addsHotUpdateLoader': False,
            'initialInstallationOnAffectedSystems': 'external same-signer system package replacement, no uninstall',
        }
    (a.output / 'transition-review.json').write_text(json.dumps(plan, indent=2) + '\n')
    (a.output / 'README.txt').write_text(
        '审阅材料，禁止作为旧版热更新资源发布。\n'
        'Windows zip 是新版渲染资源，8.1.26 没有加载器，不能识别。\n'
        'Android APK 是此前已发布的 8.1.25 整包，没有新增热更新能力。\n'
        '如有 unpublished-candidate，8.1.26/code83 是原签名兼容修复待审阅包，未发布；同样没有热更新加载器。\n'
        '带加载器的过渡安装包尚未实现/签名；详见 docs/LEGACY-UPDATE-AUDIT-20260918.md。\n'
        'iOS 不在本材料中。\n')
    files = sorted(f for f in a.output.rglob('*') if f.is_file())
    (a.output / 'SHA256SUMS').write_text(''.join(f'{digest(f)}  {f.relative_to(a.output).as_posix()}\n' for f in files))
    with zipfile.ZipFile(bundle) as z:
        assert z.testzip() is None and len(z.namelist()) == len(entries)
    print(json.dumps({'output': str(a.output), 'windowsRendererFiles': len(entries),
                      'windowsRendererSha256': digest(bundle), 'androidApkSha256': digest(apk),
                      'publishAllowed': False, 'bootstrapInstallerIncluded': False}, indent=2))


if __name__ == '__main__':
    main()
