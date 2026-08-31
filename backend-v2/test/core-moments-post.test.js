'use strict';
/**
 * 核心流程回归：发布朋友圈动态（图文）。
 * 正常路径 + 至少两个异常路径。
 */
const { request, app, makeUser } = require('./helpers');

describe('发帖（朋友圈动态）', () => {
  test('正常路径：发布纯文字动态成功，返回动态详情', async () => {
    const u = await makeUser({ username: 'post_a' });
    const res = await request(app).post('/api/moments/')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ content: '今天天气不错', visibility: 'all' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('今天天气不错');
    expect(res.body.user_id).toBe(u.userId);
  });

  test('正常路径：发布图文动态，images 数组落库', async () => {
    const u = await makeUser({ username: 'post_b' });
    const res = await request(app).post('/api/moments/')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ content: '配图动态', images: ['/uploads/moments/fake1.jpg', '/uploads/moments/fake2.jpg'] });
    expect(res.status).toBe(200);
    expect(res.body.images).toHaveLength(2);
  });

  test('异常路径：未登录发帖 → 401', async () => {
    const res = await request(app).post('/api/moments/').send({ content: '匿名发帖' });
    expect(res.status).toBe(401);
  });

  test('异常路径：内容和图片都为空 → 400', async () => {
    const u = await makeUser({ username: 'post_c' });
    const res = await request(app).post('/api/moments/')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ content: '   ' });
    expect(res.status).toBe(400);
  });

  test('异常路径：图片URL不在白名单域名内（伪造外部图床URL）会被静默过滤，不落库', async () => {
    const u = await makeUser({ username: 'post_d' });
    const res = await request(app).post('/api/moments/')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ content: '带恶意图片', images: ['https://evil.example.com/x.jpg'] });
    expect(res.status).toBe(200);
    expect(res.body.images).toHaveLength(0);
  });

  test('异常路径：内容超长（>5000字）→ 400', async () => {
    const u = await makeUser({ username: 'post_e' });
    const res = await request(app).post('/api/moments/')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ content: '莫'.repeat(5001) });
    expect(res.status).toBe(400);
  });
});
