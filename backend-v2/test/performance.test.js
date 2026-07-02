'use strict';
/**
 * 性能基准（opt-in，`npm run test:perf`，不进 CI 门禁）。
 * 时序阈值受机器负载影响，仅作参考；成功率/吞吐/无 500 才是硬指标。
 * 对齐真实 API：Bearer 鉴权 + /api 前缀 + 需先加好友再建私聊。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');

describe('性能基准测试', () => {
  let u1, u2, token, userId, conversationId;

  beforeAll(async () => {
    u1 = await makeUser({ username: 'perf_u1' });
    u2 = await makeUser({ username: 'perf_u2' });
    token = u1.token;
    userId = u1.userId;
    await befriend(u1, u2);
    conversationId = await privateConversation(u1, u2);
  });

  const listConversations = () => request(app)
    .get('/api/messages/conversations').set('Authorization', `Bearer ${token}`);

  describe('缓存性能', () => {
    test('对话列表查询（缓存未命中）', async () => {
      const durations = [];
      for (let i = 0; i < 5; i++) {
        const t0 = Date.now();
        const res = await listConversations();
        expect(res.status).toBe(200);
        durations.push(Date.now() - t0);
      }
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      console.log(`\n首次查询平均: ${avg.toFixed(2)}ms`);
      expect(avg).toBeLessThan(200);
    });

    test('缓存命中', async () => {
      await listConversations(); // 预热
      const durations = [];
      for (let i = 0; i < 10; i++) {
        const t0 = Date.now();
        const res = await listConversations();
        expect(res.status).toBe(200);
        durations.push(Date.now() - t0);
      }
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      console.log(`缓存命中平均: ${avg.toFixed(2)}ms`);
      expect(avg).toBeLessThan(100);
    });

    test('搜索缓存', async () => {
      const one = () => request(app).get('/api/messages/search?q=test')
        .set('Authorization', `Bearer ${token}`);
      const r1 = await one(); expect(r1.status).toBe(200);
      const r2 = await one(); expect(r2.status).toBe(200);
    });
  });

  describe('并发', () => {
    test('并发读取全部成功', async () => {
      const results = await Promise.all(Array.from({ length: 100 }, listConversations));
      const successRate = results.filter(r => r.status === 200).length / results.length * 100;
      console.log(`\n100 并发读成功率: ${successRate}%`);
      expect(successRate).toBe(100);
    });

    test('并发写入全部成功', async () => {
      const results = await Promise.all(Array.from({ length: 50 }, (_, i) =>
        request(app).post(`/api/messages/${conversationId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ content: `并发消息 ${i}`, type: 'text' })));
      const successRate = results.filter(r => r.status === 200).length / results.length * 100;
      console.log(`50 并发写成功率: ${successRate}%`);
      expect(successRate).toBe(100);
    });
  });

  describe('数据库查询', () => {
    test('单条用户查询', async () => {
      const durations = [];
      for (let i = 0; i < 10; i++) {
        const t0 = Date.now();
        const res = await request(app).get(`/api/users/${userId}`)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        durations.push(Date.now() - t0);
      }
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      console.log(`\n单条查询平均: ${avg.toFixed(2)}ms`);
      expect(avg).toBeLessThan(100);
    });
  });

  describe('监控指标', () => {
    test('Prometheus 指标', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('vxin_requests_total');
    });

    test('JSON 指标', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('requests');
      expect(res.body).toHaveProperty('cache');
      expect(res.body).toHaveProperty('database');
    });
  });
});
