'use strict';
/**
 * 单元/接口测试 —— 认证、Token 黑名单、限流、安全、监控、健康检查。
 * 对齐当前真实 API：token 走 httpOnly cookie + 响应体（Bearer 兼容），
 * 全局搜索返回 { results, total }。隔离测试库，限流/CSRF 见 testEnv.js。
 */
const { request, app, makeUser } = require('./helpers');
const { addToBlacklist, isBlacklisted, clear: clearBlacklist } = require('../src/utils/tokenBlacklist');
const cache = require('../src/utils/cache');
const { metrics } = require('../src/utils/monitoring');

// 限流被 DISABLE_RATE_LIMIT 关闭时，跳过依赖 429 的用例
const rlTest = process.env.DISABLE_RATE_LIMIT === '1' ? test.skip : test;

let user;
beforeAll(async () => { user = await makeUser({ username: 'unit_user' }); });

describe('认证模块', () => {
  test('正确凭证登录返回 user 与 token', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ phone: user.phone, password: user.password });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.token).toBeTruthy();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('错误凭证返回 400', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ phone: user.phone, password: 'wrong-password-x' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('缺少参数返回 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ phone: user.phone });
    expect(res.status).toBe(400);
  });
});

describe('Token 黑名单', () => {
  test('加入黑名单后可查到', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    await addToBlacklist('unit_token_123', expiresAt);
    expect(await isBlacklisted('unit_token_123')).toBe(true);
  });

  test('未加入的 token 返回 false', async () => {
    expect(await isBlacklisted('unit_unknown_token')).toBe(false);
  });

  test('已过期的 token 不入黑名单', async () => {
    await addToBlacklist('unit_expired_token', Math.floor(Date.now() / 1000) - 1);
    expect(await isBlacklisted('unit_expired_token')).toBe(false);
  });

  test('logout 后旧 cookie 被拒', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ phone: user.phone, password: user.password });
    const cookie = login.headers['set-cookie'];

    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBeLessThan(400);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
  });
});

describe('限流', () => {
  rlTest('连续登录失败 5 次后被限流 429', async () => {
    let lastStatus;
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post('/api/auth/login')
        .send({ phone: user.phone, password: 'wrong-password-x' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('安全', () => {
  test('搜索注入串不致 500（未授权走 401）', async () => {
    const res = await request(app).get('/api/messages/search')
      .query({ q: "'; DROP TABLE users; --" });
    expect(res.status).not.toBe(500);
  });

  test('全局搜索返回 { results } 信封', async () => {
    const res = await request(app).get('/api/messages/search')
      .query({ q: '你好' })
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  test('登录使用 httpOnly cookie', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ phone: user.phone, password: user.password });
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.join(';')).toMatch(/httponly/i);
  });
});

describe('监控与健康', () => {
  test('记录请求指标', async () => {
    await request(app).get('/health');
    expect(metrics.getMetrics().requests.total).toBeGreaterThan(0);
  });

  test('Prometheus 指标可访问', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/vxin_requests_total/);
  });

  test('JSON 指标可访问', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('requests');
  });

  test('GET /health 返回 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBeDefined();
  });
});

afterAll(async () => {
  await clearBlacklist();
  await cache.flush();
});
