'use strict';
/**
 * messages_fts 按 messages.rowid 对齐（2026-10-11）。
 *
 * 修复前：FTS 行 rowid 由 FTS5 自增分配，触发器 `DELETE FROM messages_fts WHERE message_id = OLD.id`；
 *   message_id 是 UNINDEXED 列，每条撤回/编辑/焚毁、clearConversation 命中的每一行都全表扫描
 *   messages_fts（N 行清空 = N 次全扫，主线程事务内卡死事件循环）。
 * 修复后：FTS rowid = messages.rowid，触发器按 rowid 点查删除；applyFts 启动时识别旧布局，
 *   在一个 IMMEDIATE 事务里一次性重建（失败整体回滚、重复启动不再重建、回滚到旧代码后再升级
 *   会再次重建），读路径仍按 message_id 连接不变。
 */
const Database = require('better-sqlite3');
const { applySchema, applyFts } = require('../src/db/schema');

// 修复前生产库的 FTS 触发器（逐字取自旧版 schema.js applyFts）
const LEGACY_TRIGGERS = `
  DROP TRIGGER IF EXISTS fts_messages_insert;
  DROP TRIGGER IF EXISTS fts_messages_delete;
  DROP TRIGGER IF EXISTS fts_messages_edit;

  CREATE TRIGGER fts_messages_insert
  AFTER INSERT ON messages WHEN NEW.type='text' AND NEW.deleted=0
  BEGIN
    INSERT INTO messages_fts(message_id, conversation_id, content)
    VALUES (NEW.id, NEW.conversation_id, NEW.content);
  END;

  CREATE TRIGGER fts_messages_delete
  AFTER UPDATE OF deleted ON messages WHEN NEW.deleted != 0
  BEGIN
    DELETE FROM messages_fts WHERE message_id = OLD.id;
  END;

  CREATE TRIGGER fts_messages_edit
  AFTER UPDATE OF content ON messages WHEN NEW.type='text' AND NEW.deleted=0
  BEGIN
    DELETE FROM messages_fts WHERE message_id = OLD.id;
    INSERT INTO messages_fts(message_id, conversation_id, content)
    VALUES (NEW.id, NEW.conversation_id, NEW.content);
  END;
`;

// 与各 service 完全相同的写 SQL
const RECALL_SQL = "UPDATE messages SET deleted=2, content='', file_url='' WHERE id=?";           // messages.service recall
const EDIT_SQL = 'UPDATE messages SET content=?, edited=1 WHERE id=?';                               // messages.service edit
const CLEAR_SQL = "UPDATE messages SET deleted=2, content='', file_url='', transcript=NULL WHERE conversation_id=? AND rowid<=? AND deleted=0"; // clearConversation
const INSERT_SQL = 'INSERT INTO messages (id,conversation_id,sender_id,type,content) VALUES (?,?,?,?,?)';

// Synthetic pre-upgrade contract：完整 schema + 旧版 FTS 表/触发器，在旧触发器下写入历史消息。
function legacyDatabase() {
  const db = new Database(':memory:');
  applySchema(db);
  db.exec(`INSERT INTO users(id,username,phone,password) VALUES ('fts-u','synthetic-fts','100000009','synthetic-unused-hash');
    INSERT INTO conversations(id,type) VALUES ('fts-c1','group'), ('fts-c2','group');
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      message_id      UNINDEXED,
      conversation_id UNINDEXED,
      content,
      tokenize        = 'trigram'
    );`);
  db.exec(LEGACY_TRIGGERS);
  const insert = db.prepare(INSERT_SQL);
  db.transaction(() => {
    for (let i = 0; i < 300; i++) {
      // 每 3 条夹 1 条图片：图片不进 FTS，自增的 FTS rowid 从此与 messages.rowid 错开（真实库即如此）
      insert.run(`m${i}`, i % 2 ? 'fts-c1' : 'fts-c2', 'fts-u', i % 3 === 0 ? 'image' : 'text', `第${i}条 tok#${i}# 消息`);
    }
  })();
  // 旧触发器下也发生过撤回与编辑
  db.prepare(RECALL_SQL).run('m1');
  db.prepare(EDIT_SQL).run('旧版编辑 tok#edited-legacy#', 'm2');
  return db;
}

// 与 messages.service searchInConversation 相同的 FTS 连接方式（按 message_id 连接）
const search = (db, convId, term) => db.prepare(`
  SELECT m.id FROM messages_fts
  JOIN messages m ON m.id = messages_fts.message_id AND m.deleted = 0 AND m.burn_after = 0
  WHERE messages_fts MATCH ? AND messages_fts.conversation_id = ?
  ORDER BY m.rowid`).pluck().all(`"${term}"`, convId);
const ftsContent = db => db.prepare('SELECT message_id, conversation_id, content FROM messages_fts ORDER BY message_id').all();
const ftsRowids = db => db.prepare('SELECT rowid FROM messages_fts ORDER BY rowid').pluck().all();
const rowsFor = (db, id) => db.prepare('SELECT COUNT(*) FROM messages_fts WHERE message_id=?').pluck().get(id);
const rowsIn = (db, convId) => db.prepare('SELECT COUNT(*) FROM messages_fts WHERE conversation_id=?').pluck().get(convId);
// FTS 行的 rowid 与同 rowid 的 messages 行不是同一条消息的数量（对齐后应为 0）
const misaligned = db => db.prepare(`SELECT COUNT(*) FROM messages_fts f
  LEFT JOIN messages m ON m.rowid = f.rowid WHERE m.id IS NOT f.message_id`).pluck().get();
const triggerSql = db => Object.fromEntries(db.prepare(
  "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'fts_messages_%'").all().map(r => [r.name, r.sql]));
const plan = (db, sql, ...args) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args).map(r => r.detail).join('; ');

afterEach(() => { jest.restoreAllMocks(); });

test('旧布局升级：一次性按 messages.rowid 重建，保留全部可搜索内容，重复启动不再重建', () => {
  const db = legacyDatabase();
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect(misaligned(db)).toBeGreaterThan(0); // 旧布局：FTS rowid 与 messages.rowid 无关
    const before = ftsContent(db);
    expect(before).toHaveLength(199);          // 200 条文本 − 1 条撤回

    applyFts(db);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('（legacy）'));
    expect(ftsContent(db)).toEqual(before);    // 可搜索内容原样保留
    expect(misaligned(db)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM messages_fts f JOIN messages m ON m.rowid = f.rowid AND m.id = f.message_id')
      .pluck().get()).toBe(before.length);
    expect(search(db, 'fts-c1', 'tok#7#')).toEqual(['m7']);
    expect(search(db, 'fts-c2', 'tok#edited-legacy#')).toEqual(['m2']);
    expect(search(db, 'fts-c1', 'tok#1#')).toEqual([]); // 升级前已撤回的仍不可搜
    const triggers = triggerSql(db);
    expect(triggers.fts_messages_delete).toContain('rowid = OLD.rowid');
    expect(triggers.fts_messages_edit).toContain('rowid = OLD.rowid');
    expect(triggers.fts_messages_insert).toContain('NEW.rowid');
    expect(Object.values(triggers).join('\n')).not.toContain('message_id = OLD.id');

    // 幂等：再启动两次，不再 DROP/重建，rowid 与内容都不变
    const rowids = ftsRowids(db);
    log.mockClear();
    const exec = jest.spyOn(db, 'exec');
    applyFts(db);
    applyFts(db);
    expect(exec.mock.calls.some(([sql]) => /DROP TABLE/i.test(sql))).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(ftsRowids(db)).toEqual(rowids);
    expect(ftsContent(db)).toEqual(before);
  } finally { db.close(); }
});

test('迁移后撤回/编辑/清空按 rowid 维护索引；触发器式删除是 rowid 点查而非全表扫描', () => {
  const db = legacyDatabase();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    applyFts(db);
    db.prepare(INSERT_SQL).run('fresh', 'fts-c1', 'fts-u', 'text', '新消息 tok#fresh-before#');
    expect(search(db, 'fts-c1', 'tok#fresh-before#')).toEqual(['fresh']);
    expect(misaligned(db)).toBe(0);

    // 编辑：旧正文不可搜、新正文可搜，且只有一行
    db.prepare(EDIT_SQL).run('改过 tok#fresh-after#', 'fresh');
    expect(search(db, 'fts-c1', 'tok#fresh-before#')).toEqual([]);
    expect(search(db, 'fts-c1', 'tok#fresh-after#')).toEqual(['fresh']);
    expect(rowsFor(db, 'fresh')).toBe(1);

    // 撤回：索引行被删
    db.prepare(RECALL_SQL).run('fresh');
    expect(search(db, 'fts-c1', 'tok#fresh-after#')).toEqual([]);
    expect(rowsFor(db, 'fresh')).toBe(0);

    // 清空（全员）：fts-c1 全部出索引，fts-c2 不受影响
    const c2Before = rowsIn(db, 'fts-c2');
    expect(rowsIn(db, 'fts-c1')).toBeGreaterThan(0);
    const maxRowid = db.prepare('SELECT COALESCE(MAX(rowid), 0) FROM messages WHERE conversation_id=?').pluck().get('fts-c1');
    db.prepare(CLEAR_SQL).run('fts-c1', maxRowid);
    expect(rowsIn(db, 'fts-c1')).toBe(0);
    expect(search(db, 'fts-c1', 'tok#7#')).toEqual([]);
    expect(rowsIn(db, 'fts-c2')).toBe(c2Before);
    expect(search(db, 'fts-c2', 'tok#8#')).toEqual(['m8']);
    expect(misaligned(db)).toBe(0);

    // 查询计划：虚拟表的计划总是写作 "SCAN … VIRTUAL TABLE INDEX n:idxStr"，区别在 idxNum/idxStr。
    // 旧触发器的 message_id 等值删除与无条件全表扫描计划完全相同；rowid 删除带上了 rowid 约束。
    const fullScan = plan(db, 'SELECT rowid FROM messages_fts');
    expect(plan(db, 'DELETE FROM messages_fts WHERE message_id = ?', 'probe')).toBe(fullScan);
    const byRowid = plan(db, 'DELETE FROM messages_fts WHERE rowid = ?', 1);
    console.info('FTS_DELETE_PLAN', byRowid, '| full scan:', fullScan);
    expect(byRowid).toMatch(/messages_fts/);
    expect(byRowid).not.toBe(fullScan);
  } finally { db.close(); }
});

test('新库：空 FTS 直接回填不 DROP，触发器为 rowid 版本，新消息天然对齐', () => {
  const db = new Database(':memory:');
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    applySchema(db);
    db.exec(`INSERT INTO users(id,username,phone,password) VALUES ('fts-u','synthetic-fts','100000009','synthetic-unused-hash');
      INSERT INTO conversations(id,type) VALUES ('fts-c1','group');`);
    applyFts(db);
    expect(log).not.toHaveBeenCalled();
    expect(triggerSql(db).fts_messages_delete).toContain('rowid = OLD.rowid');
    db.prepare(INSERT_SQL).run('img', 'fts-c1', 'fts-u', 'image', 'x.png');
    db.prepare(INSERT_SQL).run('txt', 'fts-c1', 'fts-u', 'text', 'tok#fresh-db#');
    expect(search(db, 'fts-c1', 'tok#fresh-db#')).toEqual(['txt']);
    expect(misaligned(db)).toBe(0);
    applyFts(db);
    expect(log).not.toHaveBeenCalled();
    expect(ftsContent(db)).toEqual([{ message_id: 'txt', conversation_id: 'fts-c1', content: 'tok#fresh-db#' }]);
  } finally { db.close(); }
});

test('rowid 冲突不会让发消息失败；错位残留与「回滚旧代码→再升级」都在启动时自愈', () => {
  const db = legacyDatabase();
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    applyFts(db);
    const insert = db.prepare(INSERT_SQL);

    // ftsSearch.indexMessage 式补录（不带 rowid）：FTS5 自增分到 max+1，正好是下一条消息的 rowid。
    // 普通 INSERT 会 constraint failed 并让消息本身写入失败；OR REPLACE 只替换掉这行陈旧索引。
    db.prepare('INSERT INTO messages_fts(message_id, conversation_id, content) VALUES (?,?,?)').run('m7', 'fts-c1', '第7条 tok#7# 消息');
    expect(() => insert.run('after-stray', 'fts-c1', 'fts-u', 'text', 'tok#after-stray#')).not.toThrow();
    expect(search(db, 'fts-c1', 'tok#after-stray#')).toEqual(['after-stray']);
    expect(search(db, 'fts-c1', 'tok#7#')).toEqual(['m7']);
    expect(misaligned(db)).toBe(0);

    // 错位残留行（VACUUM 重排 / 硬删残留）：启动抽查发现 → 自愈重建
    db.prepare('INSERT INTO messages_fts(message_id, conversation_id, content) VALUES (?,?,?)').run('ghost', 'fts-c1', 'tok#ghost#');
    expect(misaligned(db)).toBe(1);
    applyFts(db);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('（drift）'));
    expect(rowsFor(db, 'ghost')).toBe(0);
    expect(misaligned(db)).toBe(0);

    // 回滚到旧代码：旧 applyFts 换回 message_id 触发器，期间写入的 FTS 行 rowid 又是自增的
    db.exec(LEGACY_TRIGGERS);
    insert.run('rb-img', 'fts-c1', 'fts-u', 'image', 'x.png');
    insert.run('rb-text', 'fts-c1', 'fts-u', 'text', 'tok#rollback#');
    expect(misaligned(db)).toBeGreaterThan(0);
    log.mockClear();
    applyFts(db); // 再次升级
    expect(log).toHaveBeenCalledWith(expect.stringContaining('（legacy）'));
    expect(misaligned(db)).toBe(0);
    expect(search(db, 'fts-c1', 'tok#rollback#')).toEqual(['rb-text']);
  } finally { db.close(); }
});

test('重建中途失败整体回滚：保持旧布局与旧触发器、搜索照常可用，下次启动再重建', () => {
  const db = legacyDatabase();
  const before = ftsContent(db);
  const prepare = db.prepare.bind(db);
  const fault = jest.spyOn(db, 'prepare').mockImplementation(sql => {
    if (sql.includes('INSERT INTO messages_fts (rowid')) throw new Error('fts injected disk failure');
    return prepare(sql);
  });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    applyFts(db);
    expect(warn).toHaveBeenCalledWith('[db] FTS5 setup skipped:', 'fts injected disk failure');
    expect(ftsContent(db)).toEqual(before);
    expect(triggerSql(db).fts_messages_delete).toContain('message_id = OLD.id');
    expect(search(db, 'fts-c1', 'tok#7#')).toEqual(['m7']);
    db.prepare(RECALL_SQL).run('m7'); // 旧触发器仍在工作
    expect(search(db, 'fts-c1', 'tok#7#')).toEqual([]);

    fault.mockRestore();
    applyFts(db);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('（legacy）'));
    expect(misaligned(db)).toBe(0);
    expect(ftsContent(db)).toEqual(before.filter(r => r.message_id !== 'm7'));
  } finally { db.close(); }
});
