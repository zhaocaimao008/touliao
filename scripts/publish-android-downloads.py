#!/usr/bin/env python3
"""Atomically activate only Android download entries, retaining exact rollback files."""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import re
import shutil


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def replace_copy(source, target, suffix):
    pending = target.with_name('.' + target.name + '.' + suffix + '.pending')
    shutil.copy2(source, pending)
    pending.replace(target)


def activate(root, stage, run_id, expected_apk, expected_manifest, commit):
    require(re.fullmatch(r'[0-9]+-[0-9]+', run_id), 'Invalid workflow run identifier')
    latest = root / 'touliao-android-latest.apk'
    current = root / 'touliao-android-version.json'
    require(digest(latest) == expected_apk, 'Live APK changed since preflight; refusing to overwrite')
    require(digest(current) == expected_manifest, 'Live update config changed since preflight')
    previous = json.loads(current.read_text())
    new = json.loads((stage / 'new-version.json').read_text())
    require(re.fullmatch(r'\d+\.\d+\.\d+', new['versionName']), 'Invalid versionName')
    require(re.fullmatch(r'\d+\.\d+\.\d+', previous['versionName']), 'Invalid previous versionName')
    require(new['versionCode'] > previous['versionCode'], 'Refusing versionCode downgrade')
    require(new['sha256'] == digest(stage / 'new.apk'), 'Staged APK digest mismatch')
    require(previous['sha256'] == expected_apk, 'Current manifest does not match installed-channel APK')
    target = root / f"touliao-android-{new['versionName']}.apk"
    require(new['url'] == f'https://touliao.cc/downloads/{target.name}', 'Unexpected release URL')
    require(digest(target) == new['sha256'], 'Versioned APK must be published and verified first')
    backup = root / '.release-backups' / 'android' / run_id
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(latest, backup / latest.name)
    shutil.copy2(current, backup / current.name)
    old_versioned = root / f"touliao-android-{previous['versionName']}.apk"
    if old_versioned.exists():
        require(digest(old_versioned) == expected_apk, 'Existing old versioned package conflicts')
    else:
        replace_copy(latest, old_versioned, run_id)
    receipt = {'commit': commit, 'previous': previous, 'release': new, 'backup': str(backup),
               'previousApkSha256': expected_apk, 'previousManifestSha256': expected_manifest,
               'changedPublicEntries': [latest.name, current.name, target.name, old_versioned.name]}
    (backup / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    try:
        replace_copy(target, latest, run_id)
        replace_copy(stage / 'new-version.json', current, run_id)
        require(digest(latest) == new['sha256'], 'Activated latest APK differs')
        require(current.read_bytes() == (stage / 'new-version.json').read_bytes(), 'Activated manifest differs')
    except Exception:
        replace_copy(backup / latest.name, latest, run_id)
        replace_copy(backup / current.name, current, run_id)
        raise
    return receipt


def rollback(root, run_id):
    require(re.fullmatch(r'[0-9]+-[0-9]+', run_id), 'Invalid workflow run identifier')
    backup = root / '.release-backups' / 'android' / run_id
    receipt = json.loads((backup / 'receipt.json').read_text())
    current = root / 'touliao-android-version.json'
    latest = root / 'touliao-android-latest.apk'
    require(json.loads(current.read_text()) == receipt['release'], 'A different release is active; refusing rollback')
    require(digest(latest) == receipt['release']['sha256'], 'Latest APK changed; refusing rollback')
    require(digest(backup / latest.name) == receipt['previousApkSha256'], 'Rollback APK corrupted')
    require(digest(backup / current.name) == receipt['previousManifestSha256'], 'Rollback manifest corrupted')
    replace_copy(backup / latest.name, latest, run_id)
    replace_copy(backup / current.name, current, run_id)
    return {'rolledBack': True, 'version': receipt['previous']['versionName'], 'backup': str(backup)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', type=Path, default=Path('/var/www/downloads'))
    p.add_argument('--stage', type=Path)
    p.add_argument('--run-id', required=True)
    p.add_argument('--expected-apk')
    p.add_argument('--expected-manifest')
    p.add_argument('--commit')
    p.add_argument('--rollback', action='store_true')
    a = p.parse_args()
    with (a.root / '.android-release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        result = rollback(a.root, a.run_id) if a.rollback else activate(a.root, a.stage, a.run_id, a.expected_apk, a.expected_manifest, a.commit)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
