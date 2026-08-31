'use strict';
/**
 * 核心流程回归："关注"。
 *
 * 说明：投聊没有独立于"好友"的单向关注/粉丝模型（已在 AUDIT.md 第十三节确认），
 * 关系只有双向好友（friend_requests → contacts）。这里按最接近的真实功能
 * ——发送好友请求 / 接受 / 拒绝——覆盖同等语义的正常路径与异常路径。
 */
const { request, app, makeUser } = require('./helpers');

describe('好友请求（"关注"的等价功能）', () => {
  test('正常路径：发送好友请求 → 对方能在待处理列表看到 → 接受后互为好友', async () => {
    const a = await makeUser({ username: 'friend_a' });
    const b = await makeUser({ username: 'friend_b' });

    const send = await request(app).post('/api/users/friend-request')
      .set('Authorization', `Bearer ${a.token}`).send({ toId: b.userId });
    expect(send.status).toBe(200);

    const received = await request(app).get('/api/users/friend-requests')
      .set('Authorization', `Bearer ${b.token}`);
    const reqId = received.body.find(r => r.from_id === a.userId)?.id;
    expect(reqId).toBeTruthy();

    const handled = await request(app).post(`/api/users/friend-request/${reqId}/handle`)
      .set('Authorization', `Bearer ${b.token}`).send({ action: 'accept' });
    expect(handled.status).toBe(200);

    const contactsOfA = await request(app).get('/api/users/contacts').set('Authorization', `Bearer ${a.token}`);
    expect(contactsOfA.body.some(c => c.id === b.userId)).toBe(true);
    const contactsOfB = await request(app).get('/api/users/contacts').set('Authorization', `Bearer ${b.token}`);
    expect(contactsOfB.body.some(c => c.id === a.userId)).toBe(true);
  });

  test('异常路径：不能添加自己为好友 → 400', async () => {
    const a = await makeUser({ username: 'friend_self' });
    const res = await request(app).post('/api/users/friend-request')
      .set('Authorization', `Bearer ${a.token}`).send({ toId: a.userId });
    expect(res.status).toBe(400);
  });

  test('异常路径：未登录发送好友请求 → 401', async () => {
    const b = await makeUser({ username: 'friend_target' });
    const res = await request(app).post('/api/users/friend-request').send({ toId: b.userId });
    expect(res.status).toBe(401);
  });

  test('异常路径：对方已拉黑自己时发送好友请求 → 403', async () => {
    const a = await makeUser({ username: 'friend_blocked_a' });
    const b = await makeUser({ username: 'friend_blocked_b' });
    const block = await request(app).post(`/api/users/block/${a.userId}`).set('Authorization', `Bearer ${b.token}`);
    expect(block.status).toBe(200);

    const send = await request(app).post('/api/users/friend-request')
      .set('Authorization', `Bearer ${a.token}`).send({ toId: b.userId });
    expect(send.status).toBe(403);
  });

  test('异常路径：重复发送同一条待处理好友请求 → 400（防重复刷请求）', async () => {
    const a = await makeUser({ username: 'friend_dup_a' });
    const b = await makeUser({ username: 'friend_dup_b' });
    const first = await request(app).post('/api/users/friend-request')
      .set('Authorization', `Bearer ${a.token}`).send({ toId: b.userId });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/users/friend-request')
      .set('Authorization', `Bearer ${a.token}`).send({ toId: b.userId });
    expect(second.status).toBe(400);
  });
});
