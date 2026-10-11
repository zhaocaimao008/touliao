'use strict';
/**
 * 2026-10-11 perf-autojoin 回归：socket 连接时 autoJoinConversationIds 不得再对全站 messages
 * 做 GROUP BY MAX(created_at) 聚合（旧实现 LEFT JOIN 派生表 → MATERIALIZE + 全量 SCAN messages，
 * 成本随全站历史消息线性增长），只能按该用户自己的会话逐个走索引查找；
 * 且返回的会话 id 集合与顺序（含 LIMIT 截断）跟旧 SQL 完全一致。
 */
require('./testEnv');
const { db } = require('../src/db/connection');
const { makeUser } = require('./helpers');
const { autoJoinConversationIds } = require('../src/realtime/index');

// 旧实现 SQL 原样保留作对照基准：新实现结果必须逐项一致
const LEGACY_SQL = `
  SELECT cm.conversation_id AS conversation_id
  FROM conversation_members cm
  LEFT JOIN conversation_settings cs ON cs.conversation_id = cm.conversation_id AND cs.user_id = cm.user_id
  LEFT JOIN conversations c ON c.id = cm.conversation_id
  LEFT JOIN (
    SELECT conversation_id, MAX(created_at) AS last_at FROM messages WHERE deleted=0 GROUP BY conversation_id
  ) m ON m.conversation_id = cm.conversation_id
  WHERE cm.user_id = ?
  ORDER BY COALESCE(cs.pinned, 0) DESC, COALESCE(m.last_at, c.created_at) DESC, c.id DESC
  LIMIT ?
`;
const legacyIds = (userId, limit) => db.prepare(LEGACY_SQL).all(userId, limit).map(r => r.conversation_id);

function makeGroup(id, createdAt) {
  db.prepare('INSERT INTO conversations (id, type, name, created_at) VALUES (?, ?, ?, ?)')
    .run(id, 'group', id, createdAt);
}
function addMember(convId, userId, joinedAt) {
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(convId, userId, joinedAt);
}
let msgSeq = 0;
function addMessage(convId, senderId, createdAt, deleted = 0) {
  msgSeq += 1;
  db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,deleted,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(`${convId}-m${msgSeq}`, convId, senderId, 'text', 'perf autojoin', deleted, createdAt);
}

describe('perf-autojoin：自动订阅房间查询只走该用户自己的会话', () => {
  test('返回的会话 id 及顺序跟旧 SQL 完全一致（置顶 > 最近未删消息 > 会话创建时间 > id DESC，含截断）', async () => {
    const u = await makeUser({ username: 'perf_aj_order_u' });
    const other = await makeUser({ username: 'perf_aj_noise_u' });
    const p = `perf-aj-${u.userId}`;
    const ids = {
      pinnedOld: `${p}-pinned-old`,     // 置顶但最旧 → 恒排第一
      active: `${p}-active`,            // 最近未删消息 900
      empty: `${p}-empty`,              // 无消息 → 回落 created_at 700
      deletedNewest: `${p}-del-newest`, // 最新那条已删(1000)，按未删的 500 算
      tieA: `${p}-tie-a`,               // 与 tieB 同为 400 → c.id DESC 决胜
      tieB: `${p}-tie-b`,
      allDeleted: `${p}-all-deleted`,   // 只有已删消息(2000) → 回落 created_at 300
    };
    db.transaction(() => {
      makeGroup(ids.pinnedOld, 100); addMember(ids.pinnedOld, u.userId, 100);
      addMessage(ids.pinnedOld, u.userId, 150);
      db.prepare('INSERT INTO conversation_settings (user_id, conversation_id, pinned) VALUES (?, ?, 1)')
        .run(u.userId, ids.pinnedOld);

      makeGroup(ids.active, 110); addMember(ids.active, u.userId, 110);
      addMessage(ids.active, u.userId, 120);
      addMessage(ids.active, u.userId, 900);

      makeGroup(ids.empty, 700); addMember(ids.empty, u.userId, 700);

      makeGroup(ids.deletedNewest, 120); addMember(ids.deletedNewest, u.userId, 120);
      addMessage(ids.deletedNewest, u.userId, 500);
      addMessage(ids.deletedNewest, u.userId, 1000, 1);

      makeGroup(ids.tieA, 130); addMember(ids.tieA, u.userId, 130);
      addMessage(ids.tieA, u.userId, 400);
      makeGroup(ids.tieB, 140); addMember(ids.tieB, u.userId, 140);
      addMessage(ids.tieB, u.userId, 400);

      makeGroup(ids.allDeleted, 300); addMember(ids.allDeleted, u.userId, 300);
      addMember(ids.allDeleted, other.userId, 300);
      addMessage(ids.allDeleted, other.userId, 2000, 1);
      // 别人置顶不影响 u 的排序（cs 按 user_id 关联）
      db.prepare('INSERT INTO conversation_settings (user_id, conversation_id, pinned) VALUES (?, ?, 1)')
        .run(other.userId, ids.allDeleted);

      // 噪声：u 不在其中的会话，消息更新更多——旧实现会把它们全聚合一遍，新实现不应触碰
      for (let i = 0; i < 20; i++) {
        const nid = `${p}-noise-${i}`;
        makeGroup(nid, 5000 + i); addMember(nid, other.userId, 5000 + i);
        for (let k = 0; k < 20; k++) addMessage(nid, other.userId, 6000 + i * 100 + k);
      }
    })();

    const all = autoJoinConversationIds(db, u.userId, 500);
    // 整体（含 makeUser 可能自带的会话）必须与旧 SQL 逐项一致
    expect(all).toEqual(legacyIds(u.userId, 500));
    // 噪声会话不属于 u，不得出现
    expect(all.some(id => id.startsWith(`${p}-noise-`))).toBe(false);

    const synthetic = all.filter(id => id.startsWith(`${p}-`));
    expect(synthetic).toEqual([
      ids.pinnedOld, ids.active, ids.empty, ids.deletedNewest, ids.tieB, ids.tieA, ids.allDeleted,
    ]);

    // LIMIT 截断后取的是同一批、同一顺序
    for (let limit = 1; limit <= all.length; limit++) {
      expect(autoJoinConversationIds(db, u.userId, limit)).toEqual(legacyIds(u.userId, limit));
    }
  });

  test('查询计划：messages 只按会话走索引 SEARCH，不再 MATERIALIZE 派生表 / 全量 SCAN', async () => {
    const u = await makeUser({ username: 'perf_aj_plan_u' });
    // 截获函数实际执行的 SQL（不新增导出），再对同一条 SQL 跑 EXPLAIN QUERY PLAN
    let capturedSql = null;
    const spyDb = { prepare: sql => { capturedSql = sql; return db.prepare(sql); } };
    autoJoinConversationIds(spyDb, u.userId, 500);
    expect(capturedSql).toMatch(/FROM\s+messages/i);

    const plan = db.prepare(`EXPLAIN QUERY PLAN ${capturedSql}`).all(u.userId, 500).map(r => r.detail);
    console.info('PERF_AUTOJOIN_QUERY_PLAN', plan.join('; '));
    // 旧计划：MATERIALIZE m / SCAN messages USING COVERING INDEX idx_messages_unread / SEARCH m USING AUTOMATIC COVERING INDEX
    // 任何 SCAN（messages 不论别名）都意味着成本跟全站数据量线性相关
    expect(plan.filter(d => /^SCAN\b/.test(d))).toEqual([]);
    expect(plan.some(d => /^MATERIALIZE\b/.test(d))).toBe(false);
    expect(plan.some(d => /AUTOMATIC/.test(d))).toBe(false);
    // messages 必须走其自身索引按会话定位（idx_messages_conv_del_time 或部分索引 idx_messages_unread 均可）
    expect(plan.some(d => /^SEARCH .*USING (COVERING )?INDEX idx_messages_/.test(d))).toBe(true);
  });
});
