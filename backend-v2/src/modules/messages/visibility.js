'use strict';
const { db } = require('../../db/connection');

// Current authorization, never a cached message snapshot. This implements existing
// per-account deletion/clear semantics; it deliberately does not invent a burn clock.
function canReadMessage(userId, messageId) {
  return !!db.prepare(`SELECT 1 FROM messages m
    JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=?
    WHERE m.id=? AND m.deleted=0
      AND NOT EXISTS (SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=cm.user_id)
      AND m.rowid>COALESCE((SELECT cleared_rowid FROM conversation_clears
        WHERE user_id=cm.user_id AND conversation_id=m.conversation_id),0)`)
    .get(userId, messageId);
}

function projectReply(userId, reply) {
  if (!reply) return null;
  if (canReadMessage(userId, reply.id)) return reply;
  const current = db.prepare('SELECT deleted FROM messages WHERE id=?').get(reply.id);
  return current?.deleted ? { id: reply.id, type: reply.type, content: '', file_url: '', deleted: current.deleted, senderName: '' } : null;
}

function projectMessage(userId, message) {
  if (!message || !canReadMessage(userId, message.id)) return null;
  return { ...message, replyTo: projectReply(userId, message.replyTo) };
}

function projectEvent(userId, event, payload) {
  if (event === 'new_message') return projectMessage(userId, payload);
  if (event === 'new_message_batch') {
    const messages = payload.map(m => projectMessage(userId, m)).filter(Boolean);
    return messages.length ? messages : null;
  }
  const id = payload?.msgId || payload?.messageId || payload?.lastMsgId;
  return id && !canReadMessage(userId, id) ? null : payload;
}

function emitVisible(io, conversationId, event, payload) {
  if (!io) return;
  for (const { user_id } of db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').all(conversationId)) {
    const visible = projectEvent(user_id, event, payload);
    if (visible) io.to(`user_${user_id}`).emit(event, visible);
  }
}

module.exports = { projectReply, canReadMessage, projectMessage, projectEvent, emitVisible };
