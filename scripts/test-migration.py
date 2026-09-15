import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("migration", Path(__file__).resolve().parents[1] / "deploy/migration-bundle.py")
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.builder = migration.Builder(self.root)
        self.archive = self.root / "snapshot.tar.gz"

    def tearDown(self):
        self.temp.cleanup()

    def pack(self):
        self.builder.add_stream(io.BytesIO(b"PRIVATE_ENV_VALUE"), "config/backend.env")
        self.builder.add_stream(io.BytesIO(b"same release bytes"), "public/downloads/app.exe", 0o644)
        self.builder.add_stream(io.BytesIO(b"same release bytes"), "public/downloads/alias.exe", 0o644)
        self.builder.pack(self.archive, {"sourceCommit": "fixture"})

    def rewrite(self, change):
        entries = []
        with tarfile.open(self.archive, "r:gz") as source:
            for info in source:
                entries.append((info, source.extractfile(info).read()))
        change(entries)
        with tarfile.open(self.archive, "w:gz") as target:
            for info, content in entries:
                info.size = len(content)
                target.addfile(info, io.BytesIO(content))

    def test_round_trip_dedup_and_permissions(self):
        self.pack()
        report = migration.verify_archive(self.archive)
        self.assertEqual(len(report["files"]), 3)
        self.assertEqual(len({r["sha256"] for r in report["files"].values()}), 2)
        destination = self.root / "restored"
        migration.restore_archive(self.archive, destination)
        self.assertEqual((destination / "files/config/backend.env").read_bytes(), b"PRIVATE_ENV_VALUE")
        self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
        self.assertEqual((destination / "files/config/backend.env").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.archive.stat().st_mode & 0o777, 0o600)

    def test_missing_required_source_fails(self):
        with self.assertRaises(FileNotFoundError):
            self.builder.add(self.root / "missing", "config/missing")

    def test_source_symlinks_rejected(self):
        (self.root / "secret").write_text("secret")
        (self.root / "link").symlink_to(self.root / "secret")
        with self.assertRaises(ValueError):
            self.builder.add(self.root / "link", "config/env")

    def test_certificate_symlink_is_scoped(self):
        (self.root / "secret").write_text("certificate")
        (self.root / "link").symlink_to(self.root / "secret")
        self.builder.add(self.root / "link", "config/tls.pem", self.root)
        with self.assertRaises(ValueError):
            self.builder.add(self.root / "link", "config/wrong.pem", self.root / "unrelated")

    def test_changed_blob_rejected(self):
        self.pack()
        self.rewrite(lambda entries: entries.__setitem__(1, (entries[1][0], b"modified")))
        with self.assertRaises(ValueError):
            migration.verify_archive(self.archive)

    def test_manifest_path_traversal_rejected(self):
        self.pack()
        def change(entries):
            manifest = json.loads(entries[0][1])
            manifest["files"]["../../escape"] = manifest["files"].pop("config/backend.env")
            entries[0] = entries[0][0], json.dumps(manifest).encode()
        self.rewrite(change)
        with self.assertRaises(ValueError):
            migration.restore_archive(self.archive, self.root / "restored")
        self.assertFalse((self.root / "restored").exists())

    def test_duplicate_archive_entry_rejected(self):
        self.pack()
        self.rewrite(lambda entries: entries.append(entries[1]))
        with self.assertRaises(ValueError):
            migration.verify_archive(self.archive)

    def test_archive_symlink_rejected(self):
        self.pack()
        def change(entries):
            entries[1][0].type = tarfile.SYMTYPE
            entries[1][0].linkname = "/etc/shadow"
        self.rewrite(change)
        with self.assertRaises(ValueError):
            migration.verify_archive(self.archive)

    def test_restore_never_overwrites_existing_directory(self):
        self.pack()
        destination = self.root / "production"
        destination.mkdir()
        (destination / "keep").write_text("keep")
        with self.assertRaises(ValueError):
            migration.restore_archive(self.archive, destination)
        self.assertEqual((destination / "keep").read_text(), "keep")

    def test_errors_do_not_disclose_private_values(self):
        self.pack()
        self.rewrite(lambda entries: entries.__setitem__(1, (entries[1][0], b"PRIVATE_ENV_VALUE_TAMPERED")))
        result = subprocess.run(["python3", SPEC.origin, "verify", str(self.archive)], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(b"PRIVATE_ENV_VALUE", result.stdout + result.stderr)

    def outer(self, entries, compressed=False):
        file = self.root / ("outer.tar.gz" if compressed else "outer.tar")
        with tarfile.open(file, "w:gz" if compressed else "w") as archive:
            for name, content, kind in entries:
                info = tarfile.TarInfo(name)
                info.type, info.mode = kind, 0o600
                info.size = len(content) if kind == tarfile.REGTYPE else 0
                info.linkname = "/etc/shadow" if kind == tarfile.SYMTYPE else ""
                archive.addfile(info, io.BytesIO(content))
        return file

    def test_outer_snapshot_round_trip(self):
        names = ["database.db.gz", "uploads.tar.gz", "migration.tar.gz", "ci-credentials.age", "manifest.json"]
        file = self.outer([(name, name.encode(), tarfile.REGTYPE) for name in names])
        target = self.root / "outer-restore"
        report = migration.unpack_archive(file, target)
        self.assertEqual(report["filesRestored"], 5)
        self.assertEqual((target / "ci-credentials.age").stat().st_mode & 0o777, 0o600)

    def test_incomplete_outer_snapshot_removed(self):
        file = self.outer([("manifest.json", b"{}", tarfile.REGTYPE)])
        target = self.root / "outer-restore"
        with self.assertRaises(ValueError):
            migration.unpack_archive(file, target)
        self.assertFalse(target.exists())

    def test_outer_snapshot_traversal_rejected(self):
        file = self.outer([("../escape", b"private", tarfile.REGTYPE)])
        with self.assertRaises(ValueError):
            migration.unpack_archive(file, self.root / "outer-restore")
        self.assertFalse((self.root / "escape").exists())

    def test_attachment_restore(self):
        file = self.outer([("uploads/", b"", tarfile.DIRTYPE), ("uploads/nested/file", b"attachment", tarfile.REGTYPE)], True)
        target = self.root / "attachments"
        report = migration.unpack_archive(file, target, uploads=True)
        self.assertEqual(report["filesRestored"], 1)
        self.assertEqual((target / "uploads/nested/file").read_bytes(), b"attachment")

    def test_attachment_symlink_rejected_and_removed(self):
        file = self.outer([("uploads/", b"", tarfile.DIRTYPE), ("uploads/link", b"", tarfile.SYMTYPE)], True)
        target = self.root / "attachments"
        with self.assertRaises(ValueError):
            migration.unpack_archive(file, target, uploads=True)
        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
