'use strict';
const Database = require('better-sqlite3');
const { applySchema, verifySchemaDrift } = require('../src/db/schema');

test('legacy duplicate push destinations are revoked, unique destinations survive and migration is idempotent', () => {
  const db = new Database(':memory:');
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
    expect(db.prepare('SELECT token FROM device_tokens').all()).toEqual([{ token: 'unique' }]);
    expect(db.prepare('SELECT endpoint FROM push_subscriptions').all()).toEqual([{ endpoint: 'unique' }]);
    expect(() => db.exec("INSERT INTO device_tokens VALUES ('b2','b','unique','android',2)")).toThrow();
    expect(() => db.exec("INSERT INTO push_subscriptions VALUES ('b2','b','unique','{}',2)")).toThrow();
    applySchema(db);
    expect(db.prepare('SELECT COUNT(*) n FROM device_tokens').get().n).toBe(1);
    expect(verifySchemaDrift(db)).toEqual([]);
  } finally { db.close(); }
});
