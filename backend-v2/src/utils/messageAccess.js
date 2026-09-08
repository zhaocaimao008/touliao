'use strict';
const { db } = require('../db/connection');
const { badRequest, forbidden } = require('./http');
function requireMessageMember(messageId, userId) {
  if (typeof messageId !== 'string' || !messageId || messageId.length > 128) throw badRequest('无效 messageId');
  const row = db.prepare(`SELECT m.id FROM messages m JOIN conversation_members cm
    ON cm.conversation_id=m.conversation_id AND cm.user_id=? WHERE m.id=?`).get(userId, messageId);
  if (!row) throw forbidden('无权访问该消息');
}
module.exports = { requireMessageMember };
