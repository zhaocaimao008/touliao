'use strict';
/**
 * 核心流程回归：发消息（HTTP 路径 POST /api/messages/:conversationId）。
 * 正常路径 + 至少两个异常路径。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');

describe('发消息', () => {
  test('正常路径：好友私聊发文本消息成功，历史记录里能查到', async () => {
    const a = await makeUser({ username: 'msg_a' });
    const b = await makeUser({ username: 'msg_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const send = await request(app).post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`).send({ content: '你好，在吗' });
    expect(send.status).toBe(200);
    expect(send.body.content).toBe('你好，在吗');
    expect(send.body.sender_id).toBe(a.userId);

    const history = await request(app).get(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(history.status).toBe(200);
    expect(history.body.some(m => m.content === '你好，在吗')).toBe(true);
  });

  test('异常路径：向自己不是成员的会话发消息 → 403', async () => {
    const a = await makeUser({ username: 'msg_c' });
    const b = await makeUser({ username: 'msg_d' });
    const stranger = await makeUser({ username: 'msg_stranger' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const res = await request(app).post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${stranger.token}`).send({ content: '我混进来了' });
    expect(res.status).toBe(403);
  });

  test('异常路径：消息内容为空 → 400，不应 500', async () => {
    const a = await makeUser({ username: 'msg_e' });
    const b = await makeUser({ username: 'msg_f' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const res = await request(app).post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`).send({ content: '' });
    expect(res.status).toBe(400);
  });

  test('异常路径：未登录发消息 → 401', async () => {
    const a = await makeUser({ username: 'msg_g' });
    const b = await makeUser({ username: 'msg_h' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const res = await request(app).post(`/api/messages/${convId}`).send({ content: '匿名消息' });
    expect(res.status).toBe(401);
  });

  test('异常路径：向不存在的会话ID发消息 → 403（非成员，不泄露"会话是否存在"）', async () => {
    const a = await makeUser({ username: 'msg_i' });
    const res = await request(app).post('/api/messages/not-a-real-conversation-id')
      .set('Authorization', `Bearer ${a.token}`).send({ content: '发给幽灵会话' });
    expect(res.status).toBe(403);
  });
});
