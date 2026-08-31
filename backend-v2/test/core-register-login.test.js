'use strict';
/**
 * 核心流程回归：注册 / 登录。
 * 正常路径 + 至少两个异常路径（覆盖 CTO 要求的最小矩阵）。
 */
const { request, app, INVITE_CODE } = require('./helpers');

describe('注册', () => {
  test('正常路径：手机号+密码+邀请码注册成功，返回 token 与 user', async () => {
    const phone = `+86-13${Date.now().toString().slice(-8)}`;
    const res = await request(app).post('/api/auth/register').send({
      phone, password: 'passw0rd123456', username: `reg_${Date.now()}`, inviteCode: INVITE_CODE,
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.phone).toBe(phone);
    // 密码不应该在响应体里原样或哈希形式出现
    expect(JSON.stringify(res.body)).not.toMatch(/passw0rd123456/);
  });

  test('异常路径：手机号已被注册 → 400', async () => {
    const phone = `+86-13${Date.now().toString().slice(-8)}1`;
    const payload = { phone, password: 'passw0rd123456', username: `dup_${Date.now()}`, inviteCode: INVITE_CODE };
    const first = await request(app).post('/api/auth/register').send(payload);
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/auth/register').send({ ...payload, username: `dup2_${Date.now()}` });
    expect(second.status).toBe(400);
  });

  test('异常路径：密码不满足强度要求（纯数字，无字母）→ 400', async () => {
    const phone = `+86-13${Date.now().toString().slice(-8)}2`;
    const res = await request(app).post('/api/auth/register').send({
      phone, password: '123456789', username: `weak_${Date.now()}`, inviteCode: INVITE_CODE,
    });
    expect(res.status).toBe(400);
  });

  test('异常路径：缺失必填字段（无密码）→ 400，不应 500', async () => {
    const res = await request(app).post('/api/auth/register').send({ phone: '+86-13900000000' });
    expect(res.status).toBe(400);
  });
});

describe('登录', () => {
  let seededPhone, seededPassword;

  beforeAll(async () => {
    seededPhone = `+86-13${Date.now().toString().slice(-8)}9`;
    seededPassword = 'passw0rd123456';
    const reg = await request(app).post('/api/auth/register').send({
      phone: seededPhone, password: seededPassword, username: `login_${Date.now()}`, inviteCode: INVITE_CODE,
    });
    expect(reg.status).toBe(200);
  });

  test('正常路径：正确手机号+密码登录成功', async () => {
    const res = await request(app).post('/api/auth/login').send({ phone: seededPhone, password: seededPassword });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  test('异常路径：密码错误 → 400，且错误提示不区分"账号不存在"与"密码错误"', async () => {
    const res = await request(app).post('/api/auth/login').send({ phone: seededPhone, password: 'wrongPassw0rd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('手机号或密码错误');
  });

  test('异常路径：手机号不存在 → 400，错误提示与"密码错误"一致（防枚举）', async () => {
    const res = await request(app).post('/api/auth/login').send({ phone: '+86-13000000099', password: 'whatever123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('手机号或密码错误');
  });

  test('异常路径：登录成功后 token 能通过 /api/auth/me 换回本人信息', async () => {
    const login = await request(app).post('/api/auth/login').send({ phone: seededPhone, password: seededPassword });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.phone).toBe(seededPhone);
  });
});
