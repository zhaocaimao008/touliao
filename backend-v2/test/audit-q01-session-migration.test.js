'use strict';
const Database = require('better-sqlite3');
const { applySchema, verifySchemaDrift } = require('../src/db/schema');

// Synthetic pre-upgrade contract: two clients historically shared this one UA session.
function legacyDatabase() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, avatar TEXT DEFAULT '', cover_photo TEXT DEFAULT '', bio TEXT DEFAULT '',
    wechat_id TEXT DEFAULT '', status TEXT DEFAULT 'online', created_at INTEGER DEFAULT 1);
    INSERT INTO users(id,username,phone,password) VALUES ('owner','synthetic-owner','100000001','synthetic-unused-hash');
    CREATE TABLE user_sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device TEXT, platform TEXT, ip TEXT,
    created_at INTEGER, last_seen INTEGER, UNIQUE(user_id,device,platform));
    INSERT INTO user_sessions VALUES ('legacy-shared','owner','Android 手机','Android','127.0.0.1',1,2);
    CREATE TABLE device_accounts (
      wallet_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER, last_used INTEGER,
      PRIMARY KEY(wallet_id,user_id));
    INSERT INTO device_accounts VALUES ('legacy-wallet-a','owner',1,2);
    INSERT INTO device_accounts VALUES ('legacy-wallet-b','owner',1,2);`);
  return db;
}

test('migration preserves historical sessions as one revocation unit and never guesses wallet ownership', () => {
  const db = legacyDatabase();
  try {
    applySchema(db);
    expect(db.prepare('SELECT id FROM auth_sessions').all()).toEqual([{ id: 'legacy-shared' }]);
    expect(db.prepare('SELECT session_id FROM device_accounts').all()).toEqual([{ session_id: null }, { session_id: null }]);
    db.prepare('INSERT INTO auth_sessions(id,user_id,device,platform) VALUES (?,?,?,?)').run('new-independent', 'owner', 'Android 手机', 'Android');
    expect(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n).toBe(2);
    db.prepare('DELETE FROM auth_sessions WHERE id=?').run('legacy-shared');
    applySchema(db);
    expect(db.prepare('SELECT id FROM auth_sessions').all()).toEqual([{ id: 'new-independent' }]);
    expect(db.prepare("SELECT tbl_name FROM sqlite_master WHERE name='idx_auth_sessions_user'").get().tbl_name).toBe('auth_sessions');
    expect(verifySchemaDrift(db)).toEqual([]);
  } finally { db.close(); }
});

test('an interrupted additive migration rolls back its new authority and resumes without losing legacy rows', () => {
  const db = legacyDatabase();
  const prepare = db.prepare.bind(db);
  const fault = jest.spyOn(db, 'prepare').mockImplementation(sql => {
    if (sql.includes('INSERT OR IGNORE INTO auth_sessions')) throw new Error('q01 injected disk failure');
    return prepare(sql);
  });
  const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(() => applySchema(db)).toThrow('q01 injected disk failure');
    expect(prepare("SELECT 1 FROM sqlite_master WHERE name='auth_sessions'").get()).toBeUndefined();
    expect(prepare('SELECT id FROM user_sessions').all()).toEqual([{ id: 'legacy-shared' }]);
    fault.mockRestore();
    applySchema(db);
    expect(prepare('SELECT id FROM auth_sessions').all()).toEqual([{ id: 'legacy-shared' }]);
    applySchema(db);
    expect(prepare('SELECT COUNT(*) n FROM auth_sessions').get().n).toBe(1);
  } finally { fault.mockRestore(); silence.mockRestore(); db.close(); }
});
