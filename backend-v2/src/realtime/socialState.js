'use strict';
const { db } = require('../db/connection');
// Additive invalidation only. Private values never enter this event.
function invalidateSocial(io, userIds, scopes = ['relationships', 'profiles', 'conversations', 'privacy']) {
  const recipients = [...new Set(userIds.filter(Boolean))];
  const { invalidateConvCacheForUser } = require('../modules/conversations/conversations.service');
  for (const userId of recipients) {
    invalidateConvCacheForUser(userId);
    if (io) io.to(`user_${userId}`).emit('social_state_changed', { userId, scopes });
  }
  require('./handlers/call').reconcilePermissions(io, recipients);
}
function profileAudience(userId) {
  return [userId, ...db.prepare(`SELECT user_id FROM contacts WHERE contact_id=?
    UNION SELECT b.user_id FROM conversation_members a JOIN conversation_members b
      ON a.conversation_id=b.conversation_id WHERE a.user_id=?`).all(userId, userId).map(r => r.user_id)];
}
function profileChanged(io, userId) {
  invalidateSocial(null, profileAudience(userId));
  // Public profiles can be open on an unrelated stranger's device too. A value-
  // free broadcast invalidates those projections without revealing whose setting changed.
  if (io) io.emit('social_state_changed', { scopes: ['profiles', 'privacy', 'conversations'] });
  require('./handlers/call').reconcilePermissions(io, [userId]);
}
module.exports = { invalidateSocial, profileChanged };
