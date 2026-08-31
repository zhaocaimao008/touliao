'use strict';
/**
 * 核心流程回归：朋友圈点赞（toggle 语义：再点一次是取消赞）。
 * 正常路径 + 至少两个异常路径。
 */
const { request, app, makeUser, befriend } = require('./helpers');

async function postMoment(user, body = { content: '待点赞动态' }) {
  const res = await request(app).post('/api/moments/')
    .set('Authorization', `Bearer ${user.token}`).send(body);
  return res.body.id;
}

describe('点赞', () => {
  test('正常路径：好友点赞自己可见的动态，liked=true，likeCount=1', async () => {
    const author = await makeUser({ username: 'like_author' });
    const liker = await makeUser({ username: 'like_liker' });
    await befriend(author, liker);
    const momentId = await postMoment(author);

    const res = await request(app).post(`/api/moments/${momentId}/like`)
      .set('Authorization', `Bearer ${liker.token}`);
    expect(res.status).toBe(200);
    expect(res.body.liked).toBe(true);
    expect(res.body.likeCount).toBe(1);
  });

  test('正常路径：再次点赞同一动态 → 取消赞，likeCount 回落到 0（幂等 toggle）', async () => {
    const author = await makeUser({ username: 'like_author2' });
    const liker = await makeUser({ username: 'like_liker2' });
    await befriend(author, liker);
    const momentId = await postMoment(author);

    await request(app).post(`/api/moments/${momentId}/like`).set('Authorization', `Bearer ${liker.token}`);
    const second = await request(app).post(`/api/moments/${momentId}/like`).set('Authorization', `Bearer ${liker.token}`);
    expect(second.status).toBe(200);
    expect(second.body.liked).toBe(false);
    expect(second.body.likeCount).toBe(0);
  });

  test('异常路径：未登录点赞 → 401', async () => {
    const author = await makeUser({ username: 'like_author3' });
    const momentId = await postMoment(author);
    const res = await request(app).post(`/api/moments/${momentId}/like`);
    expect(res.status).toBe(401);
  });

  test('异常路径：点赞不存在的动态ID → 404', async () => {
    const u = await makeUser({ username: 'like_ghost' });
    const res = await request(app).post('/api/moments/not-a-real-id/like')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(404);
  });

  test('异常路径：非好友点赞他人动态（无可见权限）→ 403，且不产生点赞记录', async () => {
    const author = await makeUser({ username: 'like_author4' });
    const stranger = await makeUser({ username: 'like_stranger' });
    const momentId = await postMoment(author); // 默认 visibility=all，但 assertVisible 要求是好友或本人

    const res = await request(app).post(`/api/moments/${momentId}/like`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(res.status).toBe(403);

    // 作者自己看点赞列表应仍为 0
    const likes = await request(app).get(`/api/moments/${momentId}/likes`)
      .set('Authorization', `Bearer ${author.token}`);
    expect(likes.body.total ?? likes.body.length ?? 0).toBe(0);
  });
});
