'use strict';
/**
 * 好友申请提醒优化（2026-08-29）回归：拒绝好友请求此前完全没有socket广播，
 * 同一账号多设备场景下(如手机拒绝了，电脑还停在"接受/拒绝"两个按钮上)其他设备
 * 感知不到，用户在另一台设备操作会命中"请求不存在"(该请求已非pending状态)。
 * 断言：handleRequest(action='rejected') 后，拒绝方自己的 user_ 房间收到
 * friend_request_rejected 事件，用于其他设备触发列表刷新。
 */
const { request, app, makeUser } = require('./helpers');

describe('拒绝好友请求：多设备同步广播', () => {
  let realIo;
  let emits; // [{ room, event, payload }]

  beforeAll(() => {
    realIo = app.get('io');
    const chain = (room) => ({
      socketsJoin: () => {},
      socketsLeave: () => {},
      emit: (event, payload) => { emits.push({ room, event, payload }); },
    });
    app.set('io', { in: chain, to: chain });
  });
  afterAll(() => { app.set('io', realIo); });
  beforeEach(() => { emits = []; });

  test('拒绝后，拒绝方自己的 user_ 房间收到 friend_request_rejected', async () => {
    const a = await makeUser({ username: 'frr_a' });
    const b = await makeUser({ username: 'frr_b' });

    const send = await request(app).post('/api/users/friend-request')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ toId: b.userId });
    expect(send.status).toBe(200);

    const received = await request(app).get('/api/users/friend-requests')
      .set('Authorization', `Bearer ${b.token}`);
    const reqId = received.body.find(r => r.from_id === a.userId)?.id;
    expect(reqId).toBeTruthy();

    emits = [];
    const handled = await request(app).post(`/api/users/friend-request/${reqId}/handle`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ action: 'reject' });
    expect(handled.status).toBe(200);

    const rejectEmit = emits.find(e => e.event === 'friend_request_rejected');
    expect(rejectEmit).toBeTruthy();
    expect(rejectEmit.room).toBe(`user_${b.userId}`);
    expect(rejectEmit.payload.requestId).toBe(reqId);

    // 请求方(a)不应收到这条事件——拒绝不像接受那样需要对方知晓
    const aRejectEmit = emits.find(e => e.event === 'friend_request_rejected' && e.room === `user_${a.userId}`);
    expect(aRejectEmit).toBeFalsy();
  });

  test('接受后不应触发 friend_request_rejected（互斥回归）', async () => {
    const a = await makeUser({ username: 'frr_a2' });
    const b = await makeUser({ username: 'frr_b2' });

    await request(app).post('/api/users/friend-request')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ toId: b.userId });
    const received = await request(app).get('/api/users/friend-requests')
      .set('Authorization', `Bearer ${b.token}`);
    const reqId = received.body.find(r => r.from_id === a.userId)?.id;

    emits = [];
    const handled = await request(app).post(`/api/users/friend-request/${reqId}/handle`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ action: 'accept' });
    expect(handled.status).toBe(200);
    expect(emits.some(e => e.event === 'friend_request_rejected')).toBe(false);
  });
});
