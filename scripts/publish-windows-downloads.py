#!/usr/bin/env python3
"""Publish the exact approved Windows artifact; preserve rollback and other platforms."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def require(value, message):
    if not value:
        raise ValueError(message)


def replace_copy(source, target, run_id):
    pending = target.with_name('.' + target.name + '.' + run_id + '.pending')
    shutil.copy2(source, pending)
    os.chmod(pending, 0o644)
    pending.replace(target)


def validate_stage(stage):
    spec = json.loads((stage / 'spec.json').read_text())
    require((spec['version'], spec['previousVersion']) in {('8.1.27', '8.1.26'), ('8.1.29', '8.1.27'), ('8.1.30', '8.1.29'), ('8.1.31', '8.1.30')},
            'Only the approved version pair is allowed')
    installer = f"touliao-{spec['version']}-setup.exe"
    names = {'latest.yml', 'latest.yml.sig', installer, installer + '.blockmap'}
    require(set(spec['files']) == names, 'Unexpected publication scope')
    for name, expected in spec['files'].items():
        require(digest(stage / name) == expected, 'Staged file differs: ' + name)
    return spec


def expose_version(root, stage):
    spec = validate_stage(stage)
    installer = f"touliao-{spec['version']}-setup.exe"
    for name in [installer, installer + '.blockmap']:
        source, target = stage / name, root / 'updates' / name
        os.chmod(source, 0o644)
        if target.exists():
            require(digest(target) == spec['files'][name], 'Immutable version URL conflicts')
        else:
            os.link(source, target)
    return {'versionExposed': spec['version'], 'updatePointerChanged': False}


def activate(root, stage, run_id):
    spec = validate_stage(stage)
    require(digest(root / 'updates/latest.yml') == spec['previousManifestSha256'], 'Live version changed; refusing overwrite')
    require(digest(root / 'updates/latest.yml.sig') == spec['previousSignatureSha256'], 'Live signature changed')
    previous = f"updates/touliao-{spec['previousVersion']}-setup.exe"
    require(digest(root / previous) == spec['previousInstallerSha256'], 'Previous installer differs')
    installer = f"touliao-{spec['version']}-setup.exe"
    for name in [installer, installer + '.blockmap']:
        require(digest(root / 'updates' / name) == spec['files'][name], 'Versioned file must be verified first')
    changes = {
        'touliao-windows-latest.exe': installer,
        'touliao-windows-latest-setup.exe': installer,
        'updates/latest.yml.sig': 'latest.yml.sig',
        'updates/latest.yml': 'latest.yml',
    }
    backup = root / '.release-backups/windows' / run_id
    backup.mkdir(parents=True, exist_ok=False)
    previous_paths = [previous, previous + '.blockmap']
    previous = {}
    for relative in list(changes) + previous_paths:
        source, saved = root / relative, backup / relative
        saved.parent.mkdir(parents=True, exist_ok=True)
        previous[relative] = digest(source)
        shutil.copy2(source, saved)
    receipt = {'version': spec['version'], 'previousVersion': spec['previousVersion'], 'buildCommit': spec['buildCommit'],
               'backup': str(backup), 'previous': previous, 'activated': {p: spec['files'][n] for p, n in changes.items()},
               'ed25519Required': True, 'authenticode': False, 'otherPlatformsChanged': False}
    (backup / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    try:
        for relative, source in changes.items():
            replace_copy(stage / source, root / relative, run_id)
        for relative, expected in receipt['activated'].items():
            require(digest(root / relative) == expected, 'Activation digest mismatch')
    except Exception:
        for relative in changes:
            replace_copy(backup / relative, root / relative, run_id)
        raise
    return receipt


def rollback(root, run_id):
    backup = root / '.release-backups/windows' / run_id
    receipt = json.loads((backup / 'receipt.json').read_text())
    for relative, expected in receipt['activated'].items():
        require(digest(root / relative) == expected, 'A different publication is active; refusing rollback')
        require(digest(backup / relative) == receipt['previous'][relative], 'Rollback backup corrupted')
    for relative in receipt['activated']:
        replace_copy(backup / relative, root / relative, run_id)
    return {'rolledBack': True, 'version': receipt['previousVersion'], 'backup': str(backup)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', type=Path, default=Path('/var/www/downloads'))
    p.add_argument('--stage', type=Path)
    p.add_argument('--run-id', required=True)
    p.add_argument('--mode', choices=['stage', 'activate', 'rollback'], required=True)
    a = p.parse_args()
    require(re.fullmatch(r'[0-9]+-[0-9]+', a.run_id), 'Invalid run ID')
    with (a.root / '.windows-release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if a.mode == 'rollback': result = rollback(a.root, a.run_id)
        elif a.mode == 'stage': result = expose_version(a.root, a.stage)
        else: result = activate(a.root, a.stage, a.run_id)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
