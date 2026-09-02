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
 *   D. verifySchemaDrift：缺列时返回清单（2026-09-02 起不再 throw —— 降级为
 *      打日志 + /health 503，由 deploy 健康检查拦截，避免非变更重启打死服务）
 *   E. verifySchemaDrift：补齐后清单不再含该对象
 *   F. verifySchemaDrift：完整 schema（applySchema 全量）→ 空清单（全量核对主路径）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { applySchema, ensureClearWatermarkColumn, verifySchemaDrift } = require('../src/db/schema');

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

  test('D. verifySchemaDrift：缺列时返回清单（不 throw；降级由调用方/health 503 决策）', () => {
    const { db, file } = makeOldSchemaDb();
    try {
      const drift = verifySchemaDrift(db);
      const hit = drift.some(d => d.type === 'column' && d.obj === 'conversation_clears.cleared_rowid');
      expect(hit).toBe(true);   // 缺 cleared_rowid 必须被检出
    } finally { db.close(); fs.unlinkSync(file); }
  });

  test('E. verifySchemaDrift：补齐后清单不再含 cleared_rowid', () => {
    const { db, file } = makeOldSchemaDb();
    try {
      ensureClearWatermarkColumn(db);
      const drift = verifySchemaDrift(db);
      expect(drift.some(d => d.obj === 'conversation_clears.cleared_rowid')).toBe(false);
    } finally { db.close(); fs.unlinkSync(file); }
  });

  test('F. verifySchemaDrift：完整 schema（applySchema 全量 133 迁移）→ 空清单', () => {
    const file = path.join(os.tmpdir(), `p0-drift-full-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    const db = new Database(file);
    try {
      applySchema(db);
      expect(verifySchemaDrift(db)).toEqual([]);
    } finally { db.close(); fs.unlinkSync(file); }
  });
});
