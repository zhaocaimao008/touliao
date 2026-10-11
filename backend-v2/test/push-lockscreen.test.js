'use strict';
require('./testEnv');
const { randomUUID } = require('crypto');
const { makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
const webpush = require('web-push');
const { pushNewMessage } = require('../src/utils/push');
let sender, recipient, conv, other;
const sent = [];
function conversation() {
  const id = randomUUID();
  db.prepare("INSERT INTO conversations(id,type,name) VALUES(?,'group','Private group')").run(id);
  for (const user of [sender, recipient]) db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)').run(id, user.userId);
  return id;
}
function message(conversationId, senderId, type = 'text', deleted = 0) {
  const id = randomUUID();
  db.prepare('INSERT INTO messages(id,conversation_id,sender_id,type,content,created_at,deleted) VALUES(?,?,?,?,?,?,?)').run(id,conversationId,senderId,type,'private text',Math.floor(Date.now()/1000),deleted);
  return id;
}
beforeAll(async () => {
  sender = await makeUser(); recipient = await makeUser();
  conv = conversation(); other = conversation();
  const endpoint = 'https://fcm.googleapis.com/fcm/send/' + recipient.userId;
  db.prepare('INSERT INTO push_subscriptions(id,user_id,endpoint,subscription) VALUES(?,?,?,?)').run(randomUUID(),recipient.userId,endpoint,JSON.stringify({endpoint,keys:{p256dh:'fixture',auth:'fixture'}}));
  jest.spyOn(webpush, 'sendNotification').mockImplementation(async (_, body) => sent.push(JSON.parse(body)));
});
afterAll(() => jest.restoreAllMocks());
beforeEach(() => { sent.length = 0; });
const push = (extra = {}) => pushNewMessage({ conversationId: conv, senderId: sender.userId, senderName: 'Private sender', content: 'private text', type: 'text', messageId:'fixture-message', ...extra });

test('badge counts other chats and excludes recipient, system and deleted messages', async () => {
  message(conv,sender.userId); message(conv,recipient.userId); message(conv,sender.userId,'system'); message(conv,sender.userId,'text',1);
  message(other,sender.userId); message(other,sender.userId);
  await push();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ badge:3, conversationUnreadCount:1, title:'Private group', body:'Private sender: private text' });
});

test('hidden preview removes sender/group names and content from display fields', async () => {
  db.prepare('INSERT INTO user_settings(user_id,detail_preview,sound) VALUES(?,0,0) ON CONFLICT(user_id) DO UPDATE SET detail_preview=0,sound=0').run(recipient.userId);
  await push();
  expect(sent).toHaveLength(1);
  expect(sent[0].title).not.toMatch(/Private/); expect(sent[0].senderName).not.toMatch(/Private/);
  expect(sent[0].body).not.toMatch(/private/); expect(sent[0].sound).toBe(false);
});

test('reading one chat preserves the other unread badge; muted chats are excluded', async () => {
  db.prepare('INSERT INTO conversation_settings(user_id,conversation_id,last_read_at) VALUES(?,?,?) ON CONFLICT(user_id,conversation_id) DO UPDATE SET last_read_at=excluded.last_read_at').run(recipient.userId,other,Math.floor(Date.now()/1000)+1);
  await push(); expect(sent[0].badge).toBe(1);
  db.prepare('UPDATE conversation_settings SET last_read_at=0,muted=1 WHERE user_id=? AND conversation_id=?').run(recipient.userId,other);
  sent.length=0; await push(); expect(sent[0].badge).toBe(1);
});

test('muted conversation and global notifications-off still suppress delivery', async () => {
  db.prepare('INSERT INTO conversation_settings(user_id,conversation_id,muted) VALUES(?,?,1) ON CONFLICT(user_id,conversation_id) DO UPDATE SET muted=1').run(recipient.userId,conv);
  await push(); expect(sent).toHaveLength(0);
  db.prepare('UPDATE conversation_settings SET muted=0 WHERE user_id=? AND conversation_id=?').run(recipient.userId,conv);
  db.prepare('UPDATE user_settings SET message_notify=0 WHERE user_id=?').run(recipient.userId);
  await push(); expect(sent).toHaveLength(0);
});
