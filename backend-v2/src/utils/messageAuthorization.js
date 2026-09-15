'use strict';
const { db } = require('../db/connection');
const { badRequest, forbidden, notFound } = require('./http');

function requireMessageAccess(messageId, userId) {
  if (typeof messageId !== 'string' || !messageId || messageId.length > 128) throw badRequest('messageId 无效');
  const message = db.prepare('SELECT sender_id, conversation_id FROM messages WHERE id=?').get(messageId);
  if (!message) throw notFound('消息不存在');
  if (!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(message.conversation_id, userId)) {
    throw forbidden('无权访问此消息');
  }
  return message;
}

module.exports = { requireMessageAccess };
