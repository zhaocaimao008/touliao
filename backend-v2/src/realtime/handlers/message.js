'use strict';
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');
const { readDb } = require('../../db/connection');
const { writeAsync } = require('../../db/writer');
const { pushNewMessage } = require('../../utils/push');
const presence = require('../presence');
const broadcaster = require('../broadcaster');
const prodMetrics = require('../../utils/prodMetrics');
const { privateSendBlockReason, strangerBlockReason } = require('../../modules/messages/shared');

const MAX = config.limits.maxMsgLength;

// @提及检测：解析 content 中的 @用户名，向群内匹配成员推送
function handleMentions(io, userId, conversationId, content, msgId) {
  if (typeof content !== 'string') return;
  const mentionRe = /@([^\s,，。！？]+)/g;
  const mentioned = [];
  let m;
  while ((m = mentionRe.exec(content)) !== null) mentioned.push(m[1]);
  if (mentioned.length === 0) return;

  // 最多处理 50 个唯一提及，超出截断，防止 SQLite 变量数越界
  const uniqueNames = [...new Set(mentioned)].slice(0, 50);

  const matched = readDb.prepare(
    `SELECT u.id, u.username FROM users u
     JOIN conversation_members cm ON cm.user_id=u.id AND cm.conversation_id=?
     WHERE u.username IN (${uniqueNames.map(() => '?').join(',')})`
  ).all(conversationId, ...uniqueNames);

  const groupName = readDb.prepare('SELECT name FROM conversations WHERE id=?').get(conversationId)?.name || '群聊';
  const preview = content.length > 50 ? content.slice(0, 50) + '…' : content;
  const senderName = presence.getProfile(userId).username || '';

  for (const u of matched) {
    if (u.id !== userId) {
      io.to(`user_${u.id}`).emit('mentioned', {
        fromUserId: userId, fromUserName: senderName, groupName,
        messagePreview: preview, conversationId, msgId: msgId || '',
      });
    }
  }
}

/**
 * 幂等性检测：如果该消息已有 client_msg_id 且 database 中已存在相同(sender_id, client_msg_id)，
 * 则直接返回已落库的消息，不重复写入。（fix: 防止弱网 ack 超时重发导致消息重复）
 */
function checkDedup(userId, clientMsgId, conversationId) {
  if (!clientMsgId) return null;
  return readDb.prepare(`
    SELECT m.*, u.username as senderName, u.avatar as senderAvatar
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.sender_id=? AND m.client_msg_id=? AND m.conversation_id=? LIMIT 1
  `).get(userId, clientMsgId, conversationId);
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

    if (!conversationId || !content) { ack?.({ success: false, error: '参数不完整' }); return; }
    // 与 HTTP 发送路径(messages.service.send)口径一致：content 必须是字符串，
    // 否则非 string（如对象）会绕过下方长度校验后原样入库。命中即 ack 失败拒绝。
    if (typeof content !== 'string') { ack?.({ success: false, error: '消息内容格式错误' }); return; }
    if (!presence.checkMsgRate(userId)) { ack?.({ success: false, error: '发送频率过高，请稍后再试' }); return; }
    if (content.length > MAX) {
      ack?.({ success: false, error: `消息内容不能超过 ${MAX} 个字符` }); return;
    }

    // ── 幂等性去重（fix: 防止弱网 ack 超时重发导致消息重复）──
    if (clientMsgId) {
      const existing = checkDedup(userId, clientMsgId, conversationId);
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

    const conv = readDb.prepare('SELECT mute_all, type FROM conversations WHERE id=?').get(conversationId);
    if (conv?.mute_all && member.role === 'member') {
      ack?.({ success: false, error: '全员禁言中，您没有发言权限' }); return;
    }

    // 黑名单：任一方拉黑对方即拒绝私聊发消息（防止拉黑后经既有会话继续骚扰）
    const blockReason = privateSendBlockReason(conversationId, userId);
    if (blockReason) { ack?.({ success: false, error: blockReason }); return; }

    // 屏蔽陌生人消息（私聊）——与 HTTP/文件发送路径共用同一校验
    const strangerReason = strangerBlockReason(conversationId, userId);
    if (strangerReason) { ack?.({ success: false, error: strangerReason }); return; }

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
      // 与 HTTP send / 文件发送路径一致：被回复消息必须存在且属于同一会话，
      // 否则拒绝，避免写入指向他会话或已不存在消息的悬空 reply_to_id。
      const parent = readDb.prepare('SELECT id FROM messages WHERE id=? AND conversation_id=?').get(reply_to_id, conversationId);
      if (!parent) { ack?.({ success: false, error: '被回复消息不存在' }); return; }
      await writeAsync(
        'INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id,created_at,client_msg_id) VALUES (?,?,?,?,?,?,?,?)',
        [id, conversationId, userId, type, content, reply_to_id, created_at, clientMsgId || null]
      );
      msg.replyTo = readDb.prepare(`
        SELECT m.id, m.type, m.content, m.file_url, m.deleted, u.username AS senderName
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

    setImmediate(() => {
      try {
        if (type === 'text') handleMentions(io, userId, conversationId, content, id);
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
      } catch (err) {
        console.error('[message] delivery setImmediate error:', err);
      }
    });
    } catch (err) {
      ack?.({ success: false, error: '服务器内部错误，请重试' });
    }
  });
};
