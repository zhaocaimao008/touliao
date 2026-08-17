'use strict';
/**
 * P1-01 忘记密码账号接管修复测试
 *
 * 背景：原实现「手机号 + 用户专属邀请码」即可重置密码。邀请码是 6 位数字且随
 * 邀请行为传播，不是安全凭证；且平台无短信/邮箱验证码投递能力。
 * 修复策略：公开重置通道统一拒绝（不区分手机号是否存在，防枚举），
 * 密码重置走管理员通道（adminAuth 保护）。
 *
 * 覆盖：错误手机号 / 不存在用户 / 错误邀请码 / 正确凭证也不放行 /
 *       防枚举（响应一致）/ 密码未被篡改 / 旧密码仍可登录
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser } = require('./helpers');

describe('P1-01 忘记密码账号接管修复', () => {
  let victim;

  beforeAll(async () => {
    victim = await makeUser();
  });

  test('正确手机号+正确邀请码+新密码 → 统一拒绝（403/400 业务错误，不执行重置）', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({
        phone: victim.phone,
        inviteCode: '123456', // 即使传对邀请码也不得放行
        newPassword: 'hacked1234',
      });
    expect([400, 403]).toContain(res.status);
    expect(res.body.success).not.toBe(true);
  });

  test('原密码仍可登录 → 密码未被篡改', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: victim.phone, password: victim.password });
    expect(login.status).toBe(200);
  });

  test('不存在用户 → 与存在用户返回一致错误（防枚举）', async () => {
    const ghost = await request(app)
      .post('/api/auth/reset-password')
      .send({ phone: '+86-19900000000', inviteCode: '123456', newPassword: 'hacked1234' });
    const real = await request(app)
      .post('/api/auth/reset-password')
      .send({ phone: victim.phone, inviteCode: '999999', newPassword: 'hacked1234' });
    expect(ghost.status).toBe(real.status);
    expect(ghost.body.error).toBe(real.body.error);
  });

  test('错误手机号格式 → 400', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ phone: 'abc', inviteCode: '123456', newPassword: 'hacked1234' });
    expect(res.status).toBe(400);
  });

  test('缺字段 → 400', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({});
    expect(res.status).toBe(400);
  });

  test('新密码强度弱 → 400（即使凭证正确也先被拒绝）', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ phone: victim.phone, inviteCode: '123456', newPassword: '123' });
    expect(res.status).toBe(400);
  });

  test('不泄露内部信息：错误响应不含 stack/SQL/内部路径', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ phone: victim.phone, inviteCode: '123456', newPassword: 'hacked1234' });
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/stack|at\s+\w+\.js|Error:/i);
  });
});
