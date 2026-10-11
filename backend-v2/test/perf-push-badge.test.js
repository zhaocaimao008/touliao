'use strict';
// App 角标查询的索引区间回归（2026-10-11）：
//   pushNewMessage 的角标 = 收件人全部「未免打扰、未归档」会话的未读总数（封顶 99）。原 SQL 是
//   cm JOIN m LEFT JOIN cs，cs 只能排在 m 之后，created_at>last_read_at 用不上索引，每发一条消息
//   都要把每个收件人所有会话的全部历史扫一遍。改为先 LEFT JOIN cs 再 JOIN m（见 badgeCountSql）。
// 这里锁定两点：
//   1. EXPLAIN QUERY PLAN 里 messages 的检索带 created_at>? 下界（防日后改写悄悄退回全量扫描）
//   2. 已读 / 未读 / 免打扰 / 归档 / 清空记录 / 封顶 各场景的计数与改写前的旧 SQL 完全一致
require('./testEnv');
const crypto = require('crypto');
const { makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
const webpush = require('web-push');
const { pushNewMessage, badgeCountSql } = require('../src/utils/push');

// 改写前的原 SQL，逐字保留作对照组：新 SQL 的计数必须与它完全一致
const oldBadgeSql = n => `SELECT u.id AS uid, (SELECT COUNT(*) FROM (
    SELECT 1 FROM conversation_members cm
    JOIN messages m ON m.conversation_id=cm.conversation_id
    LEFT JOIN conversation_settings cs ON cs.user_id=cm.user_id AND cs.conversation_id=cm.conversation_id
    WHERE cm.user_id=u.id AND m.sender_id!=u.id AND m.deleted=0 AND m.type!='system'
      AND COALESCE(cs.muted,0)=0 AND COALESCE(cs.archived,0)=0
      AND m.created_at>COALESCE(cs.last_read_at,0)
      AND m.rowid>COALESCE((SELECT cleared_rowid FROM conversation_clears WHERE user_id=u.id AND conversation_id=cm.conversation_id),0)
    LIMIT 99)) AS cnt FROM users u WHERE u.id IN (${Array.from({ length: n }, () => '?').join(',')})`;

const T = Math.floor(Date.now() / 1000) - 3600;   // 消息时间基准
let sender, convA;
const r = {};   // 各场景的收件人
const sent = [];

function newConv(members) {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO conversations (id, type, name) VALUES (?, 'group', '角标')").run(id);
  for (const u of members) db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(id, u.userId);
  return id;
}
// 返回 rowid，供清空记录的水位线使用
function msg(conv, from, at, { type = 'text', deleted = 0 } = {}) {
  return db.prepare('INSERT INTO messages (id, conversation_id, sender_id, type, content, deleted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), conv, from.userId, type, 'x', deleted, at).lastInsertRowid;
}
function setting(u, conv, { muted = 0, archived = 0, last_read_at = 0 } = {}) {
  db.prepare('INSERT INTO conversation_settings (user_id, conversation_id, muted, archived, last_read_at) VALUES (?, ?, ?, ?, ?)')
    .run(u.userId, conv, muted, archived, last_read_at);
}
function clear(u, conv, at, rowid) {
  db.prepare('INSERT INTO conversation_clears (user_id, conversation_id, cleared_at, cleared_rowid) VALUES (?, ?, ?, ?)')
    .run(u.userId, conv, at, rowid);
}

beforeAll(async () => {
  sender = await makeUser();
  for (const k of ['read', 'unread', 'nulls', 'partial', 'muted', 'archived', 'cleared', 'clearedOld', 'mixed', 'capped']) r[k] = await makeUser();

  // 会话 A：发送者 + 全部收件人。可计入的只有第 1、2、3、6 条（4 已删除，5 是系统消息）
  convA = newConv([sender, ...Object.values(r)]);
  msg(convA, sender, T + 1);
  msg(convA, sender, T + 2);
  const m3 = msg(convA, sender, T + 3);
  msg(convA, sender, T + 4, { deleted: 1 });
  msg(convA, sender, T + 5, { type: 'system' });
  msg(convA, sender, T + 6);
  setting(r.read, convA, { last_read_at: T + 6 });                          // 全部已读 → 0
  // r.unread 没有 settings 行 → 4
  setting(r.nulls, convA, { muted: null, archived: null, last_read_at: null }); // 全 NULL 走 COALESCE → 4
  setting(r.partial, convA, { last_read_at: T + 2 });                       // 读到第 2 条 → 3、6 → 2
  setting(r.muted, convA, { muted: 1 });                                    // 免打扰 → 0
  setting(r.archived, convA, { archived: 1 });                              // 归档 → 0
  clear(r.cleared, convA, T + 3, m3);                                       // 清空到第 3 条 → 只剩 6 → 1
  setting(r.clearedOld, convA, { last_read_at: T + 1 });                    // 已读点早于清空点：以清空水位为准 → 1
  clear(r.clearedOld, convA, T + 3, m3);
  setting(r.mixed, convA, { last_read_at: T + 1 });                         // A 里 2、3、6 → 3

  // r.mixed 另有：B 免打扰、C 归档（都有未读，不计）；D 两条未读 + 自己发的一条（不计）→ 合计 3+2=5
  const convB = newConv([sender, r.mixed]);
  msg(convB, sender, T + 1); msg(convB, sender, T + 2); msg(convB, sender, T + 3);
  setting(r.mixed, convB, { muted: 1 });
  const convC = newConv([sender, r.mixed]);
  msg(convC, sender, T + 1); msg(convC, sender, T + 2);
  setting(r.mixed, convC, { archived: 1 });
  const convD = newConv([sender, r.mixed]);
  msg(convD, sender, T + 1); msg(convD, sender, T + 2); msg(convD, r.mixed, T + 3);

  // r.capped：E 里积压 120 条未读 → 封顶 99
  const convE = newConv([sender, r.capped]);
  db.transaction(() => { for (let i = 0; i < 120; i++) msg(convE, sender, T + 10 + i); }).immediate();

  // 推送通道只给 r.mixed（Web Push：负载即完整推送数据，含角标，便于断言）
  const endpoint = 'https://fcm.googleapis.com/fcm/send/badge-' + r.mixed.userId;
  db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, subscription) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), r.mixed.userId, endpoint, JSON.stringify({ endpoint, keys: { p256dh: 'k', auth: 'a' } }));
  jest.spyOn(webpush, 'sendNotification').mockImplementation(async (sub, body) => { sent.push({ to: JSON.parse(body).recipientId, payload: JSON.parse(body) }); });
});
afterAll(() => jest.restoreAllMocks());

test('查询计划：messages 检索带 created_at 下界，不再从会话第一条消息扫起', () => {
  const ids = [r.read.userId, r.mixed.userId];
  const planOf = sql => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...ids).map(x => x.detail);
  const mStep = plan => plan.find(d => /^(SEARCH|SCAN) (TABLE messages AS )?m\b/.test(d));
  const plan = planOf(badgeCountSql(ids.length));
  console.info('PERF_PUSH_BADGE_QUERY_PLAN', plan.join('; '));
  // 期望形如 SEARCH m USING INDEX idx_messages_conv_del_time (conversation_id=? AND deleted=? AND created_at>?)
  expect(mStep(plan)).toMatch(/^SEARCH .*created_at>\?/);
  // 对照：旧 SQL 的 messages 检索只有 (conversation_id=? AND deleted=?)，没有时间下界
  expect(mStep(planOf(oldBadgeSql(ids.length)))).not.toMatch(/created_at>\?/);
});

test('各场景计数与改写前的旧 SQL 完全一致：已读 / 未读 / 免打扰 / 归档 / 清空 / 封顶', () => {
  const ids = [sender, ...Object.values(r)].map(u => u.userId);
  const run = sql => Object.fromEntries(db.prepare(sql).all(...ids).map(x => [x.uid, x.cnt]));
  const now = run(badgeCountSql(ids.length));
  expect(now).toEqual(run(oldBadgeSql(ids.length)));
  const expected = { read: 0, unread: 4, nulls: 4, partial: 2, muted: 0, archived: 0, cleared: 1, clearedOld: 1, mixed: 5, capped: 99 };
  for (const [k, n] of Object.entries(expected)) expect([k, now[r[k].userId]]).toEqual([k, n]);
  // 发送者自己发的不计；D 里 r.mixed 回的那条计入 → 1
  expect(now[sender.userId]).toBe(1);
});

test('pushNewMessage 下发的角标 = 跨会话合计，会话卡片未读仍只算本会话', async () => {
  sent.length = 0;
  await pushNewMessage({ conversationId: convA, senderId: sender.userId, senderName: 'sender', content: 'hi', type: 'text', timestamp: Date.now() });
  expect(sent.map(s => s.to)).toEqual([r.mixed.userId]);
  expect(sent[0].payload.badge).toBe(5);
  expect(sent[0].payload.conversationUnreadCount).toBe(3);
});
