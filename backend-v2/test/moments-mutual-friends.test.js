'use strict';
/**
 * 朋友圈互动只显示共同好友（对齐微信）+ 后台朋友圈总开关。
 *  · 作者看到全部点赞/评论；其他人只看到自己、作者和自己好友的，计数同口径
 *  · 「好友回复陌生人」也不显示
 *  · 后台关闭朋友圈后，所有朋友圈接口 403
 */
const { request, app, makeUser, befriend } = require('./helpers');
const { db } = require('../src/db/connection');

const get = (u, path) => request(app).get(path).set('Authorization', `Bearer ${u.token}`);
const post = (u, path, body = {}) => request(app).post(path).set('Authorization', `Bearer ${u.token}`).send(body);

async function detail(user, momentId) {
  const res = await get(user, `/api/moments/${momentId}`);
  expect(res.status).toBe(200);
  return res.body;
}

describe('朋友圈互动只显示共同好友', () => {
  let author, b, c, d, momentId;
  beforeAll(async () => {
    // author 与 b、c、d 都是好友；c 与 d 是好友；b 与 c、d 互不认识
    author = await makeUser({ username: 'mf_author' });
    b = await makeUser({ username: 'mf_b' });
    c = await makeUser({ username: 'mf_c' });
    d = await makeUser({ username: 'mf_d' });
    await befriend(author, b);
    await befriend(author, c);
    await befriend(author, d);
    await befriend(c, d);
    const res = await post(author, '/api/moments/', { content: '共同好友测试' });
    momentId = res.body.id;
    await post(b, `/api/moments/${momentId}/like`);
    await post(b, `/api/moments/${momentId}/comment`, { content: 'b 的评论' });
    await post(d, `/api/moments/${momentId}/comment`, { content: 'd 回复 b', replyToUser: b.userId });
    await post(d, `/api/moments/${momentId}/comment`, { content: 'd 的评论' });
  });

  test('作者看到全部点赞与评论', async () => {
    const m = await detail(author, momentId);
    expect(m.likeCount).toBe(1);
    expect(m.commentCount).toBe(3);
  });

  test('c 看不到陌生人 b 的点赞/评论，也看不到好友 d 回复 b；计数同口径', async () => {
    const m = await detail(c, momentId);
    expect(m.likes.map(l => l.user_id)).not.toContain(b.userId);
    expect(m.likeCount).toBe(0);
    expect(m.comments.map(x => x.content)).toEqual(['d 的评论']);
    expect(m.commentCount).toBe(1);
    const list = await get(c, `/api/moments/${momentId}/comments`);
    expect(list.body.total).toBe(1);
    const timeline = await get(c, '/api/moments');
    const inTimeline = (timeline.body.items || timeline.body).find(x => x.id === momentId);
    expect(inTimeline.commentCount).toBe(1);
    expect(inTimeline.likeCount).toBe(0);
  });

  test('b 看得到自己的点赞和评论', async () => {
    const m = await detail(b, momentId);
    expect(m.likes.map(l => l.user_id)).toContain(b.userId);
    expect(m.comments.map(x => x.content)).toContain('b 的评论');
  });

  test('c 与 b 加好友后即可看到 b 的互动', async () => {
    await befriend(b, c);
    const m = await detail(c, momentId);
    expect(m.likeCount).toBe(1);
    expect(m.commentCount).toBe(3);
  });
});

describe('后台朋友圈总开关', () => {
  afterEach(() => db.prepare("DELETE FROM admin_settings WHERE key='feature_moments'").run());

  test('关闭后浏览、点赞、评论接口一律 403，重新打开后恢复', async () => {
    const author = await makeUser({ username: 'mf_switch_a' });
    const friend = await makeUser({ username: 'mf_switch_f' });
    await befriend(author, friend);
    const momentId = (await post(author, '/api/moments/', { content: '开关测试' })).body.id;
    db.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('feature_moments', 'off')").run();
    for (const res of [
      await get(friend, '/api/moments'),
      await get(friend, `/api/moments/${momentId}`),
      await post(friend, `/api/moments/${momentId}/like`),
      await post(friend, `/api/moments/${momentId}/comment`, { content: 'x' }),
      await post(author, '/api/moments/', { content: '关闭后发布' }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MOMENTS_DISABLED');
    }
    db.prepare("DELETE FROM admin_settings WHERE key='feature_moments'").run();
    expect((await get(friend, '/api/moments')).status).toBe(200);
  });
});
