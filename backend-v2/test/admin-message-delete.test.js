'use strict';
/**
 * 管理员撤回消息（内容审核，2026-09-02）：后台之前只能查看/搜索消息，没有删除按钮——
 * 能看到问题消息却按不了删除。补 DELETE /api/admin/messages/:id，复用普通撤回同一套
 * DB 语义（deleted=2/清内容/message_recall 广播），跳过会话成员/角色校验。
 */
const jwt = require('jsonwebtoken');
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const config = require('../src/config');
const { db } = require('../src/db/connection');

function adminToken() {
  const csrf = 'admmsgdel-csrf-token';
  return jwt.sign(
    { admin: true, username: config.admin.username, csrf },
    config.adminJwtSecret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

function adminDelete(msgId) {
  return request(app)
    .delete(`/api/admin/messages/${msgId}`)
    .set('Cookie', `touliao_admin_token=${adminToken()}`)
    .set('X-CSRF-Token', 'admmsgdel-csrf-token');
}

describe('管理员撤回消息', () => {
  test('撤回一条正常消息：内容清空、deleted=2', async () => {
    const a = await makeUser({ username: 'admmsg_a' });
    const b = await makeUser({ username: 'admmsg_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const sendRes = await request(app)
      .post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ content: '违规内容测试', type: 'text' });
    expect(sendRes.status).toBeLessThan(400);
    const msgId = sendRes.body.id;

    const res = await adminDelete(msgId);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = db.prepare('SELECT deleted, content, file_url FROM messages WHERE id=?').get(msgId);
    expect(row.deleted).toBe(2);
    expect(row.content).toBe('');
    expect(row.file_url).toBe('');
  });

  test('撤回不存在的消息返回 404', async () => {
    const res = await adminDelete('does-not-exist');
    expect(res.status).toBe(404);
  });

  test('重复撤回同一条消息是幂等的（第二次仍 200，不报错）', async () => {
    const a = await makeUser({ username: 'admmsg_idem_a' });
    const b = await makeUser({ username: 'admmsg_idem_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    const sendRes = await request(app)
      .post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ content: '再次撤回测试', type: 'text' });
    const msgId = sendRes.body.id;

    const first = await adminDelete(msgId);
    expect(first.status).toBe(200);
    const second = await adminDelete(msgId);
    expect(second.status).toBe(200);
  });

  test('未带管理员 cookie 返回 401/403', async () => {
    const res = await request(app).delete('/api/admin/messages/whatever');
    expect([401, 403]).toContain(res.status);
  });
});
