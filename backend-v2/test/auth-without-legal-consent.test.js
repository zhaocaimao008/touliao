'use strict';
// 2026-09-26 起各端移除隐私政策/用户协议：注册与登录不再要求 legalConsent；
// 旧客户端仍会携带该字段（含过期版本），同样应被忽略而非拒绝。
const { app, request, INVITE_CODE } = require('./helpers');

const phone = () => `139${String(Date.now()).slice(-8)}`;

test('register and login succeed without any consent field', async () => {
  const account = { username: `nc_${Date.now()}`, phone: phone(), password: 'NoConsent123', inviteCode: INVITE_CODE };
  const reg = await request(app).post('/api/auth/register').send(account);
  expect(reg.status).toBe(200);
  const login = await request(app).post('/api/auth/login').send({ phone: account.phone, password: account.password });
  expect(login.status).toBe(200);
  expect(login.body.user.phone).toBe(account.phone);
});

test('legacy clients sending stale or unaccepted consent are not rejected', async () => {
  const account = { username: `lc_${Date.now()}`, phone: phone(), password: 'LegacyClient123', inviteCode: INVITE_CODE };
  expect((await request(app).post('/api/auth/register').send({ ...account, legalConsent: { accepted: false } })).status).toBe(200);
  const login = await request(app).post('/api/auth/login')
    .send({ phone: account.phone, password: account.password, legalConsent: { accepted: true, privacyVersion: 'old', termsVersion: 'old' } });
  expect(login.status).toBe(200);
});

// 2026-09-29 为 App Store 1.2 恢复举报与客服：接口存在，但必须登录（后台接口须管理员登录）
test('report endpoints are back and require authentication', async () => {
  expect((await request(app).post('/api/reports').send({})).status).toBe(401);
  expect((await request(app).get('/api/admin/safety-reports')).status).toBe(401);
});
