'use strict';
/**
 * 个人码扫码消费端点：POST /api/users/qr/user
 * - 只读预览（用户资料 + 关系状态），不产生副作用
 * - 发好友申请仍走 POST /api/users/friend-request（零重复逻辑）
 * 隔离测试库，见 testEnv.js。
 */
const { request, app, makeUser, authHeader } = require('./helpers');
const { db } = require('../src/db/connection');
const usersSvc = require('../src/modules/users/users.service');

function qrPayloadFor(userId) {
  return usersSvc.qrPayload(userId);
}

async function scan(token, payload) {
  return request(app).post('/api/users/qr/user').set('Authorization', `Bearer ${token}`).send({ payload });
}

describe('个人码扫码消费端点', () => {
  test('正常扫码：返回用户资料 + relation.canAdd=true', async () => {
    const a = await makeUser({ username: 'qr_scan_a' });
    const b = await makeUser({ username: 'qr_scan_b' });
    const payload = qrPayloadFor(b.userId);

    const res = await scan(a.token, payload);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(b.userId);
    expect(res.body.user.username).toBe(b.username);
    expect(res.body.relation).toMatchObject({
      isFriend: false, blockedByMe: false, blockedByThem: false,
      pendingSent: false, pendingReceived: false, canAdd: true,
    });
  });

  test('payload 非 JSON → 400 无效的二维码', async () => {
    const a = await makeUser({ username: 'qr_bad1' });
    const res = await scan(a.token, 'not-json-at-all');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/无效的二维码/);
  });

  test('type 非 vxin-user（如群码 URL）→ 400', async () => {
    const a = await makeUser({ username: 'qr_bad2' });
    const res = await scan(a.token, 'https://touliao.cc/join/ABCDEF123456');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/无效的二维码/);
  });

  test('用户不存在 → 404', async () => {
    const a = await makeUser({ username: 'qr_missing' });
    const res = await scan(a.token, JSON.stringify({ type: 'vxin-user', v: 1, id: 'no-such-user-id' }));
    expect(res.status).toBe(404);
  });

  test('扫自己的码 → 400', async () => {
    const a = await makeUser({ username: 'qr_self' });
    const res = await scan(a.token, qrPayloadFor(a.userId));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/不能添加自己/);
  });

  test('已是好友 → isFriend=true, canAdd=false', async () => {
    const a = await makeUser({ username: 'qr_friend1' });
    const b = await makeUser({ username: 'qr_friend2' });
    const add = (uid, cid) => db.prepare('INSERT INTO contacts (id,user_id,contact_id) VALUES (?,?,?)')
      .run(`${uid}-${cid}`, uid, cid);
    add(a.userId, b.userId);
    add(b.userId, a.userId);

    const res = await scan(a.token, qrPayloadFor(b.userId));
    expect(res.status).toBe(200);
    expect(res.body.relation.isFriend).toBe(true);
    expect(res.body.relation.canAdd).toBe(false);
  });

  test('已发 pending 申请 → pendingSent=true, canAdd=false', async () => {
    const a = await makeUser({ username: 'qr_pending1' });
    const b = await makeUser({ username: 'qr_pending2' });
    db.prepare('INSERT INTO friend_requests (id,from_id,to_id,message,status) VALUES (?,?,?,?,?)')
      .run('req-pending-1', a.userId, b.userId, '', 'pending');

    const res = await scan(a.token, qrPayloadFor(b.userId));
    expect(res.status).toBe(200);
    expect(res.body.relation.pendingSent).toBe(true);
    expect(res.body.relation.canAdd).toBe(false);
  });

  test('对方已向我发申请 → pendingReceived=true, canAdd 仍为 true(点添加自动互接)', async () => {
    const a = await makeUser({ username: 'qr_rev1' });
    const b = await makeUser({ username: 'qr_rev2' });
    db.prepare('INSERT INTO friend_requests (id,from_id,to_id,message,status) VALUES (?,?,?,?,?)')
      .run('req-rev-1', b.userId, a.userId, 'hi', 'pending');

    const res = await scan(a.token, qrPayloadFor(b.userId));
    expect(res.status).toBe(200);
    expect(res.body.relation.pendingReceived).toBe(true);
    expect(res.body.relation.canAdd).toBe(true);
  });

  test('被对方拉黑 → blockedByThem=true, canAdd=false', async () => {
    const a = await makeUser({ username: 'qr_blk1' });
    const b = await makeUser({ username: 'qr_blk2' });
    db.prepare('INSERT INTO blocked_users (id,user_id,blocked_id) VALUES (?,?,?)')
      .run('blk-1', b.userId, a.userId);

    const res = await scan(a.token, qrPayloadFor(b.userId));
    expect(res.status).toBe(200);
    expect(res.body.relation.blockedByThem).toBe(true);
    expect(res.body.relation.canAdd).toBe(false);
  });
});
