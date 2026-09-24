#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-android-downloads.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class AndroidPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stage = self.root / '.stage'
        self.stage.mkdir()
        self.latest = self.root / 'touliao-android-latest.apk'
        self.current = self.root / 'touliao-android-version.json'
        self.latest.write_bytes(b'old release fixture')
        self.old_sha = publisher.digest(self.latest)
        self.current.write_text(json.dumps({'versionCode': 81, 'versionName': '8.1.24', 'sha256': self.old_sha}))
        self.old_config = self.current.read_bytes()
        self.config_sha = publisher.digest(self.current)
        (self.stage / 'new.apk').write_bytes(b'new release fixture')
        self.new_sha = publisher.digest(self.stage / 'new.apk')
        self.new_config = {'versionCode': 82, 'versionName': '8.1.25', 'sha256': self.new_sha,
                           'url': 'https://touliao.cc/downloads/touliao-android-8.1.25.apk'}
        (self.stage / 'new-version.json').write_text(json.dumps(self.new_config))
        (self.root / 'touliao-android-8.1.25.apk').write_bytes(b'new release fixture')
        (self.root / 'unrelated-download.bin').write_bytes(b'unchanged')

    def activate(self):
        return publisher.activate(self.root, self.stage, '123-1', self.old_sha, self.config_sha, 'review-commit')

    def test_publish_retains_exact_previous_files_and_rolls_back(self):
        receipt = self.activate()
        backup = Path(receipt['backup'])
        self.assertEqual((backup / self.current.name).read_bytes(), self.old_config)
        self.assertEqual(publisher.digest(backup / self.latest.name), self.old_sha)
        self.assertEqual(publisher.digest(self.root / 'touliao-android-8.1.24.apk'), self.old_sha)
        self.assertEqual(json.loads(self.current.read_text()), self.new_config)
        self.assertEqual(publisher.digest(self.latest), self.new_sha)
        publisher.rollback(self.root, '123-1')
        self.assertEqual(self.current.read_bytes(), self.old_config)
        self.assertEqual(publisher.digest(self.latest), self.old_sha)
        self.assertEqual((self.root / 'unrelated-download.bin').read_bytes(), b'unchanged')

    def test_refuses_a_concurrently_changed_live_apk(self):
        self.latest.write_bytes(b'another publisher')
        with self.assertRaisesRegex(ValueError, 'changed since preflight'):
            self.activate()
        self.assertEqual(self.latest.read_bytes(), b'another publisher')
        self.assertEqual(self.current.read_bytes(), self.old_config)

    def test_refuses_version_code_downgrade(self):
        self.new_config['versionCode'] = 81
        (self.stage / 'new-version.json').write_text(json.dumps(self.new_config))
        with self.assertRaisesRegex(ValueError, 'downgrade'):
            self.activate()
        self.assertEqual(publisher.digest(self.latest), self.old_sha)

    def test_rollback_does_not_overwrite_another_release(self):
        self.activate()
        self.current.write_text(json.dumps({'versionCode': 83, 'sha256': 'another release'}))
        with self.assertRaisesRegex(ValueError, 'different release'):
            publisher.rollback(self.root, '123-1')
        self.assertEqual(json.loads(self.current.read_text())['versionCode'], 83)


class ReleaseNotes(unittest.TestCase):
    def setUp(self):
        import importlib.util as u
        spec = u.spec_from_file_location('verifier', Path(__file__).with_name('verify-android-release.py'))
        self.v = u.module_from_spec(spec); spec.loader.exec_module(self.v)
        self.dir = tempfile.TemporaryDirectory(); self.addCleanup(self.dir.cleanup)
        self.path = Path(self.dir.name) / 'notes.json'
    def write(self, **data): self.path.write_text(json.dumps(data, ensure_ascii=False))
    def test_accepts_current_version_notes(self):
        self.write(versionName='8.1.27', notes='本版本改动')
        self.assertEqual(self.v.release_notes(self.path, '8.1.27', '旧说明'), '本版本改动')
    def test_rejects_stale_version(self):
        self.write(versionName='8.1.26', notes='本版本改动')
        with self.assertRaises(SystemExit): self.v.release_notes(self.path, '8.1.27', '旧说明')
    def test_rejects_reused_previous_notes(self):
        self.write(versionName='8.1.27', notes='旧说明 ')
        with self.assertRaises(SystemExit): self.v.release_notes(self.path, '8.1.27', '旧说明')
    def test_rejects_empty_or_overlong_notes(self):
        for notes in ['', '   ', 'x' * 201, None]:
            self.write(versionName='8.1.27', notes=notes)
            with self.assertRaises(SystemExit): self.v.release_notes(self.path, '8.1.27', '旧说明')
    def test_repository_notes_match_gradle_version(self):
        import re
        root = Path(__file__).resolve().parents[1]
        gradle = (root / 'android/app/build.gradle.kts').read_text()
        name = re.search(r'versionName\s*=\s*"([^"]+)"', gradle)[1]
        self.assertEqual(json.loads((root / 'android/release-notes.json').read_text())['versionName'], name)


if __name__ == '__main__':
    unittest.main()
