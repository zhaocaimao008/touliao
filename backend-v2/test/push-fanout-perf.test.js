'use strict';
// 群消息离线推送的扇出成本（2026-09-29 压测发现）：
//   1. 没有推送通道（设备令牌 / Web Push 订阅）的成员不再计算设置与未读数
//   2. 角标未读数最多数到 100 行（显示上限 99），不再随积压的未读消息线性增长
// 行为不变：有通道的成员照常收到推送，角标 = min(未读, 99)。
require('./testEnv');
const crypto = require('crypto');
const { makeUser, befriend } = require('./helpers');
const { db } = require('../src/db/connection');
const webpush = require('web-push');
const { pushNewMessage } = require('../src/utils/push');

let owner, withToken, noToken, conv;
const sent = [];
beforeAll(async () => {
  owner = await makeUser(); withToken = await makeUser(); noToken = await makeUser();
  await befriend(owner, withToken); await befriend(owner, noToken);
  conv = crypto.randomUUID();
  db.prepare("INSERT INTO conversations (id, type, name) VALUES (?, 'group', '推送扇出')").run(conv);
  for (const u of [owner, withToken, noToken]) db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(conv, u.userId);
  // 推送通道用 Web Push：它发出的负载就是完整推送数据（含角标），便于断言
  const endpoint = 'https://fcm.googleapis.com/fcm/send/fanout-' + withToken.userId;
  db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, subscription) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), withToken.userId, endpoint, JSON.stringify({ endpoint, keys: { p256dh: 'k', auth: 'a' } }));
  jest.spyOn(webpush, 'sendNotification').mockImplementation(async (sub, body) => { sent.push({ to: JSON.parse(body).recipientId, payload: JSON.parse(body) }); });
});
afterAll(() => jest.restoreAllMocks());

function addMessages(n) {
  const ins = db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at) VALUES (?, ?, ?, 'text', 'x', ?)");
  const now = Math.floor(Date.now() / 1000);
  // 未读积压来自其他成员（发送者自己的消息不计未读）
  db.transaction(() => { for (let i = 0; i < n; i++) ins.run(crypto.randomUUID(), conv, noToken.userId, now); }).immediate();
}
const push = () => pushNewMessage({ conversationId: conv, senderId: owner.userId, senderName: 'owner', content: 'hi', type: 'text', timestamp: Date.now() });

test('只推给有推送通道的成员，角标为真实未读数', async () => {
  addMessages(3); sent.length = 0;
  await push();
  expect(sent.map(s => s.to)).toEqual([withToken.userId]);
  expect(sent[0].payload.badge).toBe(3);
});

test('积压上百条未读时角标封顶 99', async () => {
  addMessages(150); sent.length = 0;
  await push();
  expect(sent).toHaveLength(1);
  expect(sent[0].payload.badge).toBe(99);
});
