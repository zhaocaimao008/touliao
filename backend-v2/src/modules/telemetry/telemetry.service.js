'use strict';
/**
 * 客户端遥测（2026-10-12）：Web Vitals 持久化 + 通话质量上报，以及后台聚合统计。
 * 写入走 db/writer 的 worker 队列（不在主线程抢写锁）；统计只读 readDb。
 */
const { readDb } = require('../../db/connection');
const { writeAsync } = require('../../db/writer');

const DAY = 86400;

// ── Web Vitals ───────────────────────────────────────────────────
const VITAL_NAMES = new Set(['LCP', 'FCP', 'CLS', 'INP', 'FID', 'TTFB']);
const VITALS_RETENTION_SEC = 30 * DAY;
const PRUNE_EVERY_INSERTS = 500;
let insertsSincePrune = 0;
let lastPruneAt = 0;

const ID_SEG = /\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{24,})(?=\/|$)/gi;
function pageOf(url) {
  if (typeof url !== 'string' || !url) return '';
  let p;
  try { p = new URL(url, 'http://local').pathname; } catch { return ''; }
  // hash 路由（#/chat/xxx）也归一化
  return p.replace(ID_SEG, '/:id').slice(0, 120);
}

function uaClass(ua) {
  const s = String(ua || '');
  if (/Electron/i.test(s)) return 'desktop-app';
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  if (/Android/i.test(s)) return 'android';
  if (/Mobile/i.test(s)) return 'mobile-other';
  if (/Windows|Macintosh|Linux|CrOS/i.test(s)) return 'desktop-web';
  return 'other';
}

/** 解析并校验一条 vitals；非法返回 null。纯函数，便于测试。 */
function normalizeVital(body) {
  if (!body || typeof body !== 'object') return null;
  const name = String(body.name || '').toUpperCase();
  if (!VITAL_NAMES.has(name)) return null;
  const value = Number(body.value);
  if (!Number.isFinite(value) || value < 0) return null;
  const max = name === 'CLS' ? 100 : 600000; // CLS 无单位；其余毫秒，上限 10 分钟
  const rating = ['good', 'needs-improvement', 'poor'].includes(body.rating) ? body.rating : null;
  return { name, value: Math.min(value, max), rating, page: pageOf(body.url), ua_class: uaClass(body.userAgent) };
}

function recordVital(v, nowSec = Math.floor(Date.now() / 1000)) {
  const p = writeAsync('INSERT INTO web_vitals (name, value, rating, page, ua_class, ts) VALUES (?,?,?,?,?,?)',
    [v.name, v.value, v.rating, v.page, v.ua_class, nowSec]);
  // 保留期修剪：每 500 次插入或距上次超过 1 小时，顺手删一次 30 天前的行（走 ts 索引）
  insertsSincePrune++;
  if (insertsSincePrune >= PRUNE_EVERY_INSERTS || nowSec - lastPruneAt > 3600) {
    insertsSincePrune = 0;
    lastPruneAt = nowSec;
    writeAsync('DELETE FROM web_vitals WHERE ts < ?', [nowSec - VITALS_RETENTION_SEC]).catch(() => {});
  }
  return p;
}

function percentile(sorted, q) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}
const round = (v, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** 每个指标的 p50/p75/p95（days ∈ {1,7}），可按 ua_class 过滤。 */
function vitalsStats(days = 1, { uaClass: cls } = {}) {
  const since = Math.floor(Date.now() / 1000) - days * DAY;
  const params = [since];
  let where = 'ts >= ?';
  if (cls) { where += ' AND ua_class = ?'; params.push(cls); }
  const rows = readDb.prepare(`SELECT name, value FROM web_vitals WHERE ${where} ORDER BY name, value LIMIT 500000`).all(...params);
  const by = new Map();
  for (const r of rows) { if (!by.has(r.name)) by.set(r.name, []); by.get(r.name).push(r.value); }
  const metrics = {};
  for (const [name, vals] of by) {
    const d = name === 'CLS' ? 3 : 0;
    metrics[name] = {
      count: vals.length,
      p50: round(percentile(vals, 0.5), d), p75: round(percentile(vals, 0.75), d), p95: round(percentile(vals, 0.95), d),
    };
  }
  const byUa = readDb.prepare(`SELECT ua_class, COUNT(*) AS n FROM web_vitals WHERE ts >= ? GROUP BY ua_class`).all(since);
  return { days, since, metrics, uaClasses: Object.fromEntries(byUa.map(r => [r.ua_class, r.n])) };
}

// ── 通话质量 ─────────────────────────────────────────────────────
const CAND = ['host', 'srflx', 'prflx', 'relay'];
const PLATFORMS = ['web', 'desktop', 'android', 'ios'];
const enumOr = (v, list, dflt = null) => (list.includes(v) ? v : dflt);
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
function clampInt(v, lo, hi) { const n = num(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null; }
function clampNum(v, lo, hi) { const n = num(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; }

/** 校验 + 截断上报体；返回 { error } 或 { row }。纯函数，便于测试。 */
function normalizeCallReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: '参数错误' };
  const role = enumOr(body.role, ['caller', 'callee']);
  const callType = enumOr(body.callType, ['audio', 'video']);
  const platform = enumOr(body.platform, PLATFORMS);
  if (!role || !callType || !platform) return { error: 'role/callType/platform 取值非法' };
  const connected = body.connected === true;
  return {
    row: {
      role, call_type: callType, platform,
      is_group: body.group === true ? 1 : 0,
      connected: connected ? 1 : 0,
      setup_ms: connected ? clampInt(body.setupMs, 0, 120000) : null,
      duration_sec: clampInt(body.durationSec, 0, 24 * 3600) ?? 0,
      end_reason: String(body.endReason ?? '').replace(/[^\w.:-]/g, '').slice(0, 40),
      ice_restarts: clampInt(body.iceRestarts, 0, 100) ?? 0,
      local_candidate_type: enumOr(body.localCandidateType, CAND),
      remote_candidate_type: enumOr(body.remoteCandidateType, CAND),
      protocol: enumOr(body.protocol, ['udp', 'tcp']),
      relay_protocol: enumOr(body.relayProtocol, ['udp', 'tcp', 'tls']),
      rtt_ms_avg: clampInt(body.rttMsAvg, 0, 60000),
      packet_loss_pct: clampNum(body.packetLossPct, 0, 100),
      app_version: String(body.appVersion ?? '').replace(/[^\w.+-]/g, '').slice(0, 32),
    },
  };
}

async function saveCallReport(userId, callId, row) {
  const cols = ['call_id', 'user_id', ...Object.keys(row)];
  const vals = [callId, userId, ...Object.values(row)];
  const updates = Object.keys(row).map(c => `${c}=excluded.${c}`).join(', ');
  await writeAsync(
    `INSERT INTO call_reports (${cols.join(',')}, created_at, updated_at)
     VALUES (${cols.map(() => '?').join(',')}, strftime('%s','now'), strftime('%s','now'))
     ON CONFLICT(call_id, user_id) DO UPDATE SET ${updates}, updated_at=excluded.updated_at`,
    vals,
  );
}

function median(sorted) { return percentile(sorted, 0.5); }

/** 最近 days 天：总数、接通率、中继占比、接通耗时中位数，并按平台拆分。 */
function callStats(days = 7) {
  const since = Math.floor(Date.now() / 1000) - days * DAY;
  const rows = readDb.prepare(`SELECT platform, call_type, connected, setup_ms, local_candidate_type, remote_candidate_type
    FROM call_reports WHERE created_at >= ? LIMIT 200000`).all(since);
  const agg = list => {
    const connected = list.filter(r => r.connected);
    const relayed = connected.filter(r => r.local_candidate_type === 'relay' || r.remote_candidate_type === 'relay');
    const setups = connected.map(r => r.setup_ms).filter(v => v != null).sort((a, b) => a - b);
    return {
      reports: list.length,
      connected: connected.length,
      connectRate: list.length ? round(connected.length / list.length, 3) : null,
      relayShare: connected.length ? round(relayed.length / connected.length, 3) : null,
      medianSetupMs: median(setups),
      p95SetupMs: percentile(setups, 0.95),
    };
  };
  const byPlatform = {};
  for (const p of PLATFORMS) {
    const list = rows.filter(r => r.platform === p);
    if (list.length) byPlatform[p] = agg(list);
  }
  return {
    days, since, overall: agg(rows), byPlatform,
    byCallType: Object.fromEntries(['audio', 'video'].map(t => [t, agg(rows.filter(r => r.call_type === t))])),
  };
}

module.exports = {
  normalizeVital, recordVital, vitalsStats, uaClass, pageOf,
  normalizeCallReport, saveCallReport, callStats,
};
