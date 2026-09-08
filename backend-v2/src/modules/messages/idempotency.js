'use strict';
const { db } = require('../../db/connection');
const { badRequest, conflict } = require('../../utils/http');
const { buildMessage } = require('./shared');
function normalizeKey(value) {
  if (value === undefined) return require('crypto').randomUUID(); // legacy callers; key is returned in the message
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw badRequest('client_msg_id 必须为 1-128 字符');
  return value;
}
function replay(conversationId, userId, key, { content, type, reply_to_id, file_url }) {
  require('./shared').requireMember(conversationId,userId);
  const row = db.prepare('SELECT * FROM messages WHERE conversation_id=? AND sender_id=? AND client_msg_id=?').get(conversationId,userId,key);
  if (!row) return null;
  if (!row.deleted && (row.content !== content || row.type !== type || (row.reply_to_id || null) !== (reply_to_id || null) || (file_url !== undefined && row.file_url !== file_url))) throw conflict('client_msg_id 已用于其他消息');
  const msg = buildMessage(row.id);
  // Acknowledging a removed message must never resurrect its content.
  const hidden = row.deleted || db.prepare('SELECT 1 FROM user_message_deletions WHERE message_id=? AND user_id=?').get(row.id,userId) ||
    db.prepare('SELECT 1 FROM conversation_clears WHERE user_id=? AND conversation_id=? AND cleared_rowid >= (SELECT rowid FROM messages WHERE id=?)').get(userId,conversationId,row.id);
  if (hidden) return { id: row.id, conversation_id: conversationId, client_msg_id: key, server_sequence: row.server_sequence, deleted: row.deleted || 1, content: '', file_url: '', replyTo: null };
  return msg;
}
module.exports = { normalizeKey, replay };
