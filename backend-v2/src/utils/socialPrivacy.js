'use strict';
const { db } = require('../db/connection');

// Authoritative projection, applied AFTER reading the shared profile cache.
// Group membership does not grant access to hidden profile fields.
function visibleProfileIds(viewerId, ids) {
  const allowed = new Set();
  for (let start = 0; start < ids.length; start += 400) {
    const part = ids.slice(start, start + 400);
    const rows = db.prepare(`SELECT u.id FROM users u LEFT JOIN user_settings s ON s.user_id=u.id
      WHERE u.id IN (${part.map(() => '?').join(',')}) AND (u.id=? OR (
        NOT EXISTS (SELECT 1 FROM blocked_users b WHERE
          (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?))
        AND (COALESCE(s.profile_visible,1)=1 OR EXISTS
          (SELECT 1 FROM contacts c WHERE c.user_id=? AND c.contact_id=u.id))))`)
      .all(...part, viewerId, viewerId, viewerId, viewerId);
    rows.forEach(row => allowed.add(row.id));
  }
  return allowed;
}
function projectProfiles(viewerId, rows) {
  const allowed = visibleProfileIds(viewerId, rows.map(r => r.id));
  return rows.map(row => {
    if (allowed.has(row.id)) return row;
    const copy = { ...row };
    for (const field of ['bio', 'cover_photo']) if (field in copy) copy[field] = '';
    delete copy.last_online_at;
    return copy;
  });
}

// Same policy for initial group creation and subsequent direct invitations.
function directInvitees(inviterId, ids) {
  const unique = [...new Set(ids)].filter(id => id !== inviterId);
  if (!unique.length) return [];
  return db.prepare(`SELECT u.id FROM users u JOIN contacts c ON c.contact_id=u.id AND c.user_id=?
    LEFT JOIN user_settings s ON s.user_id=u.id
    WHERE u.id IN (${unique.map(() => '?').join(',')}) AND COALESCE(u.banned,0)=0
      AND COALESCE(s.no_direct_group_invite,0)=0
      AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE
        (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?))`)
    .all(inviterId, ...unique, inviterId, inviterId).map(row => row.id);
}
module.exports = { visibleProfileIds, projectProfiles, directInvitees };
