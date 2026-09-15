'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gunzipSync } = require('node:zlib');
const script = path.resolve(__dirname, '../deploy/touliao-backup.sh');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-backup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backend = path.join(root, 'backend-v2');
  const uploads = path.join(backend, 'uploads');
  const backups = path.join(root, 'backups');
  fs.mkdirSync(uploads, { recursive: true });
  fs.writeFileSync(path.join(uploads, 'attachment.txt'), 'private attachment');
  const db = path.join(backend, 'wechat.db');
  assert.equal(spawnSync('sqlite3', [db, "CREATE TABLE users(id TEXT); INSERT INTO users VALUES ('owner');"]).status, 0);
  return { root, backups, uploads, env: { ...process.env, TOULIAO_ROOT: root, BACKUP_DIR: backups, DB_PATH: db, UPLOADS_ROOT: uploads, ALERT_BOT_TOKEN: '', ALERT_CHAT_ID: '' } };
}

test('snapshot restores database and uploaded bytes with private permissions', t => {
  const f = fixture(t);
  const res = spawnSync('bash', [script], { env: f.env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const names = fs.readdirSync(f.backups);
  const db = names.find(name => name.endsWith('.db.gz'));
  const archive = names.find(name => name.endsWith('.tar.gz'));
  assert.ok(db && archive);
  const restored = path.join(f.root, 'restored.db');
  fs.writeFileSync(restored, gunzipSync(fs.readFileSync(path.join(f.backups, db))));
  assert.equal(spawnSync('sqlite3', [restored, 'PRAGMA integrity_check; SELECT id FROM users;'], { encoding: 'utf8' }).stdout, 'ok\nowner\n');
  const bytes = spawnSync('tar', ['-xzOf', path.join(f.backups, archive), 'uploads/attachment.txt'], { encoding: 'utf8' });
  assert.equal(bytes.status, 0);
  assert.equal(bytes.stdout, 'private attachment');
  for (const file of [db, archive]) assert.equal(fs.statSync(path.join(f.backups, file)).mode & 0o077, 0);
});

test('failed upload archive is not reported or published as a successful backup', t => {
  const f = fixture(t);
  const bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'tar'), '#!/bin/sh\nexit 2\n', { mode: 0o700 });
  const res = spawnSync('bash', [script], { env: { ...f.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
  assert.notEqual(res.status, 0, res.stdout + res.stderr);
  assert.equal(fs.readdirSync(f.backups).filter(name => /\.(gz|db)$/.test(name)).length, 0);
});

test('configured but missing uploads directory fails the backup', t => {
  const f = fixture(t);
  fs.rmSync(f.uploads, { recursive: true });
  const res = spawnSync('bash', [script], { env: f.env, encoding: 'utf8' });
  assert.notEqual(res.status, 0, res.stdout + res.stderr);
});
