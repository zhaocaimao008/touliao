'use strict';
const { randomUUID } = require('crypto');
const { app, request, makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
let account, previewOwner, heavy, light, first;
const endpoints = [
  ['timeline', () => '/api/moments', 20, 50, 70],
  ['personal moments', () => `/api/moments/user/${account.userId}`, 20, 50, 70],
  ['comments', () => `/api/moments/${first}/comments`, 20, 50, 70],
  ['likes', () => `/api/moments/${first}/likes`, 20, 50, 101],
  ['notifications', () => '/api/moments/notifications', 20, 50, 70],
  ['call logs', () => '/api/users/me/call-logs', 50, 200, 220],
];
const get = (path, query = '', user = account) => request(app).get(path + (query ? '?' + query : ''))
  .set('Authorization', `Bearer ${user.token}`);
const items = response => Array.isArray(response.body) ? response.body : response.body.items;
beforeAll(async () => {
  account = await makeUser(); previewOwner = await makeUser();
  const prefix = randomUUID(); first = `${prefix}-post-0`;
  heavy = `${prefix}-aaa`; light = `${prefix}-zzz`;
  db.transaction(() => {
    for (let i = 0; i < 70; i++) {
      db.prepare('INSERT INTO moments(id,user_id,content,visibility,created_at) VALUES(?,?,?,?,?)')
        .run(`${prefix}-post-${i}`, account.userId, 'page', 'private', i);
      db.prepare('INSERT INTO moment_comments(id,moment_id,user_id,content,created_at) VALUES(?,?,?,?,?)')
        .run(`${prefix}-comment-${i}`, first, account.userId, 'page', i);
      db.prepare('INSERT INTO moment_notifications(id,user_id,actor_id,moment_id,type,created_at) VALUES(?,?,?,?,?,?)')
        .run(`${prefix}-notice-${i}`, account.userId, previewOwner.userId, first, 'like', i);
    }
    for (const id of [heavy, light]) db.prepare('INSERT INTO moments(id,user_id,content,visibility) VALUES(?,?,?,?)')
      .run(id, previewOwner.userId, 'preview', 'private');
    for (let i = 0; i < 101; i++) {
      const userId = i === 100 ? previewOwner.userId : `${prefix}-liker-${i}`;
      if (i !== 100) db.prepare('INSERT INTO users(id,username,phone,password,wechat_id) VALUES(?,?,?,?,?)')
        .run(userId, userId, userId, 'synthetic', userId);
      for (const id of [first, heavy]) db.prepare('INSERT INTO moment_likes(moment_id,user_id,created_at) VALUES(?,?,?)')
        .run(id, userId, i);
    }
    db.prepare('INSERT INTO moment_likes(moment_id,user_id) VALUES(?,?)').run(light, previewOwner.userId);
    for (let i = 0; i < 21; i++) db.prepare('INSERT INTO moment_comments(id,moment_id,user_id,content,created_at) VALUES(?,?,?,?,?)')
      .run(`${prefix}-preview-${i}`, heavy, previewOwner.userId, `preview ${i}`, i);
    db.prepare('INSERT INTO moment_comments(id,moment_id,user_id,content,reply_to_user) VALUES(?,?,?,?,?)')
      .run(`${prefix}-light-comment`, light, previewOwner.userId, 'present', previewOwner.userId);
    for (let i = 0; i < 220; i++) db.prepare('INSERT INTO call_logs(id,caller_id,callee_id,created_at) VALUES(?,?,?,?)')
      .run(`${prefix}-call-${i}`, account.userId, previewOwner.userId, i);
  })();
});

describe.each(endpoints)('F04 %s', (name, path, defaultSize, cap, total) => {
  test.each(['-1', '0', '1.5', '', 'abc', '1abc', '1e2', '0x10', 'Infinity', 'NaN', '9007199254740992', '%20', '%2B1'])('rejects limit=%s with 400', async value => {
    const res = await get(path(), `limit=${value}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/);
  });
  test.each(['limit=1&limit=2', 'limit[]=1', 'limit[x]=1'])('rejects non-scalar query %s', async query => {
    expect((await get(path(), query)).status).toBe(400);
  });
  test('retains default size and caps valid large limits', async () => {
    const normal = await get(path());
    expect(normal.status).toBe(200); expect(items(normal)).toHaveLength(defaultSize);
    const large = await get(path(), 'limit=9999');
    expect(large.status).toBe(200); expect(items(large)).toHaveLength(cap);
    const one = await get(path(), 'limit=1');
    expect(one.status).toBe(200); expect(items(one)).toHaveLength(1);
    if (!Array.isArray(large.body)) {
      expect(large.body.total).toBe(total); expect(large.body.hasMore).toBe(true);
    }
  });
  if (name !== 'call logs') {
    test.each(['-1', '1.5', '', 'abc', '1e2', 'Infinity', '9007199254740992', '1&offset=2', '%20', '0x10'])('rejects offset=%s with 400', async value => {
      expect((await get(path(), `offset=${value}`)).status).toBe(400);
    });
    test('advances offset without duplicates and returns an empty final page', async () => {
      const a = await get(path(), 'limit=1&offset=0');
      const b = await get(path(), 'limit=1&offset=1');
      expect(a.status).toBe(200); expect(b.status).toBe(200);
      expect(items(a)).toHaveLength(1); expect(items(b)).toHaveLength(1);
      expect(items(a)[0]).not.toEqual(items(b)[0]);
      const end = await get(path(), `limit=1&offset=${total}`);
      expect(end.status).toBe(200); expect(items(end)).toEqual([]);
      if (!Array.isArray(end.body)) expect(end.body.hasMore).toBe(false);
    });
  }
});

test.each(['timeline', 'personal'])('F05 %s gives each moment its own comment and like preview budget', async kind => {
  const path = kind === 'timeline' ? '/api/moments' : `/api/moments/user/${previewOwner.userId}`;
  const res = await get(path, 'limit=2', previewOwner);
  expect(res.status).toBe(200); expect(res.body).toHaveLength(2);
  const a = res.body.find(m => m.id === heavy), b = res.body.find(m => m.id === light);
  expect(a.commentCount).toBe(21); expect(a.comments).toHaveLength(10); expect(a.hasMoreComments).toBe(true);
  expect(a.comments.map(c => c.content)).toEqual(Array.from({ length: 10 }, (_, i) => `preview ${i}`));
  expect(a.likeCount).toBe(101); expect(a.likes).toHaveLength(50); expect(a.hasMoreLikes).toBe(true);
  expect(a.liked).toBe(true); // viewer's like lies outside the preview
  expect(b.commentCount).toBe(1); expect(b.comments).toHaveLength(1); expect(b.hasMoreComments).toBe(false);
  expect(b.comments[0]).toMatchObject({ content: 'present', reply_to_username: previewOwner.username, username: previewOwner.username });
  expect(b.likeCount).toBe(1); expect(b.likes).toHaveLength(1); expect(b.hasMoreLikes).toBe(false); expect(b.liked).toBe(true);
  for (const m of res.body) {
    expect(m).not.toHaveProperty('visible_to');
    for (const row of [...m.comments, ...m.likes]) {
      expect(row).not.toHaveProperty('rn'); expect(row).not.toHaveProperty('moment_id');
    }
  }
});
