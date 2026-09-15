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
    const hashes = {};
    for (const name of ['database.db.gz', 'uploads.tar.gz']) hashes[name] = await digest(path.join(dir, name));
    execFileSync('tar', ['-tzf', path.join(dir, 'uploads.tar.gz')], { stdio: 'ignore' });
    const report = { format: 1, tables, hashes };
    const file = path.join(dir, 'manifest.json');
    if (mode === 'create') fs.writeFileSync(file, JSON.stringify(report), { mode: 0o600 });
    else assert.deepEqual(report, JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log(JSON.stringify({ mode, integrity: 'ok', foreignKeyErrors: 0, tablesVerified: Object.keys(tables).length, archivesVerified: 2 }));
  } finally { fs.rmSync(db, { force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
