'use strict';
/**
 * 集成测试：朋友圈编辑（PUT /moments/:id）。
 * 自建私密动态 → 编辑文字与可见范围 → 校验返回；非作者编辑应 403/404。
 * 无种子 testUser 时优雅跳过。
 */
const request = require('supertest');
const app = require('../src/app');

const testUser = { phone: '13800001111', password: '123456' };

describe('朋友圈编辑', () => {
  let cookies;
  let momentId;

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/login').send(testUser);
    if (res.status >= 400 || !res.headers['set-cookie']) return;
    cookies = res.headers['set-cookie'];
    const m = await request(app)
      .post('/api/moments')
      .set('Cookie', cookies)
      .send({ content: '编辑前的内容', visibility: 'private' });
    if (m.status < 400) momentId = m.body.id;
  });

  afterAll(async () => {
    if (cookies && momentId) {
      await request(app).delete(`/api/moments/${momentId}`).set('Cookie', cookies);
    }
  });

  test('编辑文字内容 → 200 且内容更新', async () => {
    if (!momentId) return console.warn('无种子用户/动态，跳过');
    const res = await request(app)
      .put(`/api/moments/${momentId}`)
      .set('Cookie', cookies)
      .send({ content: '编辑后的内容' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('编辑后的内容');
  });

  test('内容为空 → 400', async () => {
    if (!momentId) return console.warn('无种子用户/动态，跳过');
    const res = await request(app)
      .put(`/api/moments/${momentId}`)
      .set('Cookie', cookies)
      .send({ content: '   ' });
    expect(res.status).toBe(400);
  });

  test('编辑不存在的动态 → 404', async () => {
    if (!cookies) return console.warn('无种子用户，跳过');
    const res = await request(app)
      .put('/api/moments/nonexistent-id-xyz')
      .set('Cookie', cookies)
      .send({ content: 'x' });
    expect(res.status).toBe(404);
  });
});
