'use strict';
/**
 * 1) 少于 3 个字的搜索（中文常见 2 字词）也能搜到：trigram 索引对短查询恒为空，需降级
 * 2) 自由文本入口（群名/群公告、建群、用户名/简介、验证消息、红包祝福语、转账备注）命中违禁词被拒，
 *    且红包/转账被拒时不扣款
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const moderation = require('../src/modules/moderation/moderation.service');
const wallet = require('../src/modules/wallet/wallet.service');
const { searchMessages, countMessages, searchMessagesInConversations } = require('../src/utils/ftsSearch');

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
const BAD = 'porttest违禁';

describe('短查询搜索', () => {
  test('2 字查询在会话内、计数、全局搜索中都能命中', async () => {
    const a = await makeUser(); const b = await makeUser();
    await befriend(a, b);
    const cid = await privateConversation(a, b);
    const r = await request(app).post(`/api/messages/${cid}`).set(auth(a)).send({ content: '明天一起吃火锅吧', type: 'text' });
    expect(r.status).toBe(200);
    expect(searchMessages('火锅', cid, a.userId).map(m => m.content)).toContain('明天一起吃火锅吧');
    expect(countMessages('火锅', cid, null, a.userId)).toBe(1);
    expect(searchMessagesInConversations('火锅', [cid], a.userId).total).toBe(1);
    // LIKE 通配符按字面匹配
    expect(searchMessages('%', cid, a.userId)).toHaveLength(0);
    // 3 字以上仍走全文索引
    expect(searchMessages('吃火锅', cid, a.userId)).toHaveLength(1);
  });
});

describe('自由文本入口违禁词检查', () => {
  let a, b, cid, gid;
  beforeAll(async () => {
    a = await makeUser(); b = await makeUser();
    await befriend(a, b);
    cid = await privateConversation(a, b);
    const g = await request(app).post('/api/messages/conversation/group').set(auth(a)).send({ name: '正常群名', memberIds: [b.userId] });
    gid = g.body.conversationId;
    moderation.addWord(BAD);
  });
  afterAll(() => {
    db.prepare('DELETE FROM content_blacklist WHERE word=?').run(BAD);
    moderation.load();
  });
  const expect4xx = (r) => expect(r.status).toBeGreaterThanOrEqual(400);

  test('群名、群公告、建群', async () => {
    expect4xx(await request(app).put(`/api/messages/conversation/${gid}`).set(auth(a)).send({ name: `群${BAD}` }));
    expect4xx(await request(app).put(`/api/messages/conversation/${gid}`).set(auth(a)).send({ announcement: `公告${BAD}` }));
    expect4xx(await request(app).post('/api/messages/conversation/group').set(auth(a)).send({ name: `新群${BAD}`, memberIds: [b.userId] }));
    const conv = db.prepare('SELECT name, announcement FROM conversations WHERE id=?').get(gid);
    expect(conv.name).toBe('正常群名');
  });

  test('用户名与简介', async () => {
    expect4xx(await request(app).put('/api/users/profile').set(auth(a)).send({ username: `名${BAD}` }));
    expect4xx(await request(app).put('/api/users/profile').set(auth(a)).send({ bio: `简介${BAD}` }));
  });

  test('加好友验证消息', async () => {
    const c = await makeUser();
    expect4xx(await request(app).post('/api/users/friend-request').set(auth(c)).send({ toId: a.userId, message: `你好${BAD}` }));
  });

  test('红包祝福语与转账备注被拒且不扣款', async () => {
    wallet.applyDelta(a.userId, 100, 'test_seed', null, '测试');
    const before = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(a.userId).balance;
    expect4xx(await request(app).post('/api/messages/red-packet/send').set(auth(a)).send({ conversationId: cid, totalAmount: 5, totalCount: 1, greeting: `恭喜${BAD}` }));
    expect4xx(await request(app).post('/api/wallet/transfer').set(auth(a)).send({ to_user_id: b.userId, amount: 5, note: `备注${BAD}` }));
    expect(db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(a.userId).balance).toBe(before);
  });
});
