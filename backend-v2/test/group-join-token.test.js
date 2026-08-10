'use strict';
/**
 * 集成测试：扫码/邀请链接入群（POST /messages/join/:token）。
 * 群主建群 → 生成邀请链接 token → 第三方用户用 token 入群 → 成为成员；
 * 重复入群返回 alreadyMember；无效 token → 404。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');

describe('扫码/邀请链接入群', () => {
  let owner, invitee, convId, token;

  beforeAll(async () => {
    owner = await makeUser({ username: 'gj_owner' });
    invitee = await makeUser({ username: 'gj_invitee' });
    const other = await makeUser({ username: 'gj_other' });
    await befriend(owner, other);
    // 建群（需至少一名初始成员）
    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '入群测试群', memberIds: [other.userId] });
    expect(g.status).toBe(200);
    convId = g.body.conversationId;
    // 生成邀请链接
    const link = await request(app).post(`/api/messages/conversation/${convId}/invite-link`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(link.status).toBe(200);
    token = link.body.token;
    expect(token).toBeTruthy();
  });

  test('预览群信息（不入群）→ 返回群名/成员数，且未成为成员', async () => {
    const res = await request(app).get(`/api/messages/join/${token}/preview`)
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBe(convId);
    expect(res.body.name).toBe('入群测试群');
    expect(res.body.memberCount).toBeGreaterThanOrEqual(2);
    expect(res.body.alreadyMember).toBe(false);
  });

  test('用 token 入群 → 成功成为成员', async () => {
    const res = await request(app).post(`/api/messages/join/${token}`)
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.conversationId).toBe(convId);
  });

  test('入群后再预览 → alreadyMember=true', async () => {
    const res = await request(app).get(`/api/messages/join/${token}/preview`)
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(res.status).toBe(200);
    expect(res.body.alreadyMember).toBe(true);
  });

  test('重复入群 → alreadyMember', async () => {
    const res = await request(app).post(`/api/messages/join/${token}`)
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(res.status).toBe(200);
    expect(res.body.alreadyMember).toBe(true);
  });

  test('无效 token → 404', async () => {
    const res = await request(app).post('/api/messages/join/invalid-token-xyz')
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(res.status).toBe(404);
  });
});

describe('收藏保存来源会话/消息 id', () => {
  let u1, u2, convId, msgId;

  beforeAll(async () => {
    u1 = await makeUser({ username: 'col_u1' });
    u2 = await makeUser({ username: 'col_u2' });
    await befriend(u1, u2);
    convId = await privateConversation(u1, u2);
    const r = await request(app).post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ content: '要被收藏的消息', type: 'text' });
    msgId = r.body.id;
  });

  test('收藏消息 → extra 带 source_conv_id / source_msg_id', async () => {
    const res = await request(app).post(`/api/messages/${msgId}/collect`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(200);
    expect(res.body.extra.source_msg_id).toBe(msgId);
    expect(res.body.extra.source_conv_id).toBe(convId);
  });
});
