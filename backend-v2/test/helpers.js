'use strict';
/**
 * 测试辅助：造号 + 加好友。全部走真实 HTTP 接口（supertest），
 * 用 Bearer token 鉴权（与 Electron/移动端一致，天然免 CSRF）。
 */
require('./testEnv');
const request = require('supertest');
const app = require('../src/app');

const INVITE_CODE = process.env.INVITE_CODE || '123456';
let seq = 0;

/** 注册一个全新用户，返回 { token, userId, phone, password, username }。 */
async function makeUser(overrides = {}) {
  seq += 1;
  const uniq = `${Date.now().toString().slice(-7)}${seq}`;
  const user = {
    phone: overrides.phone || `+86-13${uniq}`.slice(0, 18),
    password: overrides.password || 'passw0rd123456',
    username: overrides.username || `u_${uniq}`,
    inviteCode: INVITE_CODE,
  };
  const res = await request(app).post('/api/auth/register').send(user);
  if (res.status >= 400) {
    throw new Error(`makeUser 注册失败 ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return {
    token: res.body.token,
    userId: res.body.user.id,
    phone: user.phone,
    password: user.password,
    username: user.username,
  };
}

/** 让 a、b 互为好友：a 发请求 → b 接受。 */
async function befriend(a, b) {
  const send = await request(app)
    .post('/api/users/friend-request')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ toId: b.userId });
  if (send.status >= 400) throw new Error(`befriend 发送失败 ${send.status}: ${JSON.stringify(send.body)}`);

  const received = await request(app)
    .get('/api/users/friend-requests')
    .set('Authorization', `Bearer ${b.token}`);
  const req = (received.body || []).find(r => r.from_id === a.userId) || received.body[0];
  if (!req) throw new Error('befriend 未找到待处理好友请求');

  const handled = await request(app)
    .post(`/api/users/friend-request/${req.id}/handle`)
    .set('Authorization', `Bearer ${b.token}`)
    .send({ action: 'accept' });
  if (handled.status >= 400) throw new Error(`befriend 接受失败 ${handled.status}: ${JSON.stringify(handled.body)}`);
}

/** 建私聊会话，返回 conversationId。 */
async function privateConversation(a, b) {
  const res = await request(app)
    .post('/api/messages/conversation/private')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ userId: b.userId });
  if (res.status >= 400) throw new Error(`建私聊失败 ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.conversationId;
}

module.exports = { app, request, makeUser, befriend, privateConversation, INVITE_CODE };
