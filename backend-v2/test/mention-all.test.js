'use strict';
/**
 * 群 @所有人：仅群主/管理员发的「@所有人」才点亮成员会话列表的 hasMention（有人@我）红点；
 * 普通成员发的「@所有人」不点亮（权限门槛，见 conversations.service hasMention 子查询 +
 * message.js handleMentions 的角色校验）。
 */
const { request, app, makeUser, befriend } = require('./helpers');
const { db } = require('../src/db/connection');
const { v4: uuidv4 } = require('uuid');

function insertMsg(convId, senderId, content) {
  const id = uuidv4();
  db.prepare(
    'INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at) VALUES (?,?,?,?,?,?)'
  ).run(id, convId, senderId, 'text', content, Math.floor(Date.now() / 1000));
  return id;
}

const listConv = (user, convId) => request(app).get('/api/messages/conversations')
  .set('Authorization', `Bearer ${user.token}`)
  .then(r => (r.body || []).find(c => c.id === convId));

describe('群 @所有人 → hasMention 权限门槛', () => {
  const ts = Date.now().toString().slice(-8);

  test('群主发「@所有人」→ 成员会话列表 hasMention=true', async () => {
    const owner = await makeUser({ username: `ma_owner_${ts}` });
    const member = await makeUser({ username: `ma_mem_${ts}` });
    await befriend(owner, member);
    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `ma群A_${ts}`, memberIds: [member.userId] });
    const convId = g.body.conversationId;
    expect(convId).toBeTruthy();

    insertMsg(convId, owner.userId, '@所有人 全员开会');
    const conv = await listConv(member, convId);
    expect(conv).toBeTruthy();
    expect(conv.hasMention).toBe(true);
  });

  test('普通成员发「@所有人」→ 其他成员 hasMention=false（无权限）', async () => {
    const owner = await makeUser({ username: `ma_owner2_${ts}` });
    const m1 = await makeUser({ username: `ma_m1_${ts}` });
    const m2 = await makeUser({ username: `ma_m2_${ts}` });
    await befriend(owner, m1); await befriend(owner, m2);
    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `ma群B_${ts}`, memberIds: [m1.userId, m2.userId] });
    const convId = g.body.conversationId;
    expect(convId).toBeTruthy();

    insertMsg(convId, m1.userId, '@所有人 大家好');   // 普通成员，无权 @所有人
    const conv = await listConv(m2, convId);
    expect(conv).toBeTruthy();
    expect(conv.hasMention).toBe(false);
  });

  test('具名 @用户名 → 被点名成员 hasMention=true（不受角色限制，回归）', async () => {
    const owner = await makeUser({ username: `ma_owner3_${ts}` });
    const m1 = await makeUser({ username: `ma_target_${ts}` });
    const m2 = await makeUser({ username: `ma_sender_${ts}` });
    await befriend(owner, m1); await befriend(owner, m2);
    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `ma群C_${ts}`, memberIds: [m1.userId, m2.userId] });
    const convId = g.body.conversationId;

    insertMsg(convId, m2.userId, `@${m1.username} 看一下`);
    const conv = await listConv(m1, convId);
    expect(conv).toBeTruthy();
    expect(conv.hasMention).toBe(true);
  });
});
