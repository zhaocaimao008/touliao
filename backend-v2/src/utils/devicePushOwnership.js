'use strict';
const { db } = require('../db/connection');

// A provider response can arrive after this token moved to another login session.
function isCurrent(row) {
  return !!db.prepare(`SELECT 1 FROM device_tokens
    WHERE id=? AND user_id=? AND token=? AND platform=? AND session_id IS ?`)
    .get(row.id, row.user_id, row.token, row.platform, row.session_id ?? null);
}

function forget(row) {
  return db.prepare(`DELETE FROM device_tokens
    WHERE id=? AND user_id=? AND token=? AND platform=? AND session_id IS ?`)
    .run(row.id, row.user_id, row.token, row.platform, row.session_id ?? null);
}

module.exports = { isCurrent, forget };
