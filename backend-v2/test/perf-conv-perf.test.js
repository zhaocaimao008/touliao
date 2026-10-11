'use strict';
/**
 * /read 与会话列表的有界扫描回归（2026-10-11，conv-perf）：
 *  1. 私聊 markRead 只回填 (上次已读水位, 本次] 区间：message_reads（含 read_at）与原「每次全量 INSERT OR IGNORE」
 *     逐行一致（含读者自己发的消息、回读更早消息、水位消息被撤回退回全量路径、跨度过大改走会话索引），
 *     执行计划走 rowid 主键区间且区间端点就是两次水位；重复上报同一条时不再执行任何 message_reads 写语句。
 *  2. 阅后即焚计时语义不变（首读开始倒计时、重复已读不重置、发送者自己已读不触发、已开始的不再动），
 *     候选扫描有界；没有候选时不再开 IMMEDIATE 事务。recordDelivery 单条路径按主键 id 直取。
 *  3. 会话列表个人清空水位只 JOIN 一次：执行计划里不再有逐行的 conversation_clears 相关子查询；
 *     删除聊天/清空全部后的列表字段（隐藏、未读、@我、最后一条）不变。
 * 旧实现下 1/2 的执行计划断言（INTEGER PRIMARY KEY 区间 / 主键 id）与「无事务」断言会失败，3 的计划断言会失败。
 */
const { db, fixture, messages, conv, io } = require('./batch2-fixture.cjs');
const { randomUUID } = require('crypto');
const burn = require('../src/modules/messages/burn.service');
afterAll(async () => require('../src/db/writer').shutdown());

// 与 batch2-fixture 的 fixture() 同写法，只是会话类型为私聊
function privateFixture() {
  const id = randomUUID(), a = randomUUID(), b = randomUUID();
  for (const u of [a, b]) db.prepare('INSERT INTO users(id,username,phone,password,wechat_id) VALUES (?,?,?,?,?)').run(u, u, u, 'synthetic', u);
  db.prepare("INSERT INTO conversations(id,type) VALUES (?,'private')").run(id);
  for (const u of [a, b]) db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES (?,?)').run(id, u);
  return { id, a, b };
}

// created_at 逐条 +1 秒，保证「最后一条」与已读位置不依赖同秒并列的次序
let tick = 0;
function insertMsg(convId, senderId, content) {
  const id = randomUUID();
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, convId, senderId, 'text', content, Math.floor(Date.now() / 1000) + (tick++));
  return id;
}
const rowidOf = id => db.prepare('SELECT rowid AS rid FROM messages WHERE id=?').get(id).rid;
const burnOf = id => db.prepare('SELECT burn_after, burn_read_at, burn_expires_at FROM messages WHERE id=?').get(id);

// 记录 fn 执行期间主连接上真实执行的语句（含模块加载时就预编译好的），再逐条 EXPLAIN QUERY PLAN
async function recordStatements(fn) {
  const proto = Object.getPrototypeOf(db.prepare('SELECT 1'));
  const seen = [];
  const spies = ['run', 'get', 'all'].map(name => {
    const original = proto[name];
    return jest.spyOn(proto, name).mockImplementation(function (...args) {
      seen.push({ sql: this.source, args });
      return original.apply(this, args);
    });
  });
  try { await fn(); } finally { spies.forEach(s => s.mockRestore()); }
  return seen;
}
const planOf = ({ sql, args }) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(r => r.detail).join(' | ');
const RANGE_PLAN = /SEARCH messages USING INTEGER PRIMARY KEY \(rowid>\? AND rowid<\?\)/;
const isReadsBackfill = s => /INSERT OR IGNORE INTO message_reads/.test(s.sql);
const isBurnCandidate = s => /burn_read_at IS NULL/.test(s.sql) && /FROM messages WHERE/.test(s.sql);

describe('私聊 markRead：message_reads 只补上次水位之后的区间', () => {
  test('结果与原全量回填逐行一致（含 read_at），计划为 rowid 区间，重复上报不再写', async () => {
    const f = privateFixture();
    // 原实现语义：每次 markRead(x) 把本会话 rowid<=x 的未删消息（双方的都算）INSERT OR IGNORE，read_at=本次 readAt
    const legacy = new Map();
    const read = async msgId => {
      const { readAt } = await conv.markRead(null, f.b, f.id, msgId);
      for (const { id } of db.prepare('SELECT id FROM messages WHERE conversation_id=? AND rowid<=? AND deleted=0').all(f.id, rowidOf(msgId))) {
        if (!legacy.has(id)) legacy.set(id, readAt);
      }
    };
    const actual = () => db.prepare(`SELECT r.message_id, r.read_at FROM message_reads r JOIN messages m ON m.id=r.message_id
      WHERE r.user_id=? AND m.conversation_id=? ORDER BY r.message_id`).all(f.b, f.id).map(r => [r.message_id, r.read_at]);
    const expectLegacy = () => expect(actual()).toEqual([...legacy].sort((x, y) => (x[0] < y[0] ? -1 : 1)));

    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(insertMsg(f.id, i % 2 ? f.a : f.b, `cp-${i}`));
    await read(ids[3]); // 首次：无水位 → 原全量路径
    expectLegacy();

    const other = fixture();
    insertMsg(other.id, other.a, 'noise'); // 其他会话的消息穿插在 rowid 区间里，不能被算进来
    for (let i = 6; i < 9; i++) ids.push(insertMsg(f.id, i % 2 ? f.a : f.b, `cp-${i}`));
    const rec = await recordStatements(() => read(ids[8]));
    expectLegacy();
    const fill = rec.filter(isReadsBackfill);
    expect(fill).toHaveLength(1);
    expect(planOf(fill[0])).toMatch(RANGE_PLAN);
    // 行数上界：区间端点恰是上次水位与本次已读消息的 rowid
    expect(fill[0].args.slice(2, 4)).toEqual([rowidOf(ids[3]), rowidOf(ids[8])]);

    const back = await recordStatements(() => read(ids[1])); // 回读更早一条：区间为空，不写
    expect(back.filter(isReadsBackfill)).toEqual([]);
    expectLegacy();
    await read(ids[8]); // 水位被拉低到 ids[1] 后再前进
    expectLegacy();

    // 水位消息被撤回：不再信任它，退回原全量路径，结果仍一致
    db.prepare('UPDATE messages SET deleted=1 WHERE id=?').run(ids[8]);
    ids.push(insertMsg(f.id, f.a, 'cp-9'));
    const recalled = await recordStatements(() => read(ids[9]));
    expectLegacy();
    expect(recalled.filter(isReadsBackfill)[0].sql).not.toMatch(/\+rowid|rowid >/);

    // 跨度超过 4096 行（期间全库消息很多）：改走会话索引 + rowid 下界过滤，而不是扫一大段全库 rowid
    db.transaction(() => {
      const ins = db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, content) VALUES (?,?,?,'system','n')");
      for (let i = 0; i < 4100; i++) ins.run(randomUUID(), other.id, other.a);
    })();
    ids.push(insertMsg(f.id, f.b, 'cp-10'));
    const wide = await recordStatements(() => read(ids[10]));
    expectLegacy();
    const wideFill = wide.filter(isReadsBackfill);
    expect(wideFill).toHaveLength(1);
    expect(wideFill[0].sql).toMatch(/\+rowid > \?/);
    expect(planOf(wideFill[0])).toMatch(/idx_messages_conv_del_time/);
    expect(wideFill[0].args.slice(3)).toEqual([rowidOf(ids[10]), rowidOf(ids[9])]);

    // 稳态：重复上报同一条 → 不执行任何 message_reads 写语句、不扫焚毁候选、不开事务
    const tx = jest.spyOn(db, 'transaction');
    try {
      const steady = await recordStatements(() => read(ids[10]));
      expect(steady.filter(isReadsBackfill)).toEqual([]);
      expect(steady.filter(isBurnCandidate)).toEqual([]);
      expect(tx).not.toHaveBeenCalled();
    } finally { tx.mockRestore(); }
    expectLegacy();
  });
});

describe('阅后即焚：计时语义不变，候选扫描有界', () => {
  test('首读开始倒计时、重复已读不重置、发送者已读不触发；无候选时不开 IMMEDIATE 事务', async () => {
    const f = fixture();
    await conv.setBurnAfter(f.a, f.id, 60);
    const m1 = insertMsg(f.id, f.a, 'cp-burn-1');
    expect(burnOf(m1).burn_after).toBe(60);
    const tx = jest.spyOn(db, 'transaction');
    try {
      await conv.markRead(null, f.a, f.id, m1); // 发送者自己已读：不触发，也不开事务
      expect(burnOf(m1).burn_expires_at).toBeNull();
      expect(tx).not.toHaveBeenCalled();

      await conv.markRead(null, f.b, f.id, m1); // 接收方首读：无水位 → 原全会话条件，开始计时
      const s1 = burnOf(m1);
      expect(s1.burn_expires_at - s1.burn_read_at).toBe(60);
      expect(tx).toHaveBeenCalledTimes(1);

      const m2 = insertMsg(f.id, f.a, 'cp-burn-2');
      const sock = io();
      tx.mockClear();
      const rec = await recordStatements(() => conv.markRead(sock, f.b, f.id, m2));
      const s2 = burnOf(m2);
      expect(s2.burn_expires_at - s2.burn_read_at).toBe(60);
      expect(burnOf(m1).burn_expires_at).toBe(s1.burn_expires_at); // 已开始的不再动
      expect(sock.events.filter(e => e.name === 'message_burn_started').map(e => e.payload.msgId)).toEqual([m2]);
      expect(tx).toHaveBeenCalledTimes(1);
      const scans = rec.filter(isBurnCandidate);
      expect(scans.length).toBeGreaterThan(0);
      for (const s of scans) {
        expect(planOf(s)).toMatch(RANGE_PLAN);
        expect(s.args.slice(0, 2)).toEqual([rowidOf(m1), rowidOf(m2)]); // 只看 (上次水位, 本次]
      }

      // 重复已读同一条：区间为空，不扫候选、不开事务、不写事件
      tx.mockClear();
      const events = () => db.prepare("SELECT COUNT(*) AS n FROM conversation_events WHERE conversation_id=? AND event_type='message_burn_started'").get(f.id).n;
      const before = events();
      const again = await recordStatements(() => conv.markRead(sock, f.b, f.id, m2));
      expect(again.filter(isBurnCandidate)).toEqual([]);
      expect(tx).not.toHaveBeenCalled();
      expect(events()).toBe(before);
      expect(burnOf(m2).burn_expires_at).toBe(s2.burn_expires_at);

      // 新来的是普通消息：只跑一次锁外存在性预检，不开 IMMEDIATE 事务
      await conv.setBurnAfter(f.a, f.id, 0);
      const m3 = insertMsg(f.id, f.a, 'cp-plain');
      tx.mockClear();
      const plain = await recordStatements(() => conv.markRead(sock, f.b, f.id, m3));
      const pre = plain.filter(isBurnCandidate);
      expect(pre).toHaveLength(1);
      expect(pre[0].sql).toMatch(/^SELECT 1 FROM messages/);
      expect(planOf(pre[0])).toMatch(RANGE_PLAN);
      expect(tx).not.toHaveBeenCalled();
      expect(burnOf(m3).burn_expires_at).toBeNull();
    } finally { tx.mockRestore(); }

    // 到期销毁不受影响
    burn.expireDueMessages(null, burnOf(m1).burn_expires_at);
    expect(messages.history(f.id, f.b, {}).map(m => m.id)).not.toContain(m1);
  });

  test('recordDelivery（history 送达即开始计时）按主键 id 直取单条，不再扫整个会话', async () => {
    const f = fixture();
    await conv.setBurnAfter(f.a, f.id, 60);
    for (let i = 0; i < 5; i++) insertMsg(f.id, f.b, `cp-plain-${i}`);
    const m = insertMsg(f.id, f.a, 'cp-delivery');
    const rec = await recordStatements(() => messages.history(f.id, f.b, {}));
    const s = burnOf(m);
    expect(s.burn_expires_at - s.burn_read_at).toBe(60);
    const scans = rec.filter(isBurnCandidate);
    expect(scans.length).toBeGreaterThan(0);
    for (const q of scans) expect(planOf(q)).toMatch(/SEARCH messages USING INDEX sqlite_autoindex_messages_1 \(id=\?\)/);
  });
});

describe('会话列表：个人清空水位只 JOIN 一次', () => {
  test('删除聊天/清空全部后列表字段不变，执行计划里没有逐行 conversation_clears 子查询', async () => {
    const p = privateFixture();
    const u = p.a, v = p.b;
    const g = fixture();
    db.prepare("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES (?,?,'member')").run(g.id, u);
    for (let i = 0; i < 3; i++) insertMsg(p.id, v, `cp-old-${i}`);
    insertMsg(g.id, g.a, `@${u} 看一下`);
    insertMsg(g.id, g.a, 'cp-group-old');

    const list = () => conv.listConversations(u, { includeArchived: true });
    const find = async id => (await list()).find(c => c.id === id);
    expect((await find(g.id)).hasMention).toBe(true);
    expect((await find(p.id)).unreadCount).toBe(3);

    conv.hideConversation(null, u, p.id);
    conv.clearAllConversations(null, u);
    const rec = await recordStatements(list);
    const rows = await list();
    expect(rows.find(c => c.id === p.id)).toBeUndefined(); // 删除聊天且无新消息：不出现
    const cleared = rows.find(c => c.id === g.id);
    expect(cleared).toMatchObject({ unreadCount: 0, hasMention: false, lastMessage: null });

    const listStmt = rec.find(s => /AS hasMention/.test(s.sql));
    const plan = planOf(listStmt);
    expect(plan).toMatch(/SEARCH cc USING (COVERING )?INDEX/);
    expect(plan).not.toMatch(/SEARCH conversation_clears\b/);

    insertMsg(p.id, v, 'cp-new-private');
    expect(await find(p.id)).toMatchObject({ lastMessage: 'cp-new-private', unreadCount: 1, hasMention: false });
    insertMsg(g.id, g.a, 'cp-new-plain');
    expect(await find(g.id)).toMatchObject({ lastMessage: 'cp-new-plain', unreadCount: 1, hasMention: false });
    insertMsg(g.id, g.a, `@${u} 新的`);
    expect(await find(g.id)).toMatchObject({ lastMessage: `@${u} 新的`, unreadCount: 2, hasMention: true });
  });
});
