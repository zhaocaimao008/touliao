'use strict';
/**
 * 集成测试：通话记录 GET /api/users/me/call-logs（移动端接入的契约）。
 * 无种子 testUser 时优雅跳过。校验返回数组 + 每项字段结构（peer/direction/type/status）。
 */

const request = require('supertest');
const app = require('../src/app');

const testUser = { phone: '13800001111', password: '123456' };

describe('通话记录 call-logs', () => {
  let cookies;

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/login').send(testUser);
    if (res.status >= 400 || !res.headers['set-cookie']) return;
    cookies = res.headers['set-cookie'];
  });

  test('GET /me/call-logs 返回数组', async () => {
    if (!cookies) return console.warn('无种子用户，跳过');
    const res = await request(app).get('/api/users/me/call-logs').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('每条记录含 direction/type/status/peer 字段', async () => {
    if (!cookies) return console.warn('无种子用户，跳过');
    const res = await request(app).get('/api/users/me/call-logs').set('Cookie', cookies).query({ limit: 10 });
    expect(res.status).toBe(200);
    for (const c of res.body) {
      expect(c).toHaveProperty('id');
      expect(['in', 'out']).toContain(c.direction);
      expect(c).toHaveProperty('type');
      expect(c).toHaveProperty('status');
      expect(c).toHaveProperty('peer_id');
      expect(c).toHaveProperty('peer_name');
    }
  });

  test('limit 参数被裁剪（不超过 200）', async () => {
    if (!cookies) return console.warn('无种子用户，跳过');
    const res = await request(app).get('/api/users/me/call-logs').set('Cookie', cookies).query({ limit: 9999 });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(200);
  });
});
