'use strict';
/**
 * 已封禁账号对其他用户的可见性（2026-09-04）。
 *
 * 加固前：banned=1 只在 middleware/auth.js 拦被封者**自己**的 token，对其他人完全不可见。
 * 被封账号照样能被搜到、被加好友、被扫码添加、被建新会话、被发消息——
 * 对一个带审核功能的 IM 来说这是实打实的洞：封了骚扰者，别人还当他是正常用户在聊，
 * 发出去的消息进库后永远没人看得到。
 *
 * 现实触发场景：AI 助手下线后，两个 bot 账号退化成普通用户留在真实用户的通讯录里，
 * 对方永不回话——正是这类"发进黑洞"的消息。
 *
 * 关键边界：**已存在的会话必须仍能打开**（否则历史消息直接失联），
 * 只是往里发消息会被挡住并给出明确提示。最后两个用例锁的就是这条。
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser, befriend } = require('./helpers');
const { db } = require('../src/db/connection');

function ban(userId) {
  db.prepare('UPDATE users SET banned=1 WHERE id=?').run(userId);
  // 驱逐 auth 的状态缓存，避免 30s TTL 让封禁延迟生效
  try { require('../src/utils/userStatusCache').invalidateUser?.(userId); } catch { /* 可选 */ }
}

describe('已封禁账号对其他用户不可见', () => {
  let me, bad;
  beforeAll(async () => {
    me = await makeUser();
    bad = await makeUser();
  });

  test('封禁后：搜索不再返回该账号', async () => {
    const before = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(bad.username)}`)
      .set('Authorization', `Bearer ${me.token}`);
    expect(before.status).toBe(200);
    expect(before.body.some(u => u.id === bad.userId)).toBe(true);   // 封禁前搜得到

    ban(bad.userId);

    const after = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(bad.username)}`)
      .set('Authorization', `Bearer ${me.token}`);
    expect(after.status).toBe(200);
    expect(after.body.some(u => u.id === bad.userId)).toBe(false);   // 封禁后搜不到
  });

  test('封禁后：不能向该账号发好友申请', async () => {
    const res = await request(app)
      .post('/api/users/friend-request')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ toId: bad.userId });
    expect(res.status).toBe(404);          // 与"不存在"同样处理，不泄露账号是否存在
  });

  test('封禁后：不能与该账号新建私聊', async () => {
    const res = await request(app)
      .post('/api/messages/conversation/private')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ userId: bad.userId });
    expect([403, 404]).toContain(res.status);
  });
});

describe('已存在的会话不被封禁打断（历史不能失联）', () => {
  let a, b, convId;
  beforeAll(async () => {
    a = await makeUser();
    b = await makeUser();
    await befriend(a, b);
    const conv = await request(app)
      .post('/api/messages/conversation/private')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ userId: b.userId });
    convId = conv.body.conversationId;
    expect(convId).toBeTruthy();
    // 先发一条，制造历史
    await request(app)
      .post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ content: '封禁前的历史消息', type: 'text' });
    ban(b.userId);
  });

  test('对方被封后：仍能打开该会话并读到历史', async () => {
    const res = await request(app)
      .get(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.some(m => m.content === '封禁前的历史消息')).toBe(true);
  });

  test('对方被封后：getOrCreatePrivate 命中已有会话仍返回同一个 id，不报错', async () => {
    const res = await request(app)
      .post('/api/messages/conversation/private')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ userId: b.userId });
    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBe(convId);
  });

  test('对方被封后：往里发消息被明确拒绝，而不是静默进黑洞', async () => {
    const res = await request(app)
      .post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ content: '还能发出去吗', type: 'text' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(String(res.body.error || '')).toContain('停用');
  });
});
