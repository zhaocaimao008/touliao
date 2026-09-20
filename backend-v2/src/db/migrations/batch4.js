'use strict';
// Additive and repeatable; do not reorder previous migration entries.
module.exports = [
  `CREATE TABLE IF NOT EXISTS legal_consents (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    privacy_version TEXT NOT NULL, terms_version TEXT NOT NULL,
    accepted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY(user_id,privacy_version,terms_version)
  )`,
  `CREATE TABLE IF NOT EXISTS safety_reports (
    id TEXT PRIMARY KEY, reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('user','message','group','support')),
    target_id TEXT NOT NULL, snapshot TEXT NOT NULL, reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewing','resolved','dismissed')),
    resolution TEXT NOT NULL DEFAULT '', handled_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_safety_reports_queue ON safety_reports(status,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_safety_reports_owner ON safety_reports(reporter_id,created_at)`,
  `CREATE TABLE IF NOT EXISTS safety_report_events (
    id INTEGER PRIMARY KEY, report_id TEXT NOT NULL REFERENCES safety_reports(id) ON DELETE CASCADE,
    status TEXT NOT NULL, note TEXT NOT NULL, actor TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`,
];
