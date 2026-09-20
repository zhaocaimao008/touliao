'use strict';
// Fresh reads: a call may be accepted/resumed long after the initial invitation.
const { readDb } = require('../db/connection');
function privateContactDenial(senderId, recipientId) {
  const blocked = readDb.prepare('SELECT 1 FROM blocked_users WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?) LIMIT 1')
    .get(senderId, recipientId, recipientId, senderId);
  if (blocked) return 'CONTACT_BLOCKED';
  if (readDb.prepare('SELECT banned FROM users WHERE id=?').get(recipientId)?.banned ||
      readDb.prepare('SELECT banned FROM users WHERE id=?').get(senderId)?.banned) return 'ACCOUNT_UNAVAILABLE';
  const settings = readDb.prepare('SELECT block_unknown_messages FROM user_settings WHERE user_id=?').get(recipientId);
  if (settings?.block_unknown_messages && !readDb.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(recipientId, senderId)) return 'CONTACT_NOT_ALLOWED';
  return null;
}
module.exports = { privateContactDenial };
