'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { execFileSync } = require('node:child_process');
const [mode, dir] = process.argv.slice(2);
assert.ok(['create', 'verify'].includes(mode) && path.isAbsolute(dir));
const query = (db, sql) => JSON.parse(execFileSync('sqlite3', ['-json', db, sql], { encoding: 'utf8' }) || '[]');
async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
(async () => {
  const db = path.join(dir, 'restore.db');
  try {
    await pipeline(fs.createReadStream(path.join(dir, 'database.db.gz')), zlib.createGunzip(), fs.createWriteStream(db, { mode: 0o600 }));
    assert.deepEqual(query(db, 'PRAGMA integrity_check;'), [{ integrity_check: 'ok' }]);
    assert.deepEqual(query(db, 'PRAGMA foreign_key_check;'), []);
    const tables = {};
    for (const { name } of query(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
      tables[name] = query(db, `SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`)[0].count;
    }
    const file = path.join(dir, 'manifest.json');
    const expected = mode === 'verify' ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const format = expected?.format || (fs.existsSync(path.join(dir, 'migration.tar.gz')) ? 2 : 1);
    assert.ok([1, 2].includes(format), 'Unsupported backup format');
    const archives = ['database.db.gz', 'uploads.tar.gz'];
    if (format === 2) archives.push('migration.tar.gz', 'ci-credentials.age');
    const hashes = {};
    for (const name of archives) hashes[name] = await digest(path.join(dir, name));
    execFileSync('tar', ['-tzf', path.join(dir, 'uploads.tar.gz')], { stdio: 'ignore' });
    let migration;
    if (format === 2) {
      migration = JSON.parse(execFileSync('python3', [path.join(__dirname, 'migration-bundle.py'), 'verify', path.join(dir, 'migration.tar.gz')], { encoding: 'utf8' }));
      assert.ok(fs.readFileSync(path.join(dir, 'ci-credentials.age')).subarray(0, 22).toString().startsWith('age-encryption.org/v1'));
    }
    const report = { format, tables, hashes };
    if (mode === 'create') fs.writeFileSync(file, JSON.stringify(report), { mode: 0o600 });
    else assert.deepEqual(report, expected);
    console.log(JSON.stringify({ mode, format, integrity: 'ok', foreignKeyErrors: 0, tablesVerified: Object.keys(tables).length, archivesVerified: archives.length, ...(migration ? { migrationFilesVerified: migration.filesVerified } : {}) }));
  } finally { fs.rmSync(db, { force: true }); }
})().catch(() => { console.error('Backup verification failed; private manifest details are omitted.'); process.exitCode = 1; });
