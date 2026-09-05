'use strict';
const { v4: uuidv4 } = require('uuid');
const { readDb } = require('../../db/connection');
const { SEQUENCE_PARAM } = require('../../db/writer');
const { pushNewMessage } = require('../../utils/push');
const { getPublicBase } = require('../../utils/cloudStorage');
const presence = require('../presence');
const broadcaster = require('../broadcaster');
const prodMetrics = require('../../utils/prodMetrics');
const { privateSendGuard } = require('../../modules/messages/shared');
const { lookupFile } = require('../../utils/fileRegistry');
const { appendConversationEvent, emitSyncAvailable } = require('../../modules/messages/sync.service');

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
    // 限流命中时把 retryAfterMs 一并回给客户端，由它自动退避重发（见 presence.checkMsgRate 注释）。
    // code 是给客户端做机器判断的——不能靠中文文案 match，否则改一个字客户端就失灵。
    const _rate = presence.checkMsgRate(userId);
    if (!_rate.ok) {
      ack?.({ success: false, error: '发送频率过高，请稍后再试', code: 'RATE_LIMITED', retryAfterMs: _rate.retryAfterMs });
      return;
    }

    // URL 白名单校验：只接受本服务器上传的文件 URL，防止注入任意外链（钓鱼/SSRF）。
    // 两种合法来源：
    //   1. 本地存储模式：相对路径以 /uploads/ 开头
    //   2. 云存储模式：以已配置的 CDN 公共域名开头
    const publicBase = getPublicBase();
    const isLocalUrl = typeof file_url === 'string' && file_url.startsWith('/uploads/');
    const isCloudUrl = publicBase && typeof file_url === 'string' && file_url.startsWith(publicBase + '/');
    if (!isLocalUrl && !isCloudUrl) {
      ack?.({ success: false, error: '文件 URL 非法：须为本站上传路径或已配置的云存储域名' }); return;
    }

    // P1-02：本地文件必须已登记在 file_registry（上传流程写入），
    // 防攻击者植入任意 /uploads/ URL 到消息行冒充自己的附件（planted-row 攻击）。
    if (isLocalUrl && !lookupFile(file_url)) {
      ack?.({ success: false, error: '文件不存在或已失效' }); return;
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
          client_msg_id: existing.client_msg_id || null,
          server_sequence: existing.server_sequence || 0,
          reactions: [], replyTo: null,
        };
        ack?.({ success: true, message: msg });
        return;
      }
    }

    const member = readDb.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conversationId, userId);
    if (!member) { ack?.({ success: false, error: '非群成员' }); return; }

    const conv = readDb.prepare('SELECT mute_all, type FROM conversations WHERE id=?').get(conversationId);
    if (conv?.mute_all && member.role === 'member') { ack?.({ success: false, error: '全员禁言中，您没有发言权限' }); return; }

    // 私聊守卫：黑名单 + 屏蔽陌生人合并校验（复用已取的 conv），防止陌生人用云存储文件绕过骚扰
    const guardReason = privateSendGuard(conversationId, userId, conv);
    if (guardReason) { ack?.({ success: false, error: guardReason }); return; }

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
      const sequenced = await appendConversationEvent({
        conversationId, eventType: 'message_created', messageId: id, actorId: userId,
        ops: [{
          sql: 'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,duration,reply_to_id,created_at,client_msg_id,server_sequence) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          params: [id, conversationId, userId, type, safeContent, file_url, duration, reply_to_id, created_at, clientMsgId || null, SEQUENCE_PARAM],
        }],
      });
      msg.server_sequence = sequenced.server_sequence;
      msg.replyTo = readDb.prepare(`
        SELECT m.id, m.type, m.content, m.file_url, m.deleted, u.username AS senderName
        FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.id = ? AND m.conversation_id = ?
      `).get(reply_to_id, conversationId) || null;
    } else {
      const sequenced = await appendConversationEvent({
        conversationId, eventType: 'message_created', messageId: id, actorId: userId,
        ops: [{
          sql: 'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,duration,reply_to_id,created_at,client_msg_id,server_sequence) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          params: [id, conversationId, userId, type, safeContent, file_url, duration, null, created_at, clientMsgId || null, SEQUENCE_PARAM],
        }],
      });
      msg.server_sequence = sequenced.server_sequence;
    }

    // 含发送者本人：文件/图片发送方没有乐观消息，需靠广播回显；onMsg 按 id 去重。
    // 批量合并派发。
    broadcaster.broadcastMessage(conversationId, msg);
    emitSyncAvailable(io, conversationId, msg.server_sequence);

    // AI 助手：图片/文件发到 AI 账号 → 异步转视觉识别 + 大脑回复（与文本路径一致）
    if (type === 'image') {
      try {
        const aiAssistant = require('../../modules/ai-assistant/assistant.service');
        aiAssistant.maybeReply(io, conversationId, userId, msg).catch(() => {});
      } catch (err) {
        console.error('[AI助手] 图片触发失败:', err.message);
      }
    }

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
