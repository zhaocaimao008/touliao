'use strict';
const Database = require('better-sqlite3');
const { applySchema, verifySchemaDrift } = require('../src/db/schema');

test('unbound legacy push destinations are revoked and session-bound registrations survive repeated migration', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    db.exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL, avatar TEXT DEFAULT '', cover_photo TEXT DEFAULT '', bio TEXT DEFAULT '',
      wechat_id TEXT DEFAULT '', status TEXT DEFAULT 'online', created_at INTEGER DEFAULT 1);
      INSERT INTO users(id,username,phone,password) VALUES ('a','account-a','100000001','unused'), ('b','account-b','100000002','unused');
      CREATE TABLE device_tokens (id TEXT PRIMARY KEY, user_id TEXT, token TEXT, platform TEXT, created_at INTEGER, UNIQUE(user_id,token));
      INSERT INTO device_tokens VALUES ('a1','a','duplicate','android',1), ('b1','b','duplicate','android',2), ('a2','a','unique','android',1);
      CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT, endpoint TEXT, subscription TEXT, created_at INTEGER, UNIQUE(user_id,endpoint));
      INSERT INTO push_subscriptions VALUES ('a1','a','duplicate','{}',1), ('b1','b','duplicate','{}',2), ('a2','a','unique','{}',1);`);
    applySchema(db);
    expect(db.prepare('SELECT token FROM device_tokens').all()).toEqual([]);
    expect(db.prepare('SELECT endpoint FROM push_subscriptions').all()).toEqual([]);
    db.exec("INSERT INTO auth_sessions(id,user_id) VALUES ('session-a','a');");
    db.exec("INSERT INTO device_tokens(id,user_id,token,platform,session_id) VALUES ('a2','a','unique','android','session-a');");
    db.exec("INSERT INTO push_subscriptions(id,user_id,endpoint,subscription,session_id) VALUES ('a2','a','unique','{}','session-a');");
    expect(() => db.exec("INSERT INTO device_tokens(id,user_id,token,platform) VALUES ('b2','b','unique','android')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO push_subscriptions(id,user_id,endpoint,subscription) VALUES ('b2','b','unique','{}')")).toThrow(/UNIQUE/);
    applySchema(db);
    expect(db.prepare('SELECT COUNT(*) n FROM device_tokens').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n).toBe(1);
    db.exec("DELETE FROM auth_sessions WHERE id='session-a'");
    expect(db.prepare('SELECT COUNT(*) n FROM device_tokens').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n).toBe(0);
    expect(verifySchemaDrift(db)).toEqual([]);
  } finally { db.close(); }
});
