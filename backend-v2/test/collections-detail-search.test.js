'use strict';
/**
 * 集成测试：收藏详情（CO5）+ 搜索（CO6）。
 * 建一条带唯一关键词的收藏 → 详情按 id 取回 → 搜索命中信封 → 不存在=404；afterAll 清理。
 * 无种子 testUser 时优雅跳过。
 */

const request = require('supertest');
const app = require('../src/app');

const testUser = { phone: '13800001111', password: '123456' };
const KW = 'ZZ收藏关键词' + Date.now();

describe('收藏详情 + 搜索 (CO5/CO6)', () => {
  let cookies;
  let collectionId;

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/login').send(testUser);
    if (res.status >= 400 || !res.headers['set-cookie']) return;
    cookies = res.headers['set-cookie'];
    const c = await request(app)
      .post('/api/users/me/collections')
      .set('Cookie', cookies)
      .send({ type: 'text', content: `这是一条 ${KW} 的测试收藏` });
    if (c.status < 400) collectionId = c.body.id;
  });

  afterAll(async () => {
    if (cookies && collectionId) {
      await request(app).delete(`/api/users/me/collections/${collectionId}`).set('Cookie', cookies);
    }
  });

  test('GET /me/collections/:id 取回详情，extra 为对象', async () => {
    if (!collectionId) return console.warn('无种子用户/收藏，跳过');
    const res = await request(app)
      .get(`/api/users/me/collections/${collectionId}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(collectionId);
    expect(typeof res.body.extra).toBe('object');
  });

  test('GET /me/collections/:id 不存在 → 404', async () => {
    if (!cookies) return console.warn('无种子用户，跳过');
    const res = await request(app)
      .get('/api/users/me/collections/nonexistent-id')
      .set('Cookie', cookies);
    expect(res.status).toBe(404);
  });

  test('GET /me/collections/search 命中关键词，返回信封', async () => {
    if (!collectionId) return console.warn('无种子用户/收藏，跳过');
    const res = await request(app)
      .get('/api/users/me/collections/search')
      .query({ q: KW })
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('hasMore');
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.items.some(i => i.id === collectionId)).toBe(true);
  });

  test('search 空 q → 空信封', async () => {
    if (!cookies) return console.warn('无种子用户，跳过');
    const res = await request(app)
      .get('/api/users/me/collections/search')
      .query({ q: '' })
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});
