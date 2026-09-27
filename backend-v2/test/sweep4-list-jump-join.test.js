'use strict';
/**
 * 第四轮端到端实测发现的服务端问题回归：
 *  1. 会话列表里的通话预览按查看者区分主叫/被叫文案（被叫不再看到「对方已拒绝」「已取消」）
 *  2. 跳转到历史消息（/around）后能继续向下翻页：hasNewer + afterId 复合游标，同秒消息不丢不重
 *  3. 新成员经邀请链接/被邀请入群：入群前的历史不计入未读
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const msgSvc = require('../src/modules/messages/messages.service');
const convSvc = require('../src/modules/conversations/conversations.service');
const { db } = require('../src/db/connection');
const { v4: uuidv4 } = require('uuid');

function seedSameSecond(convId, senderId, n, ts, type = 'text', contentOf = i => `m${i}`) {
  const ins = db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)');
  const ids = [];
  for (let i = 0; i < n; i++) { const id = uuidv4(); ins.run(id, convId, senderId, type, contentOf(i), ts); ids.push(id); }
  return ids;
}

describe('会话列表·通话预览按查看者区分', () => {
  test.each([
    ['对方已拒绝', '已拒绝'],
    ['已取消', '未接来电'],
    ['对方无应答', '未接来电'],
    ['语音通话 30 秒', '语音通话 30 秒'],
  ])('主叫文案「%s」→ 被叫看到「%s」，主叫看到原文', async (callerText, calleeText) => {
    const a = await makeUser({ username: `cp_a_${uuidv4().slice(0, 6)}` });
    const b = await makeUser({ username: `cp_b_${uuidv4().slice(0, 6)}` });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    seedSameSecond(convId, a.userId, 1, Math.floor(Date.now() / 1000) + 5, 'call', () => callerText);
    convSvc.invalidateConvCacheForUser(a.userId); convSvc.invalidateConvCacheForUser(b.userId);
    const pick = list => (Array.isArray(list) ? list : list.conversations).find(c => c.id === convId);
    expect(pick(await convSvc.listConversations(a.userId, {})).lastMessage).toBe(callerText);
    expect(pick(await convSvc.listConversations(b.userId, {})).lastMessage).toBe(calleeText);
  });
});

describe('跳转到历史消息后向下翻页', () => {
  let a, convId, ids;
  beforeAll(async () => {
    a = await makeUser({ username: 'jmp_a' });
    const b = await makeUser({ username: 'jmp_b' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
    ids = seedSameSecond(convId, a.userId, 80, 1700000100); // 同一秒 80 条：只靠 created_at 必然丢/错位
  });

  test('around：同秒大量消息时目标一定在窗口里；后面还有更多时 hasNewer=true', () => {
    const r = msgSvc.aroundMessage(convId, ids[10], a.userId);
    const got = r.messages.map(m => m.id);
    expect(got).toContain(ids[10]);
    expect(got.indexOf(ids[10])).toBe(10); // 前 10 条都在，顺序正确
    expect(r.hasNewer).toBe(true);
    const tail = msgSvc.aroundMessage(convId, ids[75], a.userId);
    expect(tail.messages.map(m => m.id)).toContain(ids[75]);
    expect(tail.hasNewer).toBe(false);
  });

  test('history after+afterId：从跳转窗口末尾一路向下翻到最新，不丢不重', () => {
    const r = msgSvc.aroundMessage(convId, ids[10], a.userId);
    const seen = r.messages.map(m => m.id);
    let last = r.messages[r.messages.length - 1];
    for (let guard = 0; guard < 20; guard++) {
      const page = msgSvc.history(convId, a.userId, { limit: 7, after: last.created_at, afterId: last.id });
      if (!page.length) break;
      page.forEach(m => seen.push(m.id));
      last = page[page.length - 1];
    }
    expect(seen).toEqual(ids);
  });
});

describe('入群前的历史不计入新成员未读', () => {
  test('邀请链接入群：历史 0 未读；入群后的新消息正常计 1', async () => {
    const owner = await makeUser({ username: 'hr_owner' });
    const other = await makeUser({ username: 'hr_other' });
    const joiner = await makeUser({ username: 'hr_joiner' });
    await befriend(owner, other);
    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`).send({ name: '历史未读群', memberIds: [other.userId] });
    const gid = g.body.conversationId;
    seedSameSecond(gid, owner.userId, 5, Math.floor(Date.now() / 1000) - 60);
    const link = await request(app).post(`/api/messages/conversation/${gid}/invite-link`).set('Authorization', `Bearer ${owner.token}`);
    const j = await request(app).post(`/api/messages/join/${link.body.token}`).set('Authorization', `Bearer ${joiner.token}`);
    expect(j.status).toBe(200);
    expect(convSvc.unreadCounts(joiner.userId)[gid] || 0).toBe(0);
    seedSameSecond(gid, owner.userId, 1, Math.floor(Date.now() / 1000) + 1);
    expect(convSvc.unreadCounts(joiner.userId)[gid]).toBe(1);
  });

  test('被好友邀请入群：同样不继承历史未读', async () => {
    const owner = await makeUser({ username: 'hi_owner' });
    const other = await makeUser({ username: 'hi_other' });
    const invitee = await makeUser({ username: 'hi_invitee' });
    await befriend(owner, other); await befriend(owner, invitee);
    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`).send({ name: '邀请未读群', memberIds: [other.userId] });
    const gid = g.body.conversationId;
    seedSameSecond(gid, owner.userId, 4, Math.floor(Date.now() / 1000) - 60);
    const inv = await request(app).post(`/api/messages/conversation/${gid}/invite`)
      .set('Authorization', `Bearer ${owner.token}`).send({ userIds: [invitee.userId] });
    expect(inv.status).toBe(200);
    expect(convSvc.unreadCounts(invitee.userId)[gid] || 0).toBe(0);
  });
});
