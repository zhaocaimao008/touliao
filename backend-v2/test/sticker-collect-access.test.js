'use strict';
/**
 * 表情收藏：只能收藏自己有权引用的图片（与发送表情同一口径 canReferenceFile）。
 * 此前任意 /uploads/ 地址都能收进表情列表，发送时才 403，留下永远发不出去的表情。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const auth = u => ['Authorization', `Bearer ${u.token}`];

test('会话成员可收藏对话里的图片；陌生人不能收藏他人会话的图片', async () => {
  const a = await makeUser({ username: 'stk_a' });
  const b = await makeUser({ username: 'stk_b' });
  const s = await makeUser({ username: 'stk_s' });
  await befriend(a, b);
  const conv = await privateConversation(a, b);
  const up = await request(app).post(`/api/messages/${conv}/upload`).set(...auth(a)).attach('file', Buffer.from('sticker source ' + Date.now()), { filename: 'p.txt', contentType: 'text/plain' }); // 测试环境无图片审核服务，用文档验证引用权限
  expect(up.status).toBe(200);
  const url = up.body.file_url || up.body.message?.file_url;

  const byMember = await request(app).post('/api/stickers/collect').set(...auth(b)).send({ url });
  expect(byMember.status).toBe(200);
  const byStranger = await request(app).post('/api/stickers/collect').set(...auth(s)).send({ url });
  expect(byStranger.status).toBe(403);
  const list = await request(app).get('/api/stickers/').set(...auth(s));
  expect(JSON.stringify(list.body)).not.toContain(url);
});
