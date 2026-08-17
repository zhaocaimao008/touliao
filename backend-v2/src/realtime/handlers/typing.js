'use strict';
/**
 * typing 状态 + 房间加入。
 *   - typing/stop_typing 必须已在房间内（socket.rooms.has）才广播，防越权
 *   - 30s 无更新自动发 stop_typing，防幽灵"正在输入"
 *   - join_conversation/join_group 入房前校验 DB 成员资格（S1 修复）
 */
const { readDb } = require('../../db/connection');
const { guardPayload, guardId } = require('../guard');

// P1-07 SOCKET-003：typing 限流 —— 每 (userId, conversationId) 至少 400ms 才广播一次，
// 窗口内重复 typing 直接丢弃（不广播、不重置 timer）。1 个 socket 100 次/秒 → 最多 2.5 次/秒
// 广播，大群事件风暴/DoS 被截断。节流表带过期清理，防 Map 无限增长。
const TYPING_THROTTLE_MS = 400;
const TYPING_THROTTLE_MAX = 20000;      // 超过此规模触发惰性清理
const TYPING_THROTTLE_TTL = 60 * 1000;   // 条目 60s 未更新即视为过期
const typingThrottle = new Map(); // `${userId}:${conversationId}` → lastTs
function throttleTyping(userId, conversationId) {
  const now = Date.now();
  const key = `${userId}:${conversationId}`;
  const last = typingThrottle.get(key);
  if (last && now - last < TYPING_THROTTLE_MS) return false;
  typingThrottle.set(key, now);
  if (typingThrottle.size > TYPING_THROTTLE_MAX) {
    // 惰性清理：只保留最近 TTL 内仍活跃的条目
    for (const [k, ts] of typingThrottle) {
      if (now - ts > TYPING_THROTTLE_TTL) typingThrottle.delete(k);
    }
  }
  return true;
}

module.exports = function registerTypingHandler(io, socket) {
  const userId = socket.user.id;
  const typingTimers = new Map(); // conversationId → timeoutId

  function clearTyping(convId) {
    const t = typingTimers.get(convId);
    if (t) { clearTimeout(t); typingTimers.delete(convId); }
  }

  socket.on('typing', (payload) => {
    const p = guardPayload(socket, 'typing', payload);
    if (!p) return;
    const conversationId = guardId(socket, 'typing', 'conversationId', p.conversationId);
    if (!conversationId || !socket.rooms.has(conversationId)) return;
    // P1-07 SOCKET-003：窗口内重复 typing 直接丢弃，不广播不重置 timer
    if (!throttleTyping(userId, conversationId)) return;
    clearTyping(conversationId);
    socket.to(conversationId).emit('typing', { userId, conversationId });
    typingTimers.set(conversationId, setTimeout(() => {
      socket.to(conversationId).emit('stop_typing', { userId, conversationId });
      typingTimers.delete(conversationId);
    }, 30000));
  });

  socket.on('stop_typing', (payload) => {
    const p = guardPayload(socket, 'stop_typing', payload);
    if (!p) return;
    const conversationId = guardId(socket, 'stop_typing', 'conversationId', p.conversationId);
    if (!conversationId || !socket.rooms.has(conversationId)) return;
    clearTyping(conversationId);
    socket.to(conversationId).emit('stop_typing', { userId, conversationId });
  });

  function joinIfMember(payload) {
    const p = guardPayload(socket, 'join_conversation', payload);
    if (!p) return;
    const conversationId = guardId(socket, 'join_conversation', 'conversationId', p.conversationId);
    if (!conversationId) return;
    const ok = readDb.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conversationId, userId);
    if (ok) socket.join(conversationId);
  }
  socket.on('join_conversation', joinIfMember);
  socket.on('join_group',        joinIfMember);

  // 暴露给 index.js 在 disconnect 时清理
  return {
    cleanup() {
      for (const [convId, t] of typingTimers) {
        clearTimeout(t);
        socket.to(convId).emit('stop_typing', { userId, conversationId: convId });
      }
      typingTimers.clear();
    },
  };
};

// ── P1-07 测试钩子（生产无副作用，仅断言节流状态）──────────────
module.exports._throttle = { throttleTyping, typingThrottle, TYPING_THROTTLE_MS, TYPING_THROTTLE_MAX, TYPING_THROTTLE_TTL };
