'use strict';
/**
 * 隐私：好友不能直接邀请我进群（no_direct_group_invite）
 * 开启后：建群/邀请时该用户不会被直接拉入；接口返回 blocked 计数。
 */
const { app, request, makeUser, befriend } = require('./helpers');

async function setNoDirectInvite(user, on) {
  const res = await request(app)
    .put('/api/users/me/settings')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ noDirectGroupInvite: on });
  expect(res.status).toBe(200);
  return res.body;
}

describe('隐私 · 好友不能直接邀请我进群', () => {
  test('设置可读写并正确回显', async () => {
    const u = await makeUser({ username: 'ndgi_u1' });
    const before = await request(app).get('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`);
    expect(before.status).toBe(200);
    expect(before.body.noDirectGroupInvite).toBe(false);
    const after = await setNoDirectInvite(u, true);
    expect(after.noDirectGroupInvite).toBe(true);
  });

  test('开启后：建群时不被直接拉入', async () => {
    const owner = await makeUser({ username: 'ndgi_owner' });
    const m1 = await makeUser({ username: 'ndgi_m1' });      // 正常
    const m2 = await makeUser({ username: 'ndgi_m2' });      // 开启保护
    await befriend(owner, m1);
    await befriend(owner, m2);
    await setNoDirectInvite(m2, true);

    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'ndgi建群', memberIds: [m1.userId, m2.userId] });
    expect(g.status).toBe(200);
    const convId = g.body.conversationId;

    const members = await request(app).get(`/api/messages/conversation/${convId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    const ids = (members.body || []).map(x => x.id);
    expect(ids).toContain(m1.userId);        // 正常好友入群
    expect(ids).not.toContain(m2.userId);    // 受保护好友未入群
  });

  test('开启后：邀请入群被拦截，返回 blocked=1；关闭后可正常邀请', async () => {
    const owner = await makeUser({ username: 'ndgi_owner2' });
    const m1 = await makeUser({ username: 'ndgi_seed' });
    const target = await makeUser({ username: 'ndgi_target' });
    await befriend(owner, m1);
    await befriend(owner, target);
    await setNoDirectInvite(target, true);

    const g = await request(app).post('/api/messages/conversation/group')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'ndgi邀请群', memberIds: [m1.userId] });
    const convId = g.body.conversationId;

    const inv1 = await request(app).post(`/api/messages/conversation/${convId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userIds: [target.userId] });
    expect(inv1.status).toBe(200);
    expect(inv1.body.added).toBe(0);
    expect(inv1.body.blocked).toBe(1);

    // 关闭保护后可正常邀请
    await setNoDirectInvite(target, false);
    const inv2 = await request(app).post(`/api/messages/conversation/${convId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userIds: [target.userId] });
    expect(inv2.status).toBe(200);
    expect(inv2.body.added).toBe(1);
    expect(inv2.body.blocked).toBe(0);
  });
});
