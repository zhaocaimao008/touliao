'use strict';
/**
 * 注册邀请码总开关（admin_settings.invite_required）。
 * 默认需要邀请码；后台关闭后无需邀请码即可注册；重新开启后恢复强制校验。
 * 隔离测试库，见 testEnv.js。
 */
const { request, app } = require('./helpers');
const { db } = require('../src/db/connection');

function setInviteRequired(on) {
  db.prepare(`
    INSERT INTO admin_settings (key, value, updated_at) VALUES ('invite_required', ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(on ? 'on' : 'off');
}

const uniq = () => Math.random().toString(36).slice(2, 8);

afterAll(() => setInviteRequired(true)); // 复位，避免污染同库其它用例

describe('注册邀请码总开关', () => {
  test('默认需要邀请码：不填被拒', async () => {
    setInviteRequired(true);
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'inv_' + uniq(), phone: '138' + Date.now().toString().slice(-8), password: 'abc12345' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/邀请码/);
  });

  test('关闭后无需邀请码也能注册', async () => {
    setInviteRequired(false);
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'inv_' + uniq(), phone: '139' + Date.now().toString().slice(-8), password: 'abc12345' });
    expect(res.status).toBe(200);
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.token).toBeTruthy();
  });

  test('/api/config 暴露 inviteRequired 供前端读取', async () => {
    setInviteRequired(false);
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.features.inviteRequired).toBe(false);
    setInviteRequired(true);
    const res2 = await request(app).get('/api/config');
    expect(res2.body.features.inviteRequired).toBe(true);
  });

  test('重新开启后又强制校验邀请码', async () => {
    setInviteRequired(true);
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'inv_' + uniq(), phone: '137' + Date.now().toString().slice(-8), password: 'abc12345' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/邀请码/);
  });
});
