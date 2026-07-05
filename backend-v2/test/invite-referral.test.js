'use strict';
/**
 * 每用户专属邀请码 + 邀请关系（裂变）。
 * - 每个新用户注册后拿到自己的 6 位专属邀请码（GET /me/invite）
 * - 用他人的专属码注册 → 记录邀请关系，被邀者计入邀请人的战绩
 * - 管理员全局码仍可注册（不产生邀请关系）
 * 隔离测试库，见 testEnv.js。
 */
const { request, app, makeUser, INVITE_CODE } = require('./helpers');

const authGet = (path, token) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const uniq = () => `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;

describe('专属邀请码与邀请关系', () => {
  test('注册后拥有 6 位专属邀请码', async () => {
    const a = await makeUser({ username: 'inviter_' + uniq() });
    const res = await authGet('/api/users/me/invite', a.token);
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^\d{6}$/);
    expect(res.body.invitedCount).toBe(0);
    expect(res.body.invitees).toEqual([]);
  });

  test('用他人专属码注册 → 记录邀请关系并计入战绩', async () => {
    const inviter = await makeUser({ username: 'inviter2_' + uniq() });
    const { code } = (await authGet('/api/users/me/invite', inviter.token)).body;

    // 新用户用 inviter 的专属码注册
    const u = uniq();
    const reg = await request(app).post('/api/auth/register').send({
      username: 'invitee_' + u, phone: `+86-14${u}`.slice(0, 18),
      password: 'passw0rd123456', inviteCode: code,
    });
    expect(reg.status).toBe(200);

    const after = (await authGet('/api/users/me/invite', inviter.token)).body;
    expect(after.invitedCount).toBe(1);
    expect(after.invitees[0].username).toBe('invitee_' + u);
  });

  test('管理员全局码仍可注册，且不产生邀请关系', async () => {
    const u = uniq();
    const reg = await request(app).post('/api/auth/register').send({
      username: 'global_' + u, phone: `+86-15${u}`.slice(0, 18),
      password: 'passw0rd123456', inviteCode: INVITE_CODE,
    });
    expect(reg.status).toBe(200);
    // 全局码注册者：登录后查自己的 invite，invitedCount=0（没人被它邀请），且自己有专属码
    const me = (await authGet('/api/users/me/invite', reg.body.token)).body;
    expect(me.code).toMatch(/^\d{6}$/);
    expect(me.invitedCount).toBe(0);
  });

  test('无效邀请码仍被拒', async () => {
    const u = uniq();
    const reg = await request(app).post('/api/auth/register').send({
      username: 'bad_' + u, phone: `+86-16${u}`.slice(0, 18),
      password: 'passw0rd123456', inviteCode: '000001',
    });
    expect(reg.status).toBe(400);
    expect(reg.body.error).toMatch(/邀请码/);
  });
});
