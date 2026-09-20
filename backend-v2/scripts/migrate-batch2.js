'use strict';
// Usage: node scripts/migrate-batch2.js /absolute/path/to/isolated.sqlite
// Does not load application config, connect external services, or backfill content.
const Database = require('better-sqlite3');
const path = require('path');
const filename = process.argv[2];
if (!filename || !path.isAbsolute(filename)) throw Error('explicit absolute database path required');
const db = new Database(filename, { fileMustExist: true });
db.pragma('foreign_keys=ON');
db.transaction(() => {
 for (const sql of require('../src/db/migrations/batch2')) {
  const col = sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/);
  if (col && db.prepare(`PRAGMA table_info(${col[1]})`).all().some(c=>c.name===col[2])) continue;
  db.exec(sql);
 }
}).immediate();
const violations = db.pragma('foreign_key_check');
if (violations.length) throw Error(`foreign_key_check: ${violations.length} violations`);
console.log('batch2 migration OK; foreign_key_check=0');
db.close();
