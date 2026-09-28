'use strict';
/**
 * 真实开启限流的用例。
 * testEnv 全局设 DISABLE_RATE_LIMIT=1（批量造号/发消息不被 429 挡），依赖 429 的用例在别的文件里永远
 * 跑不到；本文件在加载应用前删掉该开关（Jest 每个测试文件独立模块表，不影响其他文件）。
 */
require('./testEnv');
delete process.env.DISABLE_RATE_LIMIT;
// 用进程内存储验证限流行为本身：共享 Redis 里的计数会跨运行残留（结果依赖外部状态），
// 共享存储由 shared-rate-limit.test.js 单独覆盖
delete process.env.REDIS_URL;
const { request, app, makeUser } = require('./helpers');
const legalConsent = require('./legal-consent.cjs');

describe('限流（开启）', () => {
  test('同一账号连续登录失败 5 次后被限流 429，其他账号不受影响', async () => {
    const user = await makeUser({ username: 'rl_on_a', phone: '13900000901' });
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post('/api/auth/login')
        .send({ phone: user.phone, password: 'wrong-password-x1', legalConsent });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every(s => s === 400 || s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
    const other = await makeUser({ username: 'rl_on_b', phone: '13900000902' });
    const ok = await request(app).post('/api/auth/login').send({ phone: other.phone, password: other.password, legalConsent });
    expect(ok.status).toBe(200);
  });

  test('后台登录按用户名锁定：换 IP 也不能继续猜', async () => {
    const statuses = [];
    for (let i = 0; i < 21; i++) {
      const res = await request(app).post('/api/admin/login')
        .set('X-Forwarded-For', `198.51.100.${i + 1}`) // 每次来自不同 IP，按 IP 的限流拦不住
        .send({ username: process.env.ADMIN_USERNAME, password: `wrong-${i}` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every(s => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
    // 两条后台登录路径共用计数
    const alt = await request(app).post('/api/vxin-admin-login').set('X-Forwarded-For', '198.51.100.200')
      .send({ username: process.env.ADMIN_USERNAME, password: 'wrong-alt' });
    expect(alt.status).toBe(429);
  });
});
