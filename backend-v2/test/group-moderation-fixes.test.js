'use strict';
/**
 * 群管理边界（2026-09-27 全面检查）：
 *  · 管理员只能撤回普通成员的消息，不能撤回群主/其他管理员的（与踢人规则一致）
 *  · 被踢出群后清掉个人会话设置（与主动退群一致）
 *  · 已撤回的消息不再出现在置顶列表
 *  · 「退群」接口不能作用于私聊
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const msgSvc = require('../src/modules/messages/messages.service');
const grpSvc = require('../src/modules/groups/groups.service');
const { db } = require('../src/db/connection');
const { v4: uuidv4 } = require('uuid');

function insertMsg(convId, senderId, content = 'hello') {
  const id = uuidv4();
  db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, convId, senderId, 'text', content, Math.floor(Date.now() / 1000));
  return id;
}

async function makeGroup(tag) {
  const owner = await makeUser({ username: `gm_${tag}_o` });
  const admin = await makeUser({ username: `gm_${tag}_a` });
  const member = await makeUser({ username: `gm_${tag}_m` });
  await befriend(owner, admin);
  await befriend(owner, member);
  const res = await request(app).post('/api/messages/conversation/group')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: `群${tag}`, memberIds: [admin.userId, member.userId] });
  expect(res.status).toBe(200);
  const convId = res.body.id || res.body.conversationId;
  grpSvc.setRole(null, convId, owner.userId, admin.userId, 'admin');
  return { convId, owner, admin, member };
}

describe('群管理边界', () => {
  test('管理员可撤回普通成员消息，不能撤回群主消息；群主可撤回管理员消息', async () => {
    const { convId, owner, admin, member } = await makeGroup('recall');
    const byMember = insertMsg(convId, member.userId);
    const byOwner = insertMsg(convId, owner.userId);
    const byAdmin = insertMsg(convId, admin.userId);
    await expect(msgSvc.remove(null, admin.userId, byMember, true, false, false)).resolves.not.toThrow();
    await expect(msgSvc.remove(null, admin.userId, byOwner, true, false, false)).rejects.toThrow('无权');
    await expect(msgSvc.remove(null, owner.userId, byAdmin, true, false, false)).resolves.not.toThrow();
    const n = await msgSvc.batchDelete(null, admin.userId, { msgIds: [byOwner], conversationId: convId });
    expect(n).toBe(0);
  });

  test('被踢出群后个人会话设置被清理', async () => {
    const { convId, owner, member } = await makeGroup('kick');
    db.prepare('INSERT OR REPLACE INTO conversation_settings (conversation_id,user_id,archived) VALUES (?,?,1)').run(convId, member.userId);
    grpSvc.kick(null, convId, owner.userId, member.userId);
    expect(db.prepare('SELECT 1 FROM conversation_settings WHERE conversation_id=? AND user_id=?').get(convId, member.userId)).toBeUndefined();
  });

  test('已撤回的置顶消息不出现在置顶列表', async () => {
    const { convId, owner, member } = await makeGroup('pin');
    const msgId = insertMsg(convId, member.userId, '要置顶的消息');
    grpSvc.pinMessage(null, convId, owner.userId, msgId);
    expect(grpSvc.listPinned(convId, owner.userId).map(p => p.msgId)).toContain(msgId);
    await msgSvc.remove(null, member.userId, msgId, true, false, false);
    expect(grpSvc.listPinned(convId, owner.userId).map(p => p.msgId)).not.toContain(msgId);
  });

  test('退群接口不能作用于私聊', async () => {
    const a = await makeUser({ username: 'gm_leave_a' });
    const b = await makeUser({ username: 'gm_leave_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    expect(() => grpSvc.leave(null, convId, a.userId)).toThrow('群不存在');
    expect(db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, a.userId)).toBeTruthy();
  });
});
