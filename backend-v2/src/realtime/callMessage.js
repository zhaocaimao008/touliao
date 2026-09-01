'use strict';
/**
 * 通话系统消息（微信行为对齐）：通话结束在双方聊天窗口写一条 type='call' 消息。
 *
 * 背景（2026-09-01）：此前通话只落 call_logs，聊天窗口没有任何痕迹——打完电话回会话
 * 看不到"通话时长 30 秒/已取消/对方已拒绝/未接听"。本模块在通话到达终态时写一条
 * type='call' 消息（复用 nudge 的落库+广播模式），四端渲染为居中系统提示。
 *
 * content 存 JSON：
 *   { callId, status, duration, callType, callerId, text, participants? }
 *   - status: completed|canceled|rejected|missed（missed=120s 未接超时）
 *   - text: 人读文案 fallback（新端解析失败时降级显示；老端兜底显示 content 原文，
 *     与 nudge 的 JSON content 先例一致，不会崩）
 *   - callerId: 客户端据此区分主叫/被叫文案
 * 去重：content LIKE %callId% 防 call:end 重复触发写两条。
 */
const { v4: uuidv4 } = require('uuid');
const { readDb } = require('../db/connection');
const { SEQUENCE_PARAM } = require('../db/writer');
const { appendConversationEvent, emitSyncAvailable } = require('../modules/messages/sync.service');
const broadcaster = require('./broadcaster');
const presence = require('./presence');

// 两用户间的私聊会话（无则返回 null——不自动建，通话消息不该凭空造会话）
const _findPrivateConv = readDb.prepare(`
  SELECT c.id FROM conversations c
  JOIN conversation_members cm1 ON cm1.conversation_id=c.id AND cm1.user_id=?
  JOIN conversation_members cm2 ON cm2.conversation_id=c.id AND cm2.user_id=?
  WHERE c.type='private'
`);

const _alreadyWritten = readDb.prepare(
  "SELECT 1 FROM messages WHERE type='call' AND conversation_id=? AND content LIKE ? LIMIT 1"
);

const STATUS_TEXT = {
  completed: (d, t) => `${t === 'video' ? '视频通话' : '语音通话'} ${fmtDuration(d)}`,
  canceled:  () => '已取消',
  rejected:  () => '对方已拒绝',
  missed:    () => '对方无应答',
};

function fmtDuration(s) {
  const n = Math.max(0, Number(s) || 0);
  if (n < 60) return `${n} 秒`;
  const m = Math.floor(n / 60), sec = n % 60;
  return sec > 0 ? `${m} 分 ${sec} 秒` : `${m} 分钟`;
}

/**
 * 写一条通话系统消息并广播（幂等：同一 callId 只写一次）。
 * @param {object} opts
 *   callId, status(completed|canceled|rejected|missed), duration, callType(audio|video),
 *   callerId, calleeId(1对1) | conversationId(群), participants?(群)
 * @param {object} io socket.io 实例（emitSyncAvailable 用）
 */
async function writeCallMessage(opts, io) {
  try {
    const { callId, status, duration = 0, callType = 'audio', callerId, conversationId, participants } = opts;
    if (!callId || !callerId) return;

    // 1 对 1：按双方找私聊会话；找不到（非好友/被拉黑等边缘）则跳过，不硬造会话
    let convId = conversationId;
    if (!convId) {
      const found = _findPrivateConv.get(callerId, opts.calleeId);
      if (!found) return;
      convId = found.id;
    }

    // 幂等：同一通话只写一条（call:end 可能重复触发：断线+主动挂断等）
    if (_alreadyWritten.get(convId, `%${callId}%`)) return;

    const text = STATUS_TEXT[status]
      ? STATUS_TEXT[status](duration, callType)
      : '通话结束';
    const content = JSON.stringify({
      callId, status, duration, callType, callerId, text,
      ...(participants != null ? { participants } : {}),
    });

    const id = uuidv4();
    const created_at = Math.floor(Date.now() / 1000);
    const sequenced = await appendConversationEvent({
      conversationId: convId, eventType: 'message_created', messageId: id, actorId: callerId,
      ops: [{
        sql: `INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id,created_at,client_msg_id,server_sequence) VALUES (?,?,?,?,?,?,?,?,?)`,
        params: [id, convId, callerId, 'call', content, null, created_at, null, SEQUENCE_PARAM],
      }],
    });

    const msg = {
      id, conversation_id: convId, sender_id: callerId, type: 'call', content,
      file_url: '', reply_to_id: null, deleted: 0, edited: 0, created_at,
      senderName: presence.getProfile(callerId)?.username || '',
      senderAvatar: presence.getProfile(callerId)?.avatar || '',
      reactions: [], replyTo: null,
    };
    broadcaster.broadcastMessage(convId, msg);
    if (sequenced) emitSyncAvailable(io, convId, sequenced.server_sequence);
  } catch (e) {
    // 通话消息是体验增强：写入失败不影响通话主流程，只记日志
    console.warn('[call-msg] 写入通话消息失败:', e.message);
  }
}

module.exports = { writeCallMessage };
