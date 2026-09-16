'use strict';
const { readDb } = require('../db/connection');
const { createHash } = require('crypto');

// Session rows are the durable authority; blacklist/cache availability cannot revive a deleted row.
function hasActiveSession(payload) {
  return !payload.jti || !!readDb.prepare('SELECT 1 FROM auth_sessions WHERE id=? AND user_id=?')
    .get(payload.jti, payload.id);
}

// Bound sessions are revoked by deleting their rows. Legacy JWTs need the account time watermark,
// including equality: multiple credential changes can happen in the same second.
function passwordRevoked(payload, changedAt) {
  return !payload.jti && !!changedAt && (!payload.iat || payload.iat <= changedAt);
}

function tokenRoom(token) {
  return `credential_${createHash('sha256').update(token).digest('hex')}`;
}

module.exports = { hasActiveSession, passwordRevoked, tokenRoom };
