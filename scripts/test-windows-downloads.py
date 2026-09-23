import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-windows-downloads.py'))
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)


class Publication(unittest.TestCase):
    version = '8.1.27'
    previous_version = '8.1.26'
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.stage = self.root / '.stage'; self.stage.mkdir()
        (self.root / 'updates').mkdir(); self.run = '8127-1'
        self.paths = ['touliao-windows-latest.exe', 'touliao-windows-latest-setup.exe', 'updates/latest.yml',
                      'updates/latest.yml.sig', f'updates/touliao-{self.previous_version}-setup.exe', f'updates/touliao-{self.previous_version}-setup.exe.blockmap']
        for name in self.paths: (self.root / name).write_bytes(('old-' + name).encode())
        (self.root / 'touliao-android-version.json').write_bytes(b'android-must-not-change')
        manifest = {'version': self.version, 'previousVersion': self.previous_version, 'buildCommit': 'fixture', 'files': {},
                    'previousInstallerSha256': p.digest(self.root / f'updates/touliao-{self.previous_version}-setup.exe'),
                    'previousManifestSha256': p.digest(self.root / 'updates/latest.yml'),
                    'previousSignatureSha256': p.digest(self.root / 'updates/latest.yml.sig')}
        for name in ['latest.yml', 'latest.yml.sig', f'touliao-{self.version}-setup.exe', f'touliao-{self.version}-setup.exe.blockmap']:
            (self.stage / name).write_bytes(('new-' + name).encode()); manifest['files'][name] = p.digest(self.stage / name)
        (self.stage / 'spec.json').write_text(json.dumps(manifest))
        self.before = {name: (self.root / name).read_bytes() for name in self.paths}

    def publish(self):
        p.expose_version(self.root, self.stage)
        return p.activate(self.root, self.stage, self.run)

    def test_publish_rollback_preserves_old_versions_and_android(self):
        receipt = self.publish()
        self.assertEqual(p.digest(self.root / 'updates/latest.yml'), receipt['activated']['updates/latest.yml'])
        p.rollback(self.root, self.run)
        for name, old in self.before.items(): self.assertEqual((self.root / name).read_bytes(), old)
        self.assertEqual((self.root / 'touliao-android-version.json').read_bytes(), b'android-must-not-change')

    def test_reject_changed_live_version(self):
        p.expose_version(self.root, self.stage)
        (self.root / 'updates/latest.yml').write_bytes(b'another-publisher')
        with self.assertRaisesRegex(ValueError, 'Live version changed'): p.activate(self.root, self.stage, self.run)
        self.assertEqual((self.root / 'touliao-windows-latest.exe').read_bytes(), self.before['touliao-windows-latest.exe'])

    def test_reject_tampered_stage(self):
        (self.stage / f'touliao-{self.version}-setup.exe').write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'Staged file differs'): p.expose_version(self.root, self.stage)

    def test_rollback_rejects_concurrent_publication(self):
        self.publish(); (self.root / 'updates/latest.yml').write_bytes(b'later-release')
        with self.assertRaisesRegex(ValueError, 'different publication'): p.rollback(self.root, self.run)
        self.assertEqual((self.root / 'updates/latest.yml').read_bytes(), b'later-release')

    def test_rollback_rejects_corrupt_backup(self):
        receipt = self.publish(); (Path(receipt['backup']) / 'touliao-windows-latest.exe').write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'backup corrupted'): p.rollback(self.root, self.run)

    def test_partial_activation_restores_original_pointers(self):
        p.expose_version(self.root, self.stage); original = p.replace_copy; calls = 0
        def fail_once(*args):
            nonlocal calls
            calls += 1
            if calls == 4: raise OSError('injected write failure')
            return original(*args)
        with patch.object(p, 'replace_copy', side_effect=fail_once):
            with self.assertRaisesRegex(OSError, 'injected'): p.activate(self.root, self.stage, self.run)
        for name, old in self.before.items(): self.assertEqual((self.root / name).read_bytes(), old)

    def test_reject_unapproved_version(self):
        manifest = json.loads((self.stage / 'spec.json').read_text())
        manifest['version'] = '8.1.31'
        (self.stage / 'spec.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'approved version pair'): p.expose_version(self.root, self.stage)

    def test_reject_replacing_immutable_installer(self):
        (self.root / f'updates/touliao-{self.version}-setup.exe').write_bytes(b'conflicting artifact')
        with self.assertRaisesRegex(ValueError, 'Immutable version URL conflicts'): p.expose_version(self.root, self.stage)


class Publication8129(Publication):
    version = '8.1.29'
    previous_version = '8.1.27'


class Publication8130(Publication):
    version = '8.1.30'
    previous_version = '8.1.29'


if __name__ == '__main__': unittest.main()
