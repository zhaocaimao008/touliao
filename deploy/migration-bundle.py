#!/usr/bin/env python3
"""Project-scoped, content-addressed migration snapshots; restore only to a new directory."""
import hashlib
import base64
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time

MAX_BYTES = 20 * 1024**3


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_path(value):
    require(isinstance(value, str) and value and "\\" not in value and "\x00" not in value, "Unsafe snapshot path")
    p = PurePosixPath(value)
    require(not p.is_absolute() and all(part not in (".", "..") for part in p.parts) and str(p) == value, "Unsafe snapshot path")
    return value


def sha(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def run(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    require(result.returncode == 0, "Required snapshot command failed: " + Path(args[0]).name)
    return result.stdout


class Builder:
    def __init__(self, temporary):
        self.temporary = Path(temporary)
        self.blobs = self.temporary / "blobs"
        self.blobs.mkdir(mode=0o700)
        self.files = {}

    def add(self, source, destination, dereference_within=None):
        source = Path(source)
        if source.is_symlink():
            require(dereference_within is not None, "Symlink source is not permitted")
            resolved = source.resolve(strict=True)
            require(resolved.is_relative_to(Path(dereference_within).resolve()), "Symlink escapes permitted certificate directory")
            source = resolved
        before = source.stat(follow_symlinks=False)
        require(stat.S_ISREG(before.st_mode), "Snapshot source must be a regular file")
        require(before.st_size <= MAX_BYTES, "Snapshot source too large")
        with source.open("rb") as stream:
            self.add_stream(stream, destination, before.st_mode & 0o777, str(source))
        after = source.stat(follow_symlinks=False)
        require((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "Source changed during snapshot")

    def add_stream(self, stream, destination, mode=0o600, source=None):
        safe_path(destination)
        require(destination not in self.files, "Duplicate snapshot destination")
        digest = hashlib.sha256()
        size = 0
        temporary = self.temporary / "current-blob"
        with temporary.open("xb") as output:
            os.chmod(temporary, 0o600)
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                size += len(chunk)
                require(size <= MAX_BYTES, "Snapshot source too large")
                digest.update(chunk)
                output.write(chunk)
        value = digest.hexdigest()
        target = self.blobs / value
        if target.exists():
            temporary.unlink()
        else:
            temporary.rename(target)
        self.files[destination] = {"sha256": value, "size": size, "mode": mode, "source": source}

    def add_json(self, value, destination):
        self.add_stream(io.BytesIO(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()), destination)

    def tree(self, source, destination):
        source = Path(source)
        require(source.is_dir() and not source.is_symlink(), "Required snapshot directory missing or linked")
        for parent, dirs, files in os.walk(source, followlinks=False):
            for name in dirs:
                require(not (Path(parent) / name).is_symlink(), "Directory symlink is not permitted")
            for name in sorted(files):
                file = Path(parent) / name
                self.add(file, str(PurePosixPath(destination) / file.relative_to(source).as_posix()))

    def pack(self, output, metadata):
        require(not Path(output).exists(), "Snapshot output already exists")
        manifest = {"format": 1, "createdAt": int(time.time()), "metadata": metadata, "files": self.files}
        with open(output, "xb") as raw:
            os.chmod(output, 0o600)
            with tarfile.open(fileobj=raw, mode="w:gz", compresslevel=1) as archive:
                data = json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode()
                entry = tarfile.TarInfo("manifest.json")
                entry.size, entry.mode = len(data), 0o600
                archive.addfile(entry, io.BytesIO(data))
                for blob in sorted(self.blobs.iterdir()):
                    info = tarfile.TarInfo("blobs/" + blob.name)
                    info.size, info.mode = blob.stat().st_size, 0o600
                    with blob.open("rb") as stream:
                        archive.addfile(info, stream)
        return manifest


def verify_archive(archive_path):
    with tarfile.open(archive_path, "r|gz") as archive:
        seen, total, manifest = {}, 0, None
        for member in archive:
            require(len(seen) < 100001, "Too many archive entries")
            safe_path(member.name)
            require(member.isfile() and member.name not in seen, "Linked, special or duplicate archive member")
            require(member.name == "manifest.json" or re.fullmatch(r"blobs/[0-9a-f]{64}", member.name), "Unexpected archive member")
            require(member.mode == 0o600 and 0 <= member.size <= MAX_BYTES, "Unsafe archive member metadata")
            total += member.size
            require(total <= MAX_BYTES, "Archive size limit exceeded")
            seen[member.name] = member.size
            if member.name == "manifest.json":
                require(member.size < 32 * 1024**2, "Manifest too large")
                manifest = json.load(archive.extractfile(member))
            else:
                require(sha(archive.extractfile(member)) == member.name.removeprefix("blobs/"), "Snapshot content digest mismatch")
        require(isinstance(manifest, dict), "Missing snapshot manifest")
        require(manifest.get("format") == 1 and isinstance(manifest.get("files"), dict), "Invalid snapshot manifest")
        require(len(manifest["files"]) <= 100000, "Too many restored files")
        needed = {"manifest.json"}
        restored_bytes = 0
        for destination, record in manifest["files"].items():
            safe_path(destination)
            require(re.fullmatch(r"[0-9a-f]{64}", record["sha256"]) and isinstance(record["mode"], int) and 0 <= record["mode"] <= 0o777, "Invalid file metadata")
            name = "blobs/" + record["sha256"]
            require(name in seen and seen[name] == record["size"], "Snapshot size mismatch")
            restored_bytes += record["size"]
            require(restored_bytes <= MAX_BYTES, "Restored size limit exceeded")
            needed.add(name)
        require(set(seen) == needed, "Unexpected or missing snapshot data")
        return manifest


def restore_archive(archive_path, destination):
    manifest = verify_archive(archive_path)
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), "Restore target must not exist")
    destination.mkdir(mode=0o700)
    try:
        destinations = {}
        for name, record in manifest["files"].items():
            destinations.setdefault("blobs/" + record["sha256"], []).append((destination / "files" / name, record))
        # Keep gzip reads sequential. Identical release aliases share a stored blob.
        restored = set()
        with tarfile.open(archive_path, "r|gz") as archive:
            for member in archive:
                if member.name == "manifest.json":
                    continue
                require(member.isfile() and member.name in destinations and member.name not in restored, "Snapshot changed during restore")
                targets = destinations[member.name]
                first = targets[0][0]
                first.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with first.open("xb") as output:
                    shutil.copyfileobj(archive.extractfile(member), output)
                for target, record in targets:
                    if target != first:
                        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                        with first.open("rb") as source, target.open("xb") as output:
                            shutil.copyfileobj(source, output)
                    os.chmod(target, record["mode"])
                    with target.open("rb") as stream:
                        require(target.stat().st_size == record["size"] and sha(stream) == record["sha256"], "Restored file digest mismatch")
                restored.add(member.name)
        require(restored == set(destinations), "Snapshot changed during restore")
        with (destination / "manifest.json").open("x") as output:
            json.dump(manifest, output, ensure_ascii=False, sort_keys=True)
        os.chmod(destination / "manifest.json", 0o600)
    except BaseException:
        shutil.rmtree(destination)
        raise
    return manifest


def unpack_archive(archive_path, destination, uploads=False):
    """Extract only bounded regular files, never tar links or arbitrary outer paths."""
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), "Restore target must not exist")
    allowed = {"database.db.gz", "uploads.tar.gz", "migration.tar.gz", "ci-credentials.age", "manifest.json"}
    destination.mkdir(mode=0o700)
    seen, total, count = set(), 0, 0
    try:
        with tarfile.open(archive_path, "r|gz" if uploads else "r|") as archive:
            for member in archive:
                name = safe_path(member.name.rstrip("/") if member.isdir() else member.name)
                require(name not in seen and len(seen) < 100000, "Duplicate or excessive archive entries")
                seen.add(name)
                if uploads:
                    require(name == "uploads" or name.startswith("uploads/"), "Unexpected attachment path")
                    require(member.isfile() or member.isdir(), "Linked or special attachment")
                else:
                    require(name in allowed and member.isfile(), "Unexpected outer snapshot member")
                require(0 <= member.size <= MAX_BYTES, "Unsafe archive size")
                total += member.size
                require(total <= MAX_BYTES, "Archive size limit exceeded")
                target = destination / name
                if member.isdir():
                    target.mkdir(mode=0o700, parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    with target.open("xb") as output:
                        os.chmod(target, 0o600)
                        shutil.copyfileobj(archive.extractfile(member), output)
                    require(target.stat().st_size == member.size, "Truncated archive member")
                    count += 1
        require(("uploads" in seen) if uploads else seen == allowed, "Incomplete snapshot")
    except BaseException:
        shutil.rmtree(destination)
        raise
    return {"mode": "restore-uploads" if uploads else "unpack", "filesRestored": count, "bytesRestored": total}


def collect(policy_file, output):
    policy = json.loads(Path(policy_file).read_text())
    repo = Path(policy["repository"])
    git = ["git", "-c", "safe.directory=" + str(repo), "-C", str(repo)]
    initial_commit = run(git + ["rev-parse", "HEAD"]).decode().strip()
    status_before = run(git + ["status", "--porcelain", "-z"])
    with tempfile.TemporaryDirectory(prefix="touliao-migration-", dir=Path(output).parent) as temporary:
        builder = Builder(temporary)
        for entry in policy["sources"]:
            if entry.get("tree"):
                builder.tree(entry["source"], entry["destination"])
            else:
                builder.add(entry["source"], entry["destination"], entry.get("dereferenceWithin"))
        deleted = set(run(git + ["ls-files", "--deleted", "-z"]).split(b"\0"))
        for name in run(git + ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split(b"\0"):
            if name and name not in deleted:
                relative = os.fsdecode(name)
                builder.add(repo / safe_path(relative), "app/" + relative)
        app_require = str(repo / "backend-v2" / "package.json")
        def app_json(script, *args):
            code = "const r=require('node:module').createRequire(process.argv[1]);" + script
            return json.loads(run(["node", "-e", code, app_require, *map(str, args)]))
        environment = app_json("console.log(JSON.stringify(r('dotenv').parse(require('fs').readFileSync(process.argv[2]))))", policy["environment"])
        pm2 = json.loads(run(["sudo", "-u", policy["processUser"], "env", "PM2_HOME=" + policy["processHome"], "/usr/bin/pm2", "jlist"]))
        processes = [p for p in pm2 if p["name"] == "touliao-backend"]
        require(len(processes) == 1 and processes[0]["pm2_env"]["status"] == "online", "Production process not healthy")
        process = processes[0]["pm2_env"]
        env_keys = set(environment) | {"NODE_ENV", "PORT", "NODE_OPTIONS", "TRACING_ENABLED", "DB_PATH", "UPLOADS_ROOT", "REDIS_URL"}
        process_config = {key: process.get(key) for key in ["name", "pm_cwd", "pm_exec_path", "exec_interpreter", "node_args", "exec_mode", "instances", "max_memory_restart", "kill_timeout", "restart_delay"]}
        process_config["env"] = {key: process[key] for key in env_keys if key in process}
        builder.add_json(process_config, "runtime/process.json")
        downloads = Path(policy["downloads"])
        feed = app_json("console.log(JSON.stringify(r('js-yaml').load(require('fs').readFileSync(process.argv[2],'utf8'),{schema:r('js-yaml').JSON_SCHEMA})))", downloads / "updates/latest.yml")
        installer = feed["path"]
        require(re.fullmatch(r"touliao-[0-9.]+-setup\.exe", installer), "Unsafe Windows release filename")
        for name in ["latest.yml", "latest.yml.sig", installer, installer + ".blockmap"]:
            builder.add(downloads / "updates" / name, "public/downloads/updates/" + name)
        for name in ["touliao-android-latest.apk", "touliao-android-version.json", "touliao-windows-latest.exe", "touliao-windows-latest-setup.exe"]:
            builder.add(downloads / name, "public/downloads/" + name)
        def captured(name):
            return builder.blobs / builder.files[name]["sha256"]
        captured_feed = app_json("console.log(JSON.stringify(r('js-yaml').load(require('fs').readFileSync(process.argv[2],'utf8'),{schema:r('js-yaml').JSON_SCHEMA})))", captured("public/downloads/updates/latest.yml"))
        require(captured_feed == feed, "Update feed changed during snapshot")
        windows_digest = hashlib.sha512()
        with captured("public/downloads/updates/" + installer).open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                windows_digest.update(chunk)
        require(base64.b64encode(windows_digest.digest()).decode() == feed["sha512"], "Windows update digest mismatch")
        android = json.loads(captured("public/downloads/touliao-android-version.json").read_text())
        require(android["sha256"] == builder.files["public/downloads/touliao-android-latest.apk"]["sha256"], "Android publication mismatch")
        for alias in ["touliao-windows-latest.exe", "touliao-windows-latest-setup.exe"]:
            require(builder.files["public/downloads/" + alias]["sha256"] == builder.files["public/downloads/updates/" + installer]["sha256"], "Windows publication mismatch")
        app_json("const fs=require('fs'),c=require('crypto');if(!c.verify(null,fs.readFileSync(process.argv[2]),fs.readFileSync(process.argv[4]),fs.readFileSync(process.argv[3])))process.exit(1);console.log('{}')", captured("public/downloads/updates/latest.yml"), captured("public/downloads/updates/latest.yml.sig"), captured("app/desktop-electron/src/update-public-key.pem"))
        escrow = Path(policy["credentialEscrow"])
        require(escrow.is_file() and not escrow.is_symlink() and time.time() - escrow.stat().st_mtime < 48 * 3600, "Credential escrow missing or stale")
        with escrow.open("rb") as stream:
            require(stream.read(22).startswith(b"age-encryption.org/v1"), "Credential escrow is not age ciphertext")
        require(run(git + ["rev-parse", "HEAD"]).decode().strip() == initial_commit and run(git + ["status", "--porcelain", "-z"]) == status_before, "Repository changed during snapshot")
        metadata = {"sourceCommit": initial_commit, "workingTreeDirty": bool(status_before), "repository": str(repo), "nodeVersion": run(["node", "--version"]).decode().strip(), "currentWindowsVersion": feed["version"], "currentAndroidVersion": android["versionName"], "credentialEscrowAgeSeconds": round(time.time() - escrow.stat().st_mtime), "historicalInstallersIncluded": False, "recoveryIdentityIncluded": False}
        return builder.pack(output, metadata)


def main():
    os.umask(0o077)
    mode, *args = sys.argv[1:]
    if mode == "collect" and len(args) == 2:
        manifest = collect(*args)
    elif mode == "verify" and len(args) == 1:
        manifest = verify_archive(*args)
    elif mode == "restore" and len(args) == 2:
        manifest = restore_archive(*args)
    elif mode in ("unpack", "restore-uploads") and len(args) == 2:
        print(json.dumps(unpack_archive(*args, uploads=mode == "restore-uploads")))
        return
    else:
        raise ValueError("Usage: migration-bundle.py collect POLICY OUTPUT | verify ARCHIVE | restore ARCHIVE NEW_DIRECTORY")
    print(json.dumps({"mode": mode, "filesVerified": len(manifest["files"]), "uniqueBlobs": len({r["sha256"] for r in manifest["files"].values()}), "sourceCommit": manifest.get("metadata", {}).get("sourceCommit")}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Migration snapshot failed: " + type(error).__name__ + ". Sensitive values are omitted.", file=sys.stderr)
        sys.exit(1)
