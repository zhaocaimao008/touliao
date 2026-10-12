'use strict';
// 2026-10-12：客户端遥测（Web Vitals 持久化 + 通话质量上报）。
// Additive and repeatable; do not reorder previous migration entries.
module.exports = [
  // Web Vitals：每条一行，保留 30 天（插入时按需修剪，见 modules/telemetry/vitals.service.js）
  `CREATE TABLE IF NOT EXISTS web_vitals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    value REAL NOT NULL,
    rating TEXT,
    page TEXT NOT NULL DEFAULT '',
    ua_class TEXT NOT NULL DEFAULT 'other',
    ts INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_web_vitals_ts ON web_vitals(ts)',
  // 通话质量：每用户每通话一行（重复上报 upsert 覆盖）
  `CREATE TABLE IF NOT EXISTS call_reports (
    call_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    call_type TEXT NOT NULL,
    is_group INTEGER NOT NULL DEFAULT 0,
    connected INTEGER NOT NULL DEFAULT 0,
    setup_ms INTEGER,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    end_reason TEXT NOT NULL DEFAULT '',
    ice_restarts INTEGER NOT NULL DEFAULT 0,
    local_candidate_type TEXT,
    remote_candidate_type TEXT,
    protocol TEXT,
    relay_protocol TEXT,
    rtt_ms_avg INTEGER,
    packet_loss_pct REAL,
    platform TEXT NOT NULL,
    app_version TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (call_id, user_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_call_reports_created ON call_reports(created_at)',
  // 上报者是否经服务端记录核验为该通话参与者（1=已核验；0=查无记录，统计默认排除）。
  // 见 modules/telemetry/telemetry.service.js verifyCallParticipation。
  'ALTER TABLE call_reports ADD COLUMN verified INTEGER NOT NULL DEFAULT 0',
];
