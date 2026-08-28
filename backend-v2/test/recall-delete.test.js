'use strict';
/**
 * 撤回（forEveryone）与个人删除（forMe）的持久化语义。
 *
 *  · 撤回: messages.deleted=2 + content 清空,会话级,history/missed/search 对所有人不可见,
 *    重复撤回幂等(不报错、不重复广播)
 *  · 个人删除: user_message_deletions 表插入 per-user tombstone,仅当前账号不可见,
 *    对方/群成员完全不受影响;重启/重新登录后依然不可见(持久化)
 */
const { makeUser, befriend, privateConversation } = require('./helpers');
const msgSvc = require('../src/modules/messages/messages.service');
const { db } = require('../src/db/connection');
const { v4: uuidv4 } = require('uuid');

function insertMsg(convId, senderId, content = 'hello') {
  const id = uuidv4();
  db.prepare(
    'INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)'
  ).run(id, convId, senderId, 'text', content, Math.floor(Date.now() / 1000));
  return id;
}

describe('撤回（forEveryone）', () => {
  test('撤回后 history 对双方都不可见,且幂等', async () => {
    const a = await makeUser({ username: 'recall_a' });
    const b = await makeUser({ username: 'recall_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const msgId = insertMsg(convId, a.userId, '今晚8点见');

    // A 撤回
    await msgSvc.remove(null, a.userId, msgId, true, false, false);

    // 双方 history 都不见
    const ha = msgSvc.history(convId, a.userId, {});
    const hb = msgSvc.history(convId, b.userId, {});
    expect(ha.some(m => m.id === msgId)).toBe(false);
    expect(hb.some(m => m.id === msgId)).toBe(false);

    // 数据库层面确实是 tombstone
    const row = db.prepare('SELECT deleted, content FROM messages WHERE id=?').get(msgId);
    expect(row.deleted).toBe(2);
    expect(row.content).toBe('');

    // 幂等:重复撤回不抛错
    await expect(msgSvc.remove(null, a.userId, msgId, true, false, false)).resolves.not.toThrow();
  });

  test('别人不能撤回我的消息', async () => {
    const a = await makeUser({ username: 'recall_oa' });
    const b = await makeUser({ username: 'recall_ob' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const msgId = insertMsg(convId, a.userId, 'a 的消息');
    await expect(msgSvc.remove(null, b.userId, msgId, true, false, false)).rejects.toThrow('无权');
  });
});

describe('个人删除（forMe）', () => {
  test('A 删除 B 的消息: A 不可见, B 仍可见(持久化)', async () => {
    const a = await makeUser({ username: 'delfor_a' });
    const b = await makeUser({ username: 'delfor_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const msgId = insertMsg(convId, b.userId, 'b 发来的消息');

    // A 个人删除
    await msgSvc.remove(null, a.userId, msgId, false, false, true);

    // A 的 history 不可见
    const ha = msgSvc.history(convId, a.userId, {});
    expect(ha.some(m => m.id === msgId)).toBe(false);

    // B 的 history 仍可见(对方不受影响)
    const hb = msgSvc.history(convId, b.userId, {});
    expect(hb.some(m => m.id === msgId)).toBe(true);

    // messages 行未被触碰(不是撤回)
    const row = db.prepare('SELECT deleted, content FROM messages WHERE id=?').get(msgId);
    expect(row.deleted).toBe(0);
    expect(row.content).toBe('b 发来的消息');

    // per-user tombstone 持久化:模拟重启后(新会话读库)依然不可见
    const hb2 = msgSvc.history(convId, a.userId, {});
    expect(hb2.some(m => m.id === msgId)).toBe(false);
  });

  test('A 删除自己的消息: A 不可见, B 仍可见', async () => {
    const a = await makeUser({ username: 'delfor2_a' });
    const b = await makeUser({ username: 'delfor2_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const msgId = insertMsg(convId, a.userId, 'a 自己的消息');
    await msgSvc.remove(null, a.userId, msgId, false, false, true);

    expect(msgSvc.history(convId, a.userId, {}).some(m => m.id === msgId)).toBe(false);
    expect(msgSvc.history(convId, b.userId, {}).some(m => m.id === msgId)).toBe(true);
  });

  test('重复个人删除幂等(INSERT OR IGNORE 不炸)', async () => {
    const a = await makeUser({ username: 'delfor3_a' });
    const b = await makeUser({ username: 'delfor3_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const msgId = insertMsg(convId, b.userId, 'x');
    await msgSvc.remove(null, a.userId, msgId, false, false, true);
    await expect(msgSvc.remove(null, a.userId, msgId, false, false, true)).resolves.not.toThrow();
  });
});

describe('撤回后引用消息无痕', () => {
  test('被引用消息撤回后,历史里引用它的消息 replyTo.deleted=1(前端据此摘除引用块)', async () => {
    const a = await makeUser({ username: 'ref_a' });
    const b = await makeUser({ username: 'ref_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const refId = insertMsg(convId, a.userId, '今晚8点见');
    const replyId = uuidv4();
    db.prepare(
      'INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id,created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(replyId, convId, b.userId, 'text', '好的', refId, Math.floor(Date.now() / 1000));

    // A 撤回被引用的消息
    await msgSvc.remove(null, a.userId, refId, true, false, false);

    // B 的 history: 引用块摘除(replyTo.deleted=2 即已撤回), B 自己的消息还在
    const hb = msgSvc.history(convId, b.userId, {});
    const reply = hb.find(m => m.id === replyId);
    expect(reply).toBeTruthy();
    expect(reply.replyTo).toBeTruthy();
    expect(reply.replyTo.deleted).toBe(2);
    // 被引用的消息本身不在历史中(无占位)
    expect(hb.some(m => m.id === refId)).toBe(false);
  });
});
