'use strict';
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');
const { readDb } = require('../../db/connection');
const { SEQUENCE_PARAM } = require('../../db/writer');
const { pushNewMessage } = require('../../utils/push');
const presence = require('../presence');
const broadcaster = require('../broadcaster');
const prodMetrics = require('../../utils/prodMetrics');
const { privateSendGuard, memberRole } = require('../../modules/messages/shared');
const { appendConversationEvent, emitSyncAvailable } = require('../../modules/messages/sync.service');
const moderation = require('../../modules/moderation/moderation.service');

// @所有人 的可识别 token（大小写不敏感）——仅群主/管理员使用时生效
const MENTION_ALL_TOKENS = new Set(['所有人', '全体成员', 'all', 'everyone']);

const MAX = config.limits.maxMsgLength;

// @提及检测：解析 content 中的 @用户名（含 @所有人），向群内相关成员推送 mentioned 事件
function handleMentions(io, userId, conversationId, content, msgId) {
  if (typeof content !== 'string') return;
  const mentionRe = /@([^\s,，。！？]+)/g;
  const mentioned = [];
  let m;
  while ((m = mentionRe.exec(content)) !== null) mentioned.push(m[1]);
  if (mentioned.length === 0) return;

  const groupName = readDb.prepare('SELECT name FROM conversations WHERE id=?').get(conversationId)?.name || '群聊';
  const preview = content.length > 50 ? content.slice(0, 50) + '…' : content;
  const senderName = presence.getProfile(userId).username || '';

  const targetIds = new Set();  // 去重后的待通知 userId

  // ── @所有人：仅群主/管理员生效，命中则通知全体成员（普通成员的 @所有人被静默忽略）──
  const wantAll = mentioned.some(name => MENTION_ALL_TOKENS.has(name.toLowerCase()));
  if (wantAll && ['owner', 'admin'].includes(memberRole(conversationId, userId))) {
    const all = readDb.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').all(conversationId);
    for (const r of all) if (r.user_id !== userId) targetIds.add(r.user_id);
  }

  // ── 具名 @用户名：匹配群内成员（最多 50 个唯一名，防 SQLite 变量数越界）──
  const uniqueNames = [...new Set(mentioned)]
    .filter(n => !MENTION_ALL_TOKENS.has(n.toLowerCase()))
    .slice(0, 50);
  if (uniqueNames.length) {
    const matched = readDb.prepare(
      `SELECT u.id FROM users u
       JOIN conversation_members cm ON cm.user_id=u.id AND cm.conversation_id=?
       WHERE u.username IN (${uniqueNames.map(() => '?').join(',')})`
    ).all(conversationId, ...uniqueNames);
    for (const u of matched) if (u.id !== userId) targetIds.add(u.id);
  }

  for (const uid of targetIds) {
    io.to(`user_${uid}`).emit('mentioned', {
      fromUserId: userId, fromUserName: senderName, groupName,
      messagePreview: preview, conversationId, msgId: msgId || '',
    });
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
    // 限流命中时把 retryAfterMs 一并回给客户端，由它自动退避重发（见 presence.checkMsgRate 注释）。
    // code 是给客户端做机器判断的——不能靠中文文案 match，否则改一个字客户端就失灵。
    const _rate = presence.checkMsgRate(userId);
    if (!_rate.ok) {
      ack?.({ success: false, error: '发送频率过高，请稍后再试', code: 'RATE_LIMITED', retryAfterMs: _rate.retryAfterMs });
      return;
    }
    if (content.length > MAX) {
      ack?.({ success: false, error: `消息内容不能超过 ${MAX} 个字符` }); return;
    }
    const hitWord = moderation.firstMatch(content);
    if (hitWord) {
      console.warn(`[moderation] 消息被拦截 userId=${userId} conversationId=${conversationId}`);
      ack?.({ success: false, error: '内容包含违规信息，请修改后重试' }); return;
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
          client_msg_id: existing.client_msg_id || null,
          server_sequence: existing.server_sequence || 0,
          reactions: [], replyTo: null,
        };
        ack?.({ success: true, message: msg });
        return;
      }
    }

    const member = memberRole(conversationId, userId);
    if (!member) { ack?.({ success: false, error: '非群成员' }); return; }

    const conv = readDb.prepare('SELECT mute_all, type FROM conversations WHERE id=?').get(conversationId);
    if (conv?.mute_all && member === 'member') {
      ack?.({ success: false, error: '全员禁言中，您没有发言权限' }); return;
    }

    // 私聊守卫：黑名单 + 屏蔽陌生人合并校验（复用上方已取的 conv，省去重复 conversations 查询）
    const guardReason = privateSendGuard(conversationId, userId, conv);
    if (guardReason) { ack?.({ success: false, error: guardReason }); return; }

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
      const sequenced = await appendConversationEvent({
        conversationId, eventType: 'message_created', messageId: id, actorId: userId,
        ops: [{
          sql: 'INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id,created_at,client_msg_id,server_sequence) VALUES (?,?,?,?,?,?,?,?,?)',
          params: [id, conversationId, userId, type, content, reply_to_id, created_at, clientMsgId || null, SEQUENCE_PARAM],
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
          sql: 'INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id,created_at,client_msg_id,server_sequence) VALUES (?,?,?,?,?,?,?,?,?)',
          params: [id, conversationId, userId, type, content, null, created_at, clientMsgId || null, SEQUENCE_PARAM],
        }],
      });
      msg.server_sequence = sequenced.server_sequence;
    }

    broadcaster.broadcastMessage(conversationId, msg); // 批量合并派发（客户端按 id 去重，发送者收到自身消息会被忽略）
    emitSyncAvailable(io, conversationId, msg.server_sequence);

    // AI 助手：私聊发给 AI 账号 → 异步转 OpenClaw/Hermes 生成回复（与 HTTP send() 路径一致）
    try {
      const aiAssistant = require('../../modules/ai-assistant/assistant.service');
      aiAssistant.maybeReply(io, conversationId, userId, msg).catch(() => {});
    } catch (err) {
      console.error('[AI助手] socket 触发失败:', err.message);
    }

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
