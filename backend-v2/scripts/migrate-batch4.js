'use strict';
// Explicit path only. No .env or application configuration is loaded.
const path=require('path');
const Database=require('better-sqlite3');
const filename=process.argv[2];
if (!filename || !path.isAbsolute(filename)) throw new Error('Usage: node scripts/migrate-batch4.js /absolute/path/to/isolated-test.sqlite');
const db=new Database(filename,{fileMustExist:true});
db.pragma('foreign_keys=ON');
db.transaction(()=>{for(const sql of require('../src/db/migrations/batch4')) db.prepare(sql).run();})();
const foreignKeys=db.pragma('foreign_key_check');
const integrity=db.pragma('integrity_check',{simple:true});
if (foreignKeys.length || integrity!=='ok') throw new Error('migration validation failed');
console.log(JSON.stringify({migration:'batch4',integrity,foreignKeyErrors:foreignKeys.length,tables:db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('legal_consents','safety_reports','safety_report_events') ORDER BY name").all().map(r=>r.name)}));
db.close();
