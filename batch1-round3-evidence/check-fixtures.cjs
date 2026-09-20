'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('../backend-v2/node_modules/better-sqlite3');
const { applySchema } = require('../backend-v2/src/db/schema');
const db = new Database(':memory:');
applySchema(db);
const root = path.resolve(__dirname, '..');
const files = ['f01-proxy-handshake.test.js', 'f01-proxy-handshake.live.test.js', 'f01-proxy-handshake.live.cjs',
  'f02-file-forward-auth.test.js', 'f02-file-socket.live.test.js', 'f02-inprocess-http.cjs',
  'f03-clear-role.test.js', 'f06-financial-idempotency.test.js', 'fixtures/f06-financial-process.cjs'];
function omissions(source) {
  const missing = [];
  for (const match of source.matchAll(/INSERT(?: OR \w+)? INTO (\w+)\s*\(([^)]+)\)/g)) {
    const columns = match[2].split(',').map(column => column.trim());
    for (const column of db.prepare(`PRAGMA table_info(${match[1]})`).all()) {
      if (column.notnull && column.dflt_value === null && !columns.includes(column.name)) {
        missing.push(`${match[1]}.${column.name}`);
      }
    }
  }
  return missing;
}
const old = fs.readFileSync(path.join(__dirname, 'f02-file-socket.before.cjs'), 'utf8');
assert.deepEqual(omissions(old), ['messages.content']);
console.log('BEFORE: f02-file-socket.live.test.js missing messages.content');
for (const file of files) {
  const source = fs.readFileSync(path.join(root, 'backend-v2/test', file), 'utf8');
  assert.deepEqual(omissions(source), [], file);
  console.log(`AFTER: ${file}: no omitted NOT NULL columns without defaults`);
}
db.close();
console.log('Fixture column audit: 9 files checked; baseline defect reproduced; current omissions=0');
