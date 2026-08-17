'use strict';
/**
 * P0-PROD-SCHEMA-DRIFT 回归测试
 *
 * 根因：schema_migrations 标记 76/77/78 已 applied，但生产库 conversation_clears
 * 实际缺 cleared_rowid 列（runner 按 idx 跳过已 applied 记录，序号内容变更不重放）
 * → conversations 列表/消息历史 500 INTERNAL_ERROR。
 *
 * 覆盖（招财猫 HOTFIX 要求 A-E）：
 *   A. 旧 schema（仅 user_id/conversation_id/cleared_at）→ ensureClearWatermarkColumn 后 cleared_rowid 存在
 *   B. 已存在 cleared_rowid → 再次执行不报错、不重复添加
 *   C. 历史行存在 → hotfix 后 cleared_rowid = 0
 *   D. assertRequiredColumns：缺列时抛错（启动阶段 fail-fast）
 *   E. assertRequiredColumns：列齐全时不抛错（正常启动）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { ensureClearWatermarkColumn, assertRequiredColumns } = require('../src/db/schema');

function makeOldSchemaDb() {
  const file = path.join(os.tmpdir(), `p0-drift-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new Database(file);
  db.exec(`
    CREATE TABLE conversation_clears (
      user_id         TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      cleared_at      INTEGER NOT NULL,
      PRIMARY KEY (user_id, conversation_id)
    );
  `);
  return { db, file };
}

describe('P0-PROD-SCHEMA-DRIFT migration drift 回归', () => {
  test('A. 旧 schema（无 cleared_rowid）→ ensureClearWatermarkColumn 后 cleared_rowid 存在', () => {
    const { db, file } = makeOldSchemaDb();
    try {
      const colsBefore = db.prepare('PRAGMA table_info(conversation_clears)').all().map(c => c.name);
      expect(colsBefore).not.toContain('cleared_rowid');

      const didFix = ensureClearWatermarkColumn(db);
      expect(didFix).toBe(true);

      const colsAfter = db.prepare('PRAGMA table_info(conversation_clears)').all().map(c => c.name);
      expect(colsAfter).toContain('cleared_rowid');
      const def = db.prepare('PRAGMA table_info(conversation_clears)').all().find(c => c.name === 'cleared_rowid');
      expect(def.type).toBe('INTEGER');
      expect(def.dflt_value).toBe('0');
    } finally { db.close(); fs.unlinkSync(file); }
  });

  test('B. 已存在 cleared_rowid → 再次执行不报错、不重复添加', () => {
    const { db, file } = makeOldSchemaDb();
    try {
      db.exec('ALTER TABLE conversation_clears ADD COLUMN cleared_rowid INTEGER DEFAULT 0');
      // 幂等：第二次执行应返回 false 且不抛错
      const didFix = ensureClearWatermarkColumn(db);
      expect(didFix).toBe(false);
      const count = db.prepare('PRAGMA table_info(conversation_clears)').all()
        .filter(c => c.name === 'cleared_rowid').length;
      expect(count).toBe(1); // 不重复添加
    } finally { db.close(); fs.unlinkSync(file); }
  });

  test('C. 历史行存在 → hotfix 后 cleared_rowid = 0', () => {
    const { db, file } = makeOldSchemaDb();
    try {
      db.prepare(
        'INSERT INTO conversation_clears (user_id, conversation_id, cleared_at) VALUES (?,?,?)'
      ).run('u1', 'c1', 1000);
      db.prepare(
        'INSERT INTO conversation_clears (user_id, conversation_id, cleared_at) VALUES (?,?,?)'
      ).run('u2', 'c2', 2000);

      ensureClearWatermarkColumn(db);

      const rows = db.prepare('SELECT user_id, cleared_rowid FROM conversation_clears ORDER BY user_id').all();
      expect(rows).toEqual([
        { user_id: 'u1', cleared_rowid: 0 },
        { user_id: 'u2', cleared_rowid: 0 },
      ]);
    } finally { db.close(); fs.unlinkSync(file); }
  });

  test('D. assertRequiredColumns：缺列时抛错（启动 fail-fast）', () => {
    const { db, file } = makeOldSchemaDb();
    try {
      expect(() => assertRequiredColumns(db)).toThrow(/Schema drift detected/);
    } finally { db.close(); fs.unlinkSync(file); }
  });

  test('E. assertRequiredColumns：列齐全时不抛错（正常启动）', () => {
    const { db, file } = makeOldSchemaDb();
    try {
      ensureClearWatermarkColumn(db);
      expect(() => assertRequiredColumns(db)).not.toThrow();
    } finally { db.close(); fs.unlinkSync(file); }
  });
});
