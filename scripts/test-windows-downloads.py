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
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.stage = self.root / '.stage'; self.stage.mkdir()
        (self.root / 'updates').mkdir(); self.run = '8127-1'
        self.paths = ['touliao-windows-latest.exe', 'touliao-windows-latest-setup.exe', 'updates/latest.yml',
                      'updates/latest.yml.sig', 'updates/touliao-8.1.26-setup.exe', 'updates/touliao-8.1.26-setup.exe.blockmap']
        for name in self.paths: (self.root / name).write_bytes(('old-' + name).encode())
        (self.root / 'touliao-android-version.json').write_bytes(b'android-must-not-change')
        manifest = {'version': '8.1.27', 'previousVersion': '8.1.26', 'buildCommit': 'fixture', 'files': {},
                    'previousInstallerSha256': p.digest(self.root / 'updates/touliao-8.1.26-setup.exe'),
                    'previousManifestSha256': p.digest(self.root / 'updates/latest.yml'),
                    'previousSignatureSha256': p.digest(self.root / 'updates/latest.yml.sig')}
        for name in ['latest.yml', 'latest.yml.sig', 'touliao-8.1.27-setup.exe', 'touliao-8.1.27-setup.exe.blockmap']:
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
        (self.stage / 'touliao-8.1.27-setup.exe').write_bytes(b'tampered')
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


if __name__ == '__main__': unittest.main()
