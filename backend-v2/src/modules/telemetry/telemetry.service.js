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

// 每个指标最多读入这么多行算分位数；超过则对该指标做均匀随机抽样（sampled: true）。
// 此前全表 ORDER BY name, value LIMIT 500000 一次读入：窗口超 50 万行时字母序靠后的指标
// （LCP/TTFB…）整个丢失、被截断的指标只剩最小值，p75/p95 偏低且无任何提示，还在主线程
// 同步构造 50 万行数组。现按指标分别计数 + 分别读取，每个指标读入量有上限。
const VITALS_STATS_CAP = 50000;

/** 每个指标的 p50/p75/p95（days ∈ {1,7}），可按 ua_class 过滤。 */
function vitalsStats(days = 1, { uaClass: cls } = {}) {
  const since = Math.floor(Date.now() / 1000) - days * DAY;
  const params = [since];
  let where = 'ts >= ?';
  if (cls) { where += ' AND ua_class = ?'; params.push(cls); }
  const counts = readDb.prepare(`SELECT name, COUNT(*) AS n FROM web_vitals WHERE ${where} GROUP BY name`).all(...params);
  const metrics = {};
  for (const { name, n } of counts) {
    const step = Math.max(1, Math.ceil(n / VITALS_STATS_CAP));
    // 抽样用 random() 而非 id 取模：同一页面的各指标按固定顺序插入，id 取模会与指标名相关
    const sql = `SELECT value FROM web_vitals WHERE ${where} AND name = ?`
      + (step > 1 ? ' AND abs(random() % ?) = 0' : '') + ' ORDER BY value';
    const vals = readDb.prepare(sql).all(...params, name, ...(step > 1 ? [step] : [])).map(r => r.value);
    const d = name === 'CLS' ? 3 : 0;
    metrics[name] = {
      count: n,
      ...(step > 1 ? { sampled: true, sampleSize: vals.length } : {}),
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

/**
 * 核验上报者是否参与过该通话（2026-10-12）。返回
 *   { verdict: 'verified'|'unverified'|'rejected', source, isGroup?, role? }
 * 依据（按可信度）：
 *   1. call_logs（1v1，呼叫发起时落库，持久）：有记录 → 只有 caller/callee 算参与者，其余一律 rejected；
 *      role 以记录为准。
 *   2. group_call_logs（群通话，持久，但只记发起人与会话，不记每个参与者）：
 *      发起人 → verified；进程内参与者历史（groupCall.wasGroupCallParticipant，结束后保留 2 小时）
 *      → verified；不是该群当前成员 → rejected（加入群通话以群成员为前提）；
 *      是群成员但无法证明加入过（如服务重启丢了内存历史）→ unverified。
 *   3. 两张表都查不到：只看进程内群通话历史；仍无 → unverified。
 * 为什么「查无记录」不拒绝：call_logs/group_call_logs 走异步写队列，写失败或极端时序下上报可能先于
 * 落库；群通话没有持久的逐人参与记录。这类上报照存但 verified=0，callStats 默认排除——
 * 既不丢真实数据，也不让伪造/误发的上报污染统计。只有持久记录能证明「不是参与者」时才 403。
 */
function verifyCallParticipation(userId, callId) {
  const oneToOne = readDb.prepare('SELECT caller_id, callee_id FROM call_logs WHERE id=?').get(callId);
  if (oneToOne) {
    if (oneToOne.caller_id === userId) return { verdict: 'verified', source: 'call_logs', isGroup: false, role: 'caller' };
    if (oneToOne.callee_id === userId) return { verdict: 'verified', source: 'call_logs', isGroup: false, role: 'callee' };
    return { verdict: 'rejected', source: 'call_logs' };
  }
  const { wasGroupCallParticipant } = require('../../realtime/handlers/groupCall');
  const group = readDb.prepare('SELECT conversation_id, started_by FROM group_call_logs WHERE id=?').get(callId);
  if (group) {
    if (group.started_by === userId) return { verdict: 'verified', source: 'group_call_logs', isGroup: true, role: 'caller' };
    if (wasGroupCallParticipant(callId, userId)) return { verdict: 'verified', source: 'group_registry', isGroup: true, role: 'callee' };
    const member = readDb.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?')
      .get(group.conversation_id, userId);
    if (!member) return { verdict: 'rejected', source: 'conversation_members' };
    return { verdict: 'unverified', source: 'group_member', isGroup: true };
  }
  if (wasGroupCallParticipant(callId, userId)) return { verdict: 'verified', source: 'group_registry', isGroup: true };
  return { verdict: 'unverified', source: 'none' };
}

/** 按核验结果修正上报行：记录能确定的字段（是否群通话、主被叫）以服务端为准，并写 verified。 */
function applyParticipation(row, participation) {
  const out = { ...row, verified: participation.verdict === 'verified' ? 1 : 0 };
  if (typeof participation.isGroup === 'boolean') out.is_group = participation.isGroup ? 1 : 0;
  if (participation.role) out.role = participation.role;
  return out;
}

// call_reports 保留期：已核验 90 天；未核验（查无通话记录）只留 7 天——后者只用于观察核验
// 覆盖率，且任何登录用户都能用随机 callId 制造，不能无限增长。修剪方式同 web_vitals：
// 每 CALL_PRUNE_EVERY 次写入或距上次超过 1 小时顺手删一次（走 created_at 索引）。
const CALL_REPORTS_RETENTION_SEC = 90 * DAY;
const CALL_REPORTS_UNVERIFIED_RETENTION_SEC = 7 * DAY;
const CALL_PRUNE_EVERY = 200;
let callSavesSincePrune = 0;
let lastCallPruneAt = 0;
function maybePruneCallReports(nowSec = Math.floor(Date.now() / 1000)) {
  callSavesSincePrune++;
  if (callSavesSincePrune < CALL_PRUNE_EVERY && nowSec - lastCallPruneAt <= 3600) return false;
  callSavesSincePrune = 0;
  lastCallPruneAt = nowSec;
  writeAsync('DELETE FROM call_reports WHERE created_at < ?', [nowSec - CALL_REPORTS_RETENTION_SEC]).catch(() => {});
  writeAsync('DELETE FROM call_reports WHERE verified = 0 AND created_at < ?',
    [nowSec - CALL_REPORTS_UNVERIFIED_RETENTION_SEC]).catch(() => {});
  return true;
}

// 「查无任何通话记录」的未核验上报：单用户 24 小时内最多存这么多条，超出不再落库
//（照常回 200，客户端无需区分）。正常客户端偶发的写入时序问题远到不了这个量。
const UNVERIFIED_NONE_QUOTA_24H = 20;
function unverifiedQuotaExceeded(userId, participation) {
  if (participation.verdict !== 'unverified' || participation.source !== 'none') return false;
  const since = Math.floor(Date.now() / 1000) - DAY;
  const n = readDb.prepare('SELECT COUNT(*) AS n FROM call_reports WHERE created_at >= ? AND user_id = ? AND verified = 0')
    .get(since, userId).n;
  return n >= UNVERIFIED_NONE_QUOTA_24H;
}

async function saveCallReport(userId, callId, row) {
  maybePruneCallReports();
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

/**
 * 最近 days 天：总数、接通率、中继占比、接通耗时中位数，并按平台拆分。
 * 默认只统计 verified=1（核验过参与关系）的上报；includeUnverified 时全部纳入。
 * unverifiedReports 始终给出被排除的条数，便于观察核验覆盖率。
 */
function callStats(days = 7, { includeUnverified = false } = {}) {
  const since = Math.floor(Date.now() / 1000) - days * DAY;
  const rows = readDb.prepare(`SELECT platform, call_type, connected, setup_ms, local_candidate_type, remote_candidate_type
    FROM call_reports WHERE created_at >= ?${includeUnverified ? '' : ' AND verified = 1'} LIMIT 200000`).all(since);
  const unverifiedReports = readDb.prepare('SELECT COUNT(*) AS n FROM call_reports WHERE created_at >= ? AND verified = 0')
    .get(since).n;
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
    days, since, includeUnverified, unverifiedReports, overall: agg(rows), byPlatform,
    byCallType: Object.fromEntries(['audio', 'video'].map(t => [t, agg(rows.filter(r => r.call_type === t))])),
  };
}

module.exports = {
  normalizeVital, recordVital, vitalsStats, uaClass, pageOf,
  normalizeCallReport, saveCallReport, callStats, verifyCallParticipation, applyParticipation,
  unverifiedQuotaExceeded, maybePruneCallReports, VITALS_STATS_CAP, UNVERIFIED_NONE_QUOTA_24H,
};
