'use strict';
/**
 * /unread-counts 与会话列表 hasMention 补个人清空水位（2026-10-11）回归：
 *  1. 删除聊天（hide，仅自己）后，旧未读不再出现在 /unread-counts；之后的新消息正常计 1，与列表 unreadCount 一致；
 *     且 hide 不推进 last_read_at（已读回执语义不变）
 *  2. 清空全部聊天记录（clear-all）后，所有会话的旧未读不再上报；已清掉的 @我 不再点亮 hasMention；
 *     清空后新来的 @ 照常计未读、点亮 hasMention
 * 旧代码 unreadCounts / hasMention 不看 conversation_clears.cleared_rowid，上述断言会失败。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const { v4: uuidv4 } = require('uuid');

function insertMsg(convId, senderId, content) {
  const id = uuidv4();
  db.prepare(
    'INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at) VALUES (?,?,?,?,?,?)'
  ).run(id, convId, senderId, 'text', content, Math.floor(Date.now() / 1000));
  return id;
}

const unreadOf = async user => {
  const r = await request(app).get('/api/messages/unread-counts').set('Authorization', `Bearer ${user.token}`);
  expect(r.status).toBe(200);
  return r.body;
};

// includeArchived=1 不读写 2s 列表缓存，直写 DB 后无需手动失效
const listConv = (user, convId) => request(app).get('/api/messages/conversations?includeArchived=1')
  .set('Authorization', `Bearer ${user.token}`)
  .then(r => (r.body || []).find(c => c.id === convId));

describe('/unread-counts 遵守个人清空/删除聊天水位', () => {
  const ts = Date.now().toString().slice(-8);

  test('删除聊天（hide）后旧未读不再上报；之后的新消息计 1，与列表一致', async () => {
    const a = await makeUser({ username: `pu_a_${ts}` });
    const b = await makeUser({ username: `pu_b_${ts}` });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    insertMsg(convId, b.userId, '旧消息1');
    insertMsg(convId, b.userId, '旧消息2');
    insertMsg(convId, b.userId, '旧消息3');
    expect((await unreadOf(a))[convId]).toBe(3);

    const res = await request(app).post(`/api/messages/conversation/${convId}/hide`).set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);

    // 会话已从列表消失，角标也不能再算它
    expect(await listConv(a, convId)).toBeUndefined();
    expect((await unreadOf(a))[convId]).toBeUndefined();
    // 仅自己：对方的会话仍在
    expect(await listConv(b, convId)).toBeTruthy();
    // 修复走查询侧：hide 不推进 last_read_at，否则对方会看到"已读"
    const cs = db.prepare('SELECT last_read_at FROM conversation_settings WHERE user_id=? AND conversation_id=?').get(a.userId, convId);
    expect(cs?.last_read_at || 0).toBe(0);

    insertMsg(convId, b.userId, '新消息');
    expect((await unreadOf(a))[convId]).toBe(1);
    const back = await listConv(a, convId);
    expect(back).toBeTruthy();
    expect(back.unreadCount).toBe(1);
  });

  test('清空全部聊天记录后旧未读与已清掉的 @我 都归零；之后的新 @ 照常计数并点亮', async () => {
    const owner = await makeUser({ username: `pu_own_${ts}` });
    const member = await makeUser({ username: `pu_mem_${ts}` });
    await befriend(owner, member);
    const pconv = await privateConversation(owner, member);
    insertMsg(pconv, owner.userId, '私聊旧消息1');
    insertMsg(pconv, owner.userId, '私聊旧消息2');

    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `pu群_${ts}`, memberIds: [member.userId] });
    const gid = g.body.conversationId;
    expect(gid).toBeTruthy();
    insertMsg(gid, owner.userId, `@${member.username} 看一下`);
    insertMsg(gid, owner.userId, '群旧消息');

    const before = await unreadOf(member);
    expect(before[pconv]).toBe(2);
    expect(before[gid]).toBe(2);
    expect((await listConv(member, gid)).hasMention).toBe(true);

    const res = await request(app).delete('/api/messages/conversations/messages').set('Authorization', `Bearer ${member.token}`);
    expect(res.status).toBe(200);

    const after = await unreadOf(member);
    expect(after[pconv]).toBeUndefined();
    expect(after[gid]).toBeUndefined();
    // 清空全部不隐藏会话：群仍在列表里，但未读与「有人@我」都应与水位一致
    const cleared = await listConv(member, gid);
    expect(cleared).toBeTruthy();
    expect(cleared.unreadCount).toBe(0);
    expect(cleared.hasMention).toBe(false);

    insertMsg(gid, owner.userId, `@${member.username} 新的`);
    expect((await unreadOf(member))[gid]).toBe(1);
    const fresh = await listConv(member, gid);
    expect(fresh.unreadCount).toBe(1);
    expect(fresh.hasMention).toBe(true);
  });
});
