'use strict';
/**
 * 消息域共享：成员校验、单条消息装配。
 * io 永远从 controller 经参数传入，service 层不直接引用 app。
 */
const { db } = require('../../db/connection');
const { forbidden } = require('../../utils/http');

function isMember(convId, userId) {
  return !!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, userId);
}

function requireMember(convId, userId, msg = '无权访问') {
  if (!isMember(convId, userId)) throw forbidden(msg);
}

function memberRole(convId, userId) {
  return db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, userId)?.role || null;
}

// 装配单条消息（含 replyTo + reactions），用于 HTTP 发送/转发等单条返回
function buildMessage(id) {
  const msg = db.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?
  `).get(id);
  if (!msg) return null;

  if (msg.reply_to_id) {
    msg.replyTo = db.prepare(`
      SELECT m.id, m.type, m.content, m.file_url, u.username as senderName
      FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=? AND m.conversation_id=?
    `).get(msg.reply_to_id, msg.conversation_id) || null;
  }
  const reactions = db.prepare(`
    SELECT emoji, GROUP_CONCAT(user_id) as userIds, COUNT(*) as count
    FROM message_reactions WHERE message_id=? GROUP BY emoji
  `).all(id);
  msg.reactions = reactions.map(r => ({ emoji: r.emoji, count: r.count, userIds: r.userIds.split(',') }));
  return msg;
}

// 彻底清除一个会话及其全部衍生数据（消息/表情/送达/FTS/置顶/红包/成员/设置/邀请令牌）。
// 必须按外键依赖顺序删除，否则 foreign_keys=ON 下删 conversations 会约束失败。
function purgeConversation(id) {
  db.transaction(() => {
    const msgIds = db.prepare('SELECT id FROM messages WHERE conversation_id=?').all(id).map(r => r.id);
    if (msgIds.length) {
      const ph = msgIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM message_reactions WHERE message_id IN (${ph})`).run(...msgIds);
      db.prepare(`DELETE FROM message_deliveries WHERE message_id IN (${ph})`).run(...msgIds);
      db.prepare(`DELETE FROM messages_fts WHERE message_id IN (${ph})`).run(...msgIds);
    }
    db.prepare('DELETE FROM pinned_messages WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM red_packet_claims WHERE packet_id IN (SELECT id FROM red_packets WHERE conversation_id=?)').run(id);
    db.prepare('DELETE FROM red_packets WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM messages WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM conversation_settings WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM group_invite_tokens WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM conversation_members WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM conversations WHERE id=?').run(id);
  })();
}

module.exports = { isMember, requireMember, memberRole, buildMessage, purgeConversation };
