'use strict';
/**
 * 消息域共享：成员校验、单条消息装配。
 * io 永远从 controller 经参数传入，service 层不直接引用 app。
 */
const { db, readDb } = require('../../db/connection');
const { forbidden } = require('../../utils/http');

function isMember(convId, userId) {
  return !!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, userId);
}

// 私聊黑名单校验：任一方已拉黑对方，则拒绝在既有会话内发消息（防止拉黑后仍被骚扰）。
// 与 getOrCreatePrivate / 通话 / 朋友圈的黑名单拦截保持一致；群聊(type!=private)不受影响。
// 返回拒绝原因字符串；允许发送时返回 null。读走 readDb（block() 经 db 同步提交，此处立即可见）。
function privateSendBlockReason(convId, senderId) {
  const conv = readDb.prepare('SELECT type FROM conversations WHERE id=?').get(convId);
  if (conv?.type !== 'private') return null;
  const other = readDb.prepare(
    'SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id!=?'
  ).get(convId, senderId);
  if (!other) return null;
  const bl = readDb.prepare(
    'SELECT user_id FROM blocked_users WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)'
  ).all(senderId, other.user_id, other.user_id, senderId);
  if (!bl.length) return null;
  return bl.some(r => r.user_id === senderId)
    ? '你已将对方加入黑名单，移出后才能发送'
    : '消息已发出，但被对方拒收';
}

// 屏蔽陌生人消息：私聊会话中，若接收方开启了该设置且发送者不在其联系人中，则拒收。
// 与 privateSendBlockReason(拉黑) 并列，须覆盖全部发送路径——文本(HTTP/socket)与
// 文件/图片/语音/视频/表情(saveUploadedFile)。返回拒绝原因；允许时返回 null。
// 场景：双方曾是好友(私聊会话已建)，接收方删除好友后开启屏蔽陌生人——旧会话仍在，
// 若只拦文本不拦文件，陌生人仍可经既有会话用图片/文件骚扰。
function strangerBlockReason(convId, senderId) {
  const conv = readDb.prepare('SELECT type FROM conversations WHERE id=?').get(convId);
  if (conv?.type !== 'private') return null;
  const other = readDb.prepare(
    'SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id!=?'
  ).get(convId, senderId);
  if (!other) return null;
  const setting = readDb.prepare('SELECT block_unknown_messages FROM user_settings WHERE user_id=?').get(other.user_id);
  if (!setting?.block_unknown_messages) return null;
  const isFriend = readDb.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(other.user_id, senderId);
  return isFriend ? null : '对方已开启屏蔽陌生人消息';
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

module.exports = { isMember, requireMember, memberRole, buildMessage, purgeConversation, privateSendBlockReason, strangerBlockReason };
