'use strict';
const { v4: uuidv4 } = require('uuid');
const { readDb } = require('../../db/connection');
const { writeAsync } = require('../../db/writer');
const { pushNewMessage } = require('../../utils/push');
const { getPublicBase } = require('../../utils/cloudStorage');
const presence = require('../presence');
const broadcaster = require('../broadcaster');
const prodMetrics = require('../../utils/prodMetrics');

const TYPE_FALLBACK = { image: '[图片]', voice: '[语音]', video: '[视频]', file: '[文件]' };

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

module.exports = function registerFileHandler(io, socket) {
  const userId = socket.user.id;

  socket.on('send_file_message', async (data, ack) => {
    // 监控：包装 ack，记录消息发送成功率/延迟，以及图片上传成功率（image 类型）
    const _t0 = Date.now();
    const _ack = ack;
    const _isImg = data && data.type === 'image';
    ack = (resp) => {
      const ok = !!resp?.success;
      prodMetrics.recordMsg(ok, ok ? Date.now() - _t0 : undefined);
      if (_isImg) prodMetrics.recordImageUpload(ok);
      _ack?.(resp);
    };
    try {
    const { conversationId, type, file_url, content, reply_to_id, clientMsgId } = data;
    const duration = Math.max(0, Math.min(parseInt(data.duration, 10) || 0, 600)); // 语音/视频时长(秒)，上限10分钟
    const ALLOWED = new Set(['image', 'voice', 'video', 'file']);

    if (!conversationId || !file_url || !ALLOWED.has(type)) { ack?.({ success: false, error: '参数无效' }); return; }
    if (!presence.checkMsgRate(userId)) { ack?.({ success: false, error: '发送频率过高，请稍后再试' }); return; }

    // URL 必须来自已配置的云存储域名，防注入任意链接
    const publicBase = getPublicBase();
    if (!publicBase || !file_url.startsWith(publicBase + '/')) {
      ack?.({ success: false, error: '文件 URL 非法：不属于已配置的云存储域名' }); return;
    }

    // ── 幂等性去重（fix: 防止弱网 ack 超时重发导致消息重复）──
    if (clientMsgId) {
      const existing = checkDedup(userId, clientMsgId, conversationId);
      if (existing) {
        const msg = {
          id: existing.id, conversation_id: existing.conversation_id,
          sender_id: existing.sender_id, type: existing.type,
          content: existing.content, file_url: existing.file_url || '',
          duration: existing.duration || 0,
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
    if (conv?.mute_all && member.role === 'member') { ack?.({ success: false, error: '全员禁言中，您没有发言权限' }); return; }

    const id = uuidv4();
    const created_at = Math.floor(Date.now() / 1000);
    const profile = presence.getProfile(userId);
    const safeContent = typeof content === 'string' ? content.slice(0, 200) : '';

    const msg = {
      id, conversation_id: conversationId, sender_id: userId, type, content: safeContent, file_url,
      duration, reply_to_id: reply_to_id || null, deleted: 0, edited: 0, created_at,
      senderName: profile.username || '', senderAvatar: profile.avatar || '',
      reactions: [], replyTo: null,
      client_msg_id: clientMsgId || null, // 带回客户端用于乐观消息匹配,防重连重发双显
    };

    if (reply_to_id) {
      const parent = readDb.prepare('SELECT id FROM messages WHERE id=? AND conversation_id=?').get(reply_to_id, conversationId);
      if (!parent) { ack?.({ success: false, error: '被回复消息不存在' }); return; }
      await writeAsync(
        'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,duration,reply_to_id,created_at,client_msg_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, conversationId, userId, type, safeContent, file_url, duration, reply_to_id, created_at, clientMsgId || null]
      );
      msg.replyTo = readDb.prepare(`
        SELECT m.id, m.type, m.content, m.file_url, m.deleted, u.username AS senderName
        FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.id = ? AND m.conversation_id = ?
      `).get(reply_to_id, conversationId) || null;
    } else {
      await writeAsync(
        'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,duration,reply_to_id,created_at,client_msg_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, conversationId, userId, type, safeContent, file_url, duration, null, created_at, clientMsgId || null]
      );
    }

    // 含发送者本人：文件/图片发送方没有乐观消息，需靠广播回显；onMsg 按 id 去重。
    // 批量合并派发。
    broadcaster.broadcastMessage(conversationId, msg);
    ack?.({ success: true, message: msg });

    setImmediate(() => {
      try {
        const members = readDb.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').all(conversationId);
        const onlineRecipients = members.map(m => m.user_id).filter(uid => uid !== userId && presence.isOnline(uid));
        if (onlineRecipients.length > 0) {
          presence.recordDeliveries(id, onlineRecipients);
          io.to(`user_${userId}`).emit('message_delivered', { messageId: id, conversationId, deliveredCount: onlineRecipients.length });
        }
        pushNewMessage({
          conversationId, senderId: userId, senderName: msg.senderName,
          content: safeContent || TYPE_FALLBACK[type] || '[文件]', type,
          timestamp: created_at, onlineUserIds: presence.onlineUserIdSet(), members,
        }).catch(() => {});
      } catch (err) {
        console.error('[file] delivery setImmediate error:', err);
      }
    });
    } catch (err) {
      ack?.({ success: false, error: '服务器内部错误，请重试' });
    }
  });
};
