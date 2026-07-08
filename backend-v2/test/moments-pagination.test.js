'use strict';
/**
 * 集成测试：朋友圈点赞/评论分页（MO3）+ reply_to_user 校验（MO4）。
 * 自建动态、断言后删除，尽量不留测试残留。
 * 无种子 testUser 时优雅跳过（与 unit.test.js 同风格）。
 */

const request = require('supertest');
const app = require('../src/app');

const testUser = { phone: '13800001111', password: '123456' };

describe('朋友圈分页 + 回复校验 (MO3/MO4)', () => {
  let cookies;
  let momentId;

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/login').send(testUser);
    if (res.status >= 400 || !res.headers['set-cookie']) return; // 无种子用户 → 跳过
    cookies = res.headers['set-cookie'];
    const m = await request(app)
      .post('/api/moments')
      .set('Cookie', cookies)
      .send({ content: 'MO3/MO4 测试动态', visibility: 'private' });
    if (m.status < 400) momentId = m.body.id;
  });

  afterAll(async () => {
    if (cookies && momentId) {
      await request(app).delete(`/api/moments/${momentId}`).set('Cookie', cookies);
    }
  });

  test('GET /:id/likes 返回 { items, total, hasMore } 信封', async () => {
    if (!momentId) return console.warn('无种子用户/动态，跳过');
    const res = await request(app)
      .get(`/api/moments/${momentId}/likes`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('hasMore');
    expect(res.body.total).toBe(0); // 新动态无人点赞
    expect(res.body.hasMore).toBe(false);
  });

  test('GET /:id/comments 初始为空信封', async () => {
    if (!momentId) return console.warn('无种子用户/动态，跳过');
    const res = await request(app)
      .get(`/api/moments/${momentId}/comments`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  test('评论 replyToUser 指向不存在用户 → 400', async () => {
    if (!momentId) return console.warn('无种子用户/动态，跳过');
    const res = await request(app)
      .post(`/api/moments/${momentId}/comment`)
      .set('Cookie', cookies)
      .send({ content: '回复测试', replyToUser: 'definitely-not-a-real-user-id' });
    expect(res.status).toBe(400);
  });

  test('回复评论 → comments 返回 reply_to_username 昵称(而非 id)', async () => {
    if (!momentId) return console.warn('无种子用户/动态，跳过');
    // 先拿到作者 id 与昵称（自建动态里作者即当前用户，可作为合法被回复对象）
    const meMoment = await request(app).get('/api/moments').set('Cookie', cookies);
    const mine = (meMoment.body || []).find(x => x.id === momentId) || meMoment.body?.[0];
    const authorId = mine?.user_id;
    const authorName = mine?.author?.username;
    if (!authorId || !authorName) return console.warn('拿不到作者信息，跳过');

    // 需要一条作者的评论使其成为「参与者」，作者回复作者本人(isAuthor 成立)
    const reply = await request(app)
      .post(`/api/moments/${momentId}/comment`)
      .set('Cookie', cookies)
      .send({ content: '回复内容', replyToUser: authorId });
    expect(reply.status).toBeLessThan(400);
    // 创建接口直接回显被回复昵称
    expect(reply.body.reply_to_username).toBe(authorName);

    // 列表接口也应 enrich 出昵称
    const res = await request(app)
      .get(`/api/moments/${momentId}/comments`)
      .set('Cookie', cookies)
      .query({ limit: 50, offset: 0 });
    expect(res.status).toBe(200);
    const replied = res.body.items.find(c => c.reply_to_user === authorId);
    expect(replied).toBeTruthy();
    expect(replied.reply_to_username).toBe(authorName);
  });

  test('互动通知：unread-count / list / read 返回正确契约', async () => {
    if (!cookies) return console.warn('无种子用户，跳过');
    // 未读数：{ count: number }
    const cnt = await request(app).get('/api/moments/notifications/unread-count').set('Cookie', cookies);
    expect(cnt.status).toBe(200);
    expect(typeof cnt.body.count).toBe('number');

    // 列表：{ items, total, hasMore }，item 结构含 actor/moment/type
    const list = await request(app).get('/api/moments/notifications').set('Cookie', cookies).query({ limit: 30 });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body).toHaveProperty('total');
    expect(list.body).toHaveProperty('hasMore');
    for (const it of list.body.items) {
      expect(it).toHaveProperty('type');
      expect(it).toHaveProperty('actor');
      expect(it).toHaveProperty('moment');
    }

    // 标记已读：{ success:true }，之后未读数应为 0
    const read = await request(app).post('/api/moments/notifications/read').set('Cookie', cookies);
    expect(read.status).toBe(200);
    const cnt2 = await request(app).get('/api/moments/notifications/unread-count').set('Cookie', cookies);
    expect(cnt2.body.count).toBe(0);
  });

  test('合法评论后 comments 分页 total 增加', async () => {
    if (!momentId) return console.warn('无种子用户/动态，跳过');
    const add = await request(app)
      .post(`/api/moments/${momentId}/comment`)
      .set('Cookie', cookies)
      .send({ content: '一条正常评论' });
    expect(add.status).toBeLessThan(400);

    const res = await request(app)
      .get(`/api/moments/${momentId}/comments`)
      .set('Cookie', cookies)
      .query({ limit: 1, offset: 0 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.items.length).toBeLessThanOrEqual(1);
  });
});
