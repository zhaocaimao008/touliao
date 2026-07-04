'use strict';
/**
 * 回归（round47）：新建会话 / 加成员时，必须让在线成员的 socket 即时加入会话房间。
 *
 * bug：socket 只在 connection 时从 conversation_members 一次性 join 房间(房间名=conversationId)；
 * 消息广播 broadcaster.broadcastMessage(convId) 只 emit 到该房间。两名已在线用户新建会话/入群后，
 * 谁都没 join 新房间 → 首条消息只发到空房间，接收方要等 socket 重连才实时收到(且非离线、无推送兜底)。
 * kick/leave 早已用 io.in(`user_x`).socketsLeave(convId) 维护房间，唯独"加入"路径漏了对称的 socketsJoin。
 *
 * 用真实 HTTP 触发建会话，注入 mock io 记录 socketsJoin 调用，断言每个成员的 user_ 房间都入了会话房间。
 */
const { request, app, makeUser, befriend } = require('./helpers');

describe('新建会话/加成员时在线成员即时入房间（round47 回归）', () => {
  let realIo;
  let joins; // [{ room: 'user_X', target: convId }]

  beforeAll(() => {
    realIo = app.get('io');
    const chain = (room) => ({
      socketsJoin: (target) => { joins.push({ room, target }); },
      socketsLeave: () => {},
      emit: () => {},
    });
    app.set('io', { in: chain, to: chain });
  });
  afterAll(() => { app.set('io', realIo); });
  beforeEach(() => { joins = []; });

  const roomsForConv = (convId) => joins.filter(j => j.target === convId).map(j => j.room);

  test('建群：群主与被邀成员的 user_ 房间都入群会话房间', async () => {
    const owner = await makeUser({ username: 'crj_owner' });
    const m1 = await makeUser({ username: 'crj_m1' });
    await befriend(owner, m1);
    joins = [];

    const res = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'round47群', memberIds: [m1.userId] });
    expect(res.status).toBe(200);
    const convId = res.body.conversationId;

    const rooms = roomsForConv(convId);
    expect(rooms).toContain(`user_${owner.userId}`);
    expect(rooms).toContain(`user_${m1.userId}`);
  });

  test('接受好友请求：双方 user_ 房间入同一新私聊房间', async () => {
    const a = await makeUser({ username: 'crj_a' });
    const b = await makeUser({ username: 'crj_b' });
    joins = [];
    await befriend(a, b); // requireVerify 默认开 → 走 pending→accept(handleRequest) 路径

    const aJoin = joins.find(j => j.room === `user_${a.userId}`);
    const bJoin = joins.find(j => j.room === `user_${b.userId}`);
    expect(aJoin).toBeTruthy();
    expect(bJoin).toBeTruthy();
    expect(aJoin.target).toBe(bJoin.target); // 同一会话房间
  });

  test('免验证自动互加：双方 user_ 房间入同一新私聊房间', async () => {
    const a = await makeUser({ username: 'crj_na' });
    const b = await makeUser({ username: 'crj_nb' });
    // b 关闭好友验证 → sendFriendRequest 走免验证直接互加分支
    const s = await request(app).put('/api/users/me/settings')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ requireVerify: false });
    expect(s.status).toBe(200);
    joins = [];

    const send = await request(app).post('/api/users/friend-request')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ toId: b.userId });
    expect(send.status).toBe(200);
    expect(send.body.autoAccepted).toBe(true);

    const aJoin = joins.find(j => j.room === `user_${a.userId}`);
    const bJoin = joins.find(j => j.room === `user_${b.userId}`);
    expect(aJoin).toBeTruthy();
    expect(bJoin).toBeTruthy();
    expect(aJoin.target).toBe(bJoin.target);
  });

  test('邀请入群：被邀成员 user_ 房间入群会话房间', async () => {
    const owner = await makeUser({ username: 'crj_iowner' });
    const m1 = await makeUser({ username: 'crj_im1' });
    const m2 = await makeUser({ username: 'crj_im2' });
    await befriend(owner, m1);
    await befriend(owner, m2);

    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'round47邀请群', memberIds: [m1.userId] });
    expect(g.status).toBe(200);
    const convId = g.body.conversationId;
    joins = [];

    const inv = await request(app).post(`/api/messages/conversation/${convId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userIds: [m2.userId] });
    expect(inv.status).toBe(200);

    expect(roomsForConv(convId)).toContain(`user_${m2.userId}`);
  });
});
