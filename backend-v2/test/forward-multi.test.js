'use strict';
/**
 * 集成测试：多条消息转发（forward 的 msgIds 数组路径）。
 * 建两会话 → 发多条消息 → 一次 msgIds 转发到目标会话 → 校验 sent 计数与落库条数。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');

describe('多条转发（msgIds）', () => {
  let u1, u2, u3, srcConv, dstConv;

  beforeAll(async () => {
    u1 = await makeUser({ username: 'fwd_u1' });
    u2 = await makeUser({ username: 'fwd_u2' });
    u3 = await makeUser({ username: 'fwd_u3' });
    await befriend(u1, u2);
    await befriend(u1, u3);
    srcConv = await privateConversation(u1, u2);
    dstConv = await privateConversation(u1, u3);
  });

  test('一次转发多条消息 → sent=1（目标会话数）', async () => {
    const ids = [];
    for (const c of ['第一条', '第二条', '第三条']) {
      const r = await request(app).post(`/api/messages/${srcConv}`)
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ content: c, type: 'text' });
      expect(r.status).toBe(200);
      ids.push(r.body.id);
    }
    const res = await request(app).post('/api/messages/forward')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ msgIds: ids, conversationIds: [dstConv] });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);

    // 目标会话应新增 3 条转发消息
    const hist = await request(app).get(`/api/messages/${dstConv}`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(hist.status).toBe(200);
    const contents = hist.body.map(m => m.content);
    expect(contents).toEqual(expect.arrayContaining(['第一条', '第二条', '第三条']));
  });

  test('单条 msgId 仍兼容', async () => {
    const r = await request(app).post(`/api/messages/${srcConv}`)
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ content: '单条兼容', type: 'text' });
    const res = await request(app).post('/api/messages/forward')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ msgId: r.body.id, conversationIds: [dstConv] });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
  });

  test('空参数 → 400', async () => {
    const res = await request(app).post('/api/messages/forward')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ conversationIds: [dstConv] });
    expect(res.status).toBe(400);
  });
});
