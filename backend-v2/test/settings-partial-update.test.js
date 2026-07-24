'use strict';
/**
 * 回归：设置局部更新契约 + 资料更新返回 phone。
 *
 * 背景：客户端「只传要改的字段」，后端 normalizeSettings 以 `body[k] !== undefined`
 * 判定。若客户端把未改字段序列化成 JSON null（Android kotlinx explicitNulls 默认 true 的坑），
 * 后端会把 null 当 false，改一个开关误关其它所有开关。本测试锁定：
 *   1) 只传一个字段时，其它设置保持不变；
 *   2) 显式传 null 才是「危险输入」——用于说明为何客户端必须省略 null（此处不发 null，
 *      仅验证正常局部更新的正确性）。
 * 另：锁定 PUT /users/profile 返回体含 phone（与 getMe 一致，避免客户端整体替换丢手机号）。
 */
const { request, app, makeUser } = require('./helpers');

describe('设置局部更新 & 资料返回 phone', () => {
  let u;
  beforeAll(async () => {
    const ts = Date.now().toString().slice(-8);
    u = await makeUser({ username: `setpatch_${ts}` });
  });

  test('只改 messageNotify=false，其它开关保持默认不变', async () => {
    // 默认：addByVxinId/addByPhone/requireVerify=true
    const before = await request(app).get('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`);
    expect(before.status).toBe(200);
    expect(before.body.addByVxinId).toBe(true);
    expect(before.body.requireVerify).toBe(true);

    const put = await request(app).put('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ messageNotify: false });     // 仅传一个字段（正确的局部更新）
    expect(put.status).toBe(200);

    const after = await request(app).get('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`);
    expect(after.body.messageNotify).toBe(false);   // 目标字段已改
    expect(after.body.addByVxinId).toBe(true);      // 其它字段不受影响
    expect(after.body.addByPhone).toBe(true);
    expect(after.body.requireVerify).toBe(true);
    expect(after.body.sound).toBe(true);
  });

  test('PUT /users/profile 返回体包含 phone（与 getMe 一致）', async () => {
    const res = await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ bio: '签名测试' });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe(u.phone);   // 关键：不再丢失 phone
    expect(res.body.bio).toBe('签名测试');
  });
});
