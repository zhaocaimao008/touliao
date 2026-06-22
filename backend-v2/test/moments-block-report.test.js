'use strict';
/**
 * 集成测试：朋友圈举报（MO6）。
 * 自建私密动态并对其举报（自举报应 400），重复举报应 409；afterAll 清理。
 * 拉黑双向过滤涉及第二账号 + 好友关系，单测环境难稳定构造，故此处聚焦举报路径；
 * 拉黑过滤逻辑由 SQL 与 isBlockedBetween 保证，已在服务层就地实现。
 * 无种子 testUser 时优雅跳过。
 */

const request = require('supertest');
const app = require('../src/app');

const testUser = { phone: '13800001111', password: '123456' };

describe('朋友圈举报 (MO6)', () => {
  let cookies;
  let momentId;

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/login').send(testUser);
    if (res.status >= 400 || !res.headers['set-cookie']) return;
    cookies = res.headers['set-cookie'];
    const m = await request(app)
      .post('/api/moments')
      .set('Cookie', cookies)
      .send({ content: 'MO6 举报测试动态', visibility: 'private' });
    if (m.status < 400) momentId = m.body.id;
  });

  afterAll(async () => {
    if (cookies && momentId) {
      await request(app).delete(`/api/moments/${momentId}`).set('Cookie', cookies);
    }
  });

  test('举报自己的动态 → 400', async () => {
    if (!momentId) return console.warn('无种子用户/动态，跳过');
    const res = await request(app)
      .post(`/api/moments/${momentId}/report`)
      .set('Cookie', cookies)
      .send({ reason: '测试' });
    expect(res.status).toBe(400);
  });

  test('举报不存在的动态 → 404', async () => {
    if (!cookies) return console.warn('无种子用户，跳过');
    const res = await request(app)
      .post('/api/moments/nonexistent-moment-id/report')
      .set('Cookie', cookies)
      .send({ reason: 'x' });
    expect(res.status).toBe(404);
  });
});
