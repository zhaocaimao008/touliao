'use strict';
/**
 * 管理员删除用户：库里存在与本用户无关、0 成员但仍挂着消息的私聊（如对方自助注销后遗留）时，
 * 删除仍须成功。原先 deleteUser 末尾全库 DELETE 0 成员私聊，messages 外键(NO ACTION)让整笔
 * 事务回滚 → 删除任何用户都 500（生产库实测存在 1 个这样的会话）。
 */
const adminSvc = require('../src/modules/admin/admin.service');
const { makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');

test('存在别处遗留的「空成员但有消息」私聊时，删除其他用户成功且不误删该会话', async () => {
  const a = await makeUser({ username: 'orph_a' });
  const b = await makeUser({ username: 'orph_b' });
  await befriend(a, b);
  const convId = await privateConversation(a, b);
  db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at) VALUES (?, ?, ?, 'text', 'left over', strftime('%s','now'))")
    .run(require('uuid').v4(), convId, a.userId);
  db.prepare('DELETE FROM conversation_members WHERE conversation_id=?').run(convId); // 模拟双方都已离开

  const victim = await makeUser({ username: 'orph_victim' });
  expect(() => adminSvc.deleteUser(null, victim.userId)).not.toThrow();
  expect(db.prepare('SELECT 1 FROM users WHERE id=?').get(victim.userId)).toBeUndefined();
  expect(db.prepare('SELECT 1 FROM conversations WHERE id=?').get(convId)).toBeTruthy();
  expect(db.prepare('SELECT count(*) AS n FROM messages WHERE conversation_id=?').get(convId).n).toBe(1);
});

test('被删用户自己的私聊在无残留数据时被清理', async () => {
  const x = await makeUser({ username: 'orph_x' });
  const y = await makeUser({ username: 'orph_y' });
  await befriend(x, y);
  const convId = await privateConversation(x, y);
  db.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?').run(convId, y.userId);
  adminSvc.deleteUser(null, x.userId);
  expect(db.prepare('SELECT 1 FROM conversations WHERE id=?').get(convId)).toBeUndefined();
});
