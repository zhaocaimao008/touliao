'use strict';
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');
const { readDb } = require('../../db/connection');
const { writeAsync } = require('../../db/writer');
const { pushNewMessage } = require('../../utils/push');
const presence = require('../presence');
const broadcaster = require('../broadcaster');
const prodMetrics = require('../../utils/prodMetrics');

const MAX = config.limits.maxMsgLength;

// @提及检测：解析 content 中的 @用户名，向群内匹配成员推送
function handleMentions(io, userId, conversationId, content) {
  if (typeof content !== 'string') return;
  const mentionRe = /@([^\s,，。！？]+)/g;
  const mentioned = [];
  let m;
  while ((m = mentionRe.exec(content)) !== null) mentioned.push(m[1]);
  if (mentioned.length === 0) return;

  const uniqueNames = [...new Set(mentioned)];
  const memberIds = readDb.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?')
    .all(conversationId).map(m => m.user_id);
  if (memberIds.length === 0) return;

  const matched = readDb.prepare(
    `SELECT id, username FROM users
     WHERE username IN (${uniqueNames.map(() => '?').join(',')})
       AND id IN (${memberIds.map(() => '?').join(',')})`
  ).all(...uniqueNames, ...memberIds);

  const groupName = readDb.prepare('SELECT name FROM conversations WHERE id=?').get(conversationId)?.name || '群聊';
  const preview = content.length > 50 ? content.slice(0, 50) + '…' : content;
  const senderName = presence.getProfile(userId).username || '';

  for (const u of matched) {
    if (u.id !== userId) {
      io.to(`user_${u.id}`).emit('@mention', {
        fromUserId: userId, fromUserName: senderName, groupName,
        messagePreview: preview, conversationId,
      });
    }
  }
}

/**
 * 幂等性检测：如果该消息已有 client_msg_id 且 database 中已存在相同(sender_id, client_msg_id)，
 * 则直接返回已落库的消息，不重复写入。（fix: 防止弱网 ack 超时重发导致消息重复）
 */
function checkDedup(userId, clientMsgId) {
  if (!clientMsgId) return null;
  return readDb.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.sender_id=? AND m.client_msg_id=? LIMIT 1
  `).get(userId, clientMsgId);
}

module.exports = function registerMessageHandler(io, socket) {
  const userId = socket.user.id;

  socket.on('send_message', async (data, ack) => {
    // 监控：包装 ack，自动记录消息发送成功率与服务端处理延迟
    const _t0 = Date.now();
    const _ack = ack;
    ack = (resp) => { prodMetrics.recordMsg(!!resp?.success, resp?.success ? Date.now() - _t0 : undefined); _ack?.(resp); };
    try {
    const { conversationId, content, reply_to_id, clientMsgId } = data;
    // 允许文本与名片(contact_card)；名片的 content 是被分享用户的 JSON 快照
    const type = ['text', 'contact_card'].includes(data.type) ? data.type : 'text';

    if (!conversationId || !content) return;
    if (!presence.checkMsgRate(userId)) { ack?.({ success: false, error: '发送频率过高，请稍后再试' }); return; }
    if (typeof content === 'string' && content.length > MAX) {
      ack?.({ success: false, error: `消息内容不能超过 ${MAX} 个字符` }); return;
    }

    // ── 幂等性去重（fix: 防止弱网 ack 超时重发导致消息重复）──
    if (clientMsgId) {
      const existing = checkDedup(userId, clientMsgId);
      if (existing) {
        // 已处理过：直接返回已存在的消息，不重复写入
        const msg = {
          id: existing.id, conversation_id: existing.conversation_id,
          sender_id: existing.sender_id, type: existing.type,
          content: existing.content, file_url: existing.file_url || '',
          reply_to_id: existing.reply_to_id || null,
          deleted: existing.deleted, edited: existing.edited,
          created_at: existing.created_at,
          senderName: existing.senderName || '',
          senderAvatar: existing.senderAvatar || '',
          reactions: [], replyTo: null,
        };
        ack?.({ success: true, message: msg });
        return;
      }
    }

    const member = readDb.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conversationId, userId);
    if (!member) { ack?.({ success: false, error: '非群成员' }); return; }

    const conv = readDb.prepare('SELECT mute_all FROM conversations WHERE id=?').get(conversationId);
    if (conv?.mute_all && member.role === 'member') {
      ack?.({ success: false, error: '全员禁言中，您没有发言权限' }); return;
    }

    const id = uuidv4();
    const created_at = Math.floor(Date.now() / 1000);
    const profile = presence.getProfile(userId);

    const msg = {
      id, conversation_id: conversationId, sender_id: userId, type, content,
      file_url: '', reply_to_id: reply_to_id || null, deleted: 0, edited: 0, created_at,
      senderName: profile.username || '', senderAvatar: profile.avatar || '',
      reactions: [], replyTo: null,
      client_msg_id: clientMsgId || null, // 带回客户端,使其用此匹配并替换乐观消息(防重连自动重发后乐观+广播双显)
    };

    // 一律等 worker commit 后再广播/回执，确保消息已落库（消除丢失与读后不一致）
    if (reply_to_id) {
      await writeAsync(
        'INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id,created_at,client_msg_id) VALUES (?,?,?,?,?,?,?,?)',
        [id, conversationId, userId, type, content, reply_to_id, created_at, clientMsgId || null]
      );
      msg.replyTo = readDb.prepare(`
        SELECT m.id, m.type, m.content, m.file_url, u.username AS senderName
        FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.id = ? AND m.conversation_id = ?
      `).get(reply_to_id, conversationId) || null;
    } else {
      await writeAsync(
        'INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id,created_at,client_msg_id) VALUES (?,?,?,?,?,?,?,?)',
        [id, conversationId, userId, type, content, null, created_at, clientMsgId || null]
      );
    }

    broadcaster.broadcastMessage(conversationId, msg); // 批量合并派发（客户端按 id 去重，发送者收到自身消息会被忽略）
    ack?.({ success: true, message: msg });

    if (type === 'text') handleMentions(io, userId, conversationId, content);

    setImmediate(() => {
      const members = readDb.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').all(conversationId);
      const onlineRecipients = members.map(m => m.user_id).filter(uid => uid !== userId && presence.isOnline(uid));
      if (onlineRecipients.length > 0) {
        presence.recordDeliveries(id, onlineRecipients);
        io.to(`user_${userId}`).emit('message_delivered', { messageId: id, conversationId, deliveredCount: onlineRecipients.length });
      }
      pushNewMessage({
        conversationId, senderId: userId, senderName: msg.senderName, content, type,
        timestamp: created_at, onlineUserIds: presence.onlineUserIdSet(), members,
      }).catch(() => {});
    });
    } catch (err) {
      ack?.({ success: false, error: '服务器内部错误，请重试' });
    }
  });
};
