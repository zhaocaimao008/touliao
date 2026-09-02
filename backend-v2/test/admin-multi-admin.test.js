'use strict';
/**
 * 多管理员（2026-09-02）：此前只有 .env 里硬编码的单一账号，登录成功后 cookie 里
 * 一律签成 config.admin.username，也没有任何操作审计能落到"谁"头上——只有一个人能有。
 *
 * 核心安全约束（本测试重点覆盖）：
 *   - env 根管理员路径必须永久保留、永不受 admin_users 表状态影响（防止后台入口被锁死）
 *   - admin 角色不能新增/禁用/删除管理员账号（仅 superadmin 可以）
 *   - 不能禁用/删除 env-root
 *   - 不能禁用/删除自己
 *   - 被禁用的管理员登录必须失败
 */
const jwt = require('jsonwebtoken');
const { request, app } = require('./helpers');
const config = require('../src/config');
const svc = require('../src/modules/admin/admin.service');
const { db } = require('../src/db/connection');

function tokenFor({ username, role, adminId }) {
  const csrf = 'multiadm-csrf-token';
  return jwt.sign({ admin: true, username, role, adminId, csrf }, config.adminJwtSecret, {
    algorithm: 'HS256', expiresIn: '1h',
  });
}

function adminReq(method, path, identity) {
  return request(app)[method](`/api/admin${path}`)
    .set('Cookie', `touliao_admin_token=${tokenFor(identity)}`)
    .set('X-CSRF-Token', 'multiadm-csrf-token');
}

const SUPER = { username: config.admin.username, role: 'superadmin', adminId: 'env-root' };

describe('verifyCredentials（服务层单测）', () => {
  test('env 根管理员账号密码正确 → 返回 superadmin/env-root 身份', () => {
    const identity = svc.verifyCredentials(config.admin.username, config.admin.password);
    expect(identity).toEqual({ username: config.admin.username, role: 'superadmin', adminId: 'env-root' });
  });

  test('env 账号密码错误 → 401', () => {
    expect(() => svc.verifyCredentials(config.admin.username, 'wrong-password')).toThrow();
  });

  test('DB 管理员创建后可用真实密码登录，身份正确', async () => {
    const created = await svc.createAdmin({ username: 'mtest_login', password: 'p@ssw0rd123', role: 'admin' }, 'env-root');
    const identity = svc.verifyCredentials('mtest_login', 'p@ssw0rd123');
    expect(identity).toEqual({ username: 'mtest_login', role: 'admin', adminId: created.id });
  });

  test('被禁用的管理员无法通过 verifyCredentials', async () => {
    const created = await svc.createAdmin({ username: 'mtest_disabled', password: 'p@ssw0rd123', role: 'admin' }, 'env-root');
    svc.setAdminDisabled(created.id, true, 'env-root');
    expect(() => svc.verifyCredentials('mtest_disabled', 'p@ssw0rd123')).toThrow();
  });
});

describe('管理员账号 CRUD（HTTP 层，含角色门控）', () => {
  test('superadmin 可以新增管理员', async () => {
    const res = await adminReq('post', '/admins', SUPER).send({ username: 'mtest_crud1', password: 'p@ssw0rd123', role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('mtest_crud1');
    expect(res.body.role).toBe('admin');
  });

  test('role=admin 不能新增管理员账号（403）', async () => {
    const created = await svc.createAdmin({ username: 'mtest_plain', password: 'p@ssw0rd123', role: 'admin' }, 'env-root');
    const plainIdentity = { username: 'mtest_plain', role: 'admin', adminId: created.id };
    const res = await adminReq('post', '/admins', plainIdentity).send({ username: 'mtest_x', password: 'p@ssw0rd123' });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT 1 FROM admin_users WHERE username=?').get('mtest_x')).toBeUndefined();
  });

  test('role=admin 不能禁用/删除其他管理员账号（403）', async () => {
    const created = await svc.createAdmin({ username: 'mtest_plain2', password: 'p@ssw0rd123', role: 'admin' }, 'env-root');
    const target = await svc.createAdmin({ username: 'mtest_target', password: 'p@ssw0rd123', role: 'admin' }, 'env-root');
    const plainIdentity = { username: 'mtest_plain2', role: 'admin', adminId: created.id };
    const disableRes = await adminReq('put', `/admins/${target.id}/disabled`, plainIdentity).send({ disabled: true });
    expect(disableRes.status).toBe(403);
    const deleteRes = await adminReq('delete', `/admins/${target.id}`, plainIdentity);
    expect(deleteRes.status).toBe(403);
  });

  test('不能禁用/删除 env-root', async () => {
    const disableRes = await adminReq('put', '/admins/env-root/disabled', SUPER).send({ disabled: true });
    expect(disableRes.status).toBe(400);
    const deleteRes = await adminReq('delete', '/admins/env-root', SUPER);
    expect(deleteRes.status).toBe(400);
  });

  test('不能禁用/删除自己', async () => {
    const created = await svc.createAdmin({ username: 'mtest_self', password: 'p@ssw0rd123', role: 'superadmin' }, 'env-root');
    const selfIdentity = { username: 'mtest_self', role: 'superadmin', adminId: created.id };
    const disableRes = await adminReq('put', `/admins/${created.id}/disabled`, selfIdentity).send({ disabled: true });
    expect(disableRes.status).toBe(400);
    const deleteRes = await adminReq('delete', `/admins/${created.id}`, selfIdentity);
    expect(deleteRes.status).toBe(400);
  });

  test('删除不存在的管理员返回 404', async () => {
    const res = await adminReq('delete', '/admins/does-not-exist', SUPER);
    expect(res.status).toBe(404);
  });

  test('重复用户名创建失败', async () => {
    await svc.createAdmin({ username: 'mtest_dup', password: 'p@ssw0rd123', role: 'admin' }, 'env-root');
    const res = await adminReq('post', '/admins', SUPER).send({ username: 'mtest_dup', password: 'p@ssw0rd456', role: 'admin' });
    expect(res.status).toBe(400);
  });

  test('用户名占用 env 根账号用户名时创建失败', async () => {
    const res = await adminReq('post', '/admins', SUPER).send({ username: config.admin.username, password: 'p@ssw0rd123', role: 'admin' });
    expect(res.status).toBe(400);
  });

  test('listAdmins 包含 env-root 合成行', async () => {
    const res = await adminReq('get', '/admins', SUPER);
    expect(res.status).toBe(200);
    expect(res.body.find(a => a.id === 'env-root')?.username).toBe(config.admin.username);
  });

  test('未带管理员 cookie 返回 401/403', async () => {
    const res = await request(app).get('/api/admin/admins');
    expect([401, 403]).toContain(res.status);
  });
});

describe('POST /api/admin/login 端到端：签发的 cookie 携带真实身份', () => {
  test('DB 管理员用真实密码走完整登录流程，JWT 里是自己的身份而非 env 账号', async () => {
    await svc.createAdmin({ username: 'mtest_e2e', password: 'p@ssw0rd123', role: 'admin' }, 'env-root');
    const res = await request(app).post('/api/admin/login').send({ username: 'mtest_e2e', password: 'p@ssw0rd123' });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('mtest_e2e');
    const setCookie = res.headers['set-cookie'] || [];
    const tokenCookie = setCookie.find(c => c.startsWith(`${config.admin.cookieName}=`));
    expect(tokenCookie).toBeTruthy();
    const token = tokenCookie.split(';')[0].split('=')[1];
    const payload = jwt.verify(token, config.adminJwtSecret);
    expect(payload.username).toBe('mtest_e2e');
    expect(payload.role).toBe('admin');
    expect(payload.username).not.toBe(config.admin.username);
  });
});
