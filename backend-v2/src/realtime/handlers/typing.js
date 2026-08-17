'use strict';
/**
 * typing 状态 + 房间加入。
 *   - typing/stop_typing 必须已在房间内（socket.rooms.has）才广播，防越权
 *   - 30s 无更新自动发 stop_typing，防幽灵"正在输入"
 *   - join_conversation/join_group 入房前校验 DB 成员资格（S1 修复）
 */
const { readDb } = require('../../db/connection');
const { guardPayload, guardId } = require('../guard');

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
