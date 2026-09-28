'use strict';
/**
 * 群昵称：群聊消息署名优先显示发送者在本群的群昵称（对齐微信）；私聊、系统提示不受影响。
 * 此前群昵称只出现在群资料成员列表，聊天里一律显示账号昵称，设置了等于没设。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const msgSvc = require('../src/modules/messages/messages.service');
const auth = u => ['Authorization', `Bearer ${u.token}`];

test('群聊历史/定位上下文/同步里的署名使用群昵称', async () => {
  const a = await makeUser({ username: 'gn_a' });
  const b = await makeUser({ username: 'gn_b' });
  await befriend(a, b);
  const gid = (await request(app).post('/api/messages/conversation/group').set(...auth(a)).send({ name: '昵称群', memberIds: [b.userId] })).body.conversationId;
  await request(app).put(`/api/messages/conversation/${gid}/nickname`).set(...auth(a)).send({ nickname: '群主大人' });
  const sent = await msgSvc.send(null, gid, a.userId, { content: '大家好' });

  const hist = (await request(app).get(`/api/messages/${gid}`).set(...auth(b))).body;
  expect(hist.find(m => m.id === sent.id).senderName).toBe('群主大人');
  expect(hist.filter(m => m.type === 'system').every(m => m.senderName !== '群主大人' || m.sender_id !== a.userId)).toBe(true);

  const around = (await request(app).get(`/api/messages/${gid}/around/${sent.id}`).set(...auth(b))).body;
  expect(around.messages.find(m => m.id === sent.id).senderName).toBe('群主大人');

  const sync = (await request(app).get(`/api/messages/${gid}/sync`).query({ after: 0 }).set(...auth(b))).body;
  expect(sync.messages.find(e => e.message?.id === sent.id).message.senderName).toBe('群主大人');

  // 清空群昵称后恢复账号昵称
  await request(app).put(`/api/messages/conversation/${gid}/nickname`).set(...auth(a)).send({ nickname: '' });
  const hist2 = (await request(app).get(`/api/messages/${gid}`).set(...auth(b))).body;
  expect(hist2.find(m => m.id === sent.id).senderName).toBe('gn_a');
});

test('私聊不受群昵称影响', async () => {
  const a = await makeUser({ username: 'gn_p_a' });
  const b = await makeUser({ username: 'gn_p_b' });
  await befriend(a, b);
  const pc = await privateConversation(a, b);
  const sent = await msgSvc.send(null, pc, a.userId, { content: 'hi' });
  const hist = (await request(app).get(`/api/messages/${pc}`).set(...auth(b))).body;
  expect(hist.find(m => m.id === sent.id).senderName).toBe('gn_p_a');
});
