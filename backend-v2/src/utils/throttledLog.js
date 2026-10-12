'use strict';
/**
 * 按 key 限频的日志（2026-10-12）：同一 key 在 intervalMs 内只打一条，下一条附带「期间被吞掉的条数」。
 * 用于连接错误、503 原因等「一出问题就每秒几十条」的日志，既保留可见性又不刷爆 out.log。
 */
const state = new Map(); // key → { last, suppressed }

function throttledLog(level, key, msg, extra, intervalMs = 60 * 1000) {
  const now = Date.now();
  const s = state.get(key);
  if (s && now - s.last < intervalMs) { s.suppressed++; return false; }
  const suppressed = s ? s.suppressed : 0;
  state.set(key, { last: now, suppressed: 0 });
  if (state.size > 1000) { // key 理论上是有限集合，防御性上限
    for (const k of state.keys()) { state.delete(k); if (state.size <= 500) break; }
  }
  const tail = suppressed ? ` (+${suppressed} similar in last ${Math.round(intervalMs / 1000)}s)` : '';
  const fn = console[level] || console.warn;
  if (extra !== undefined) fn(`${msg}${tail}`, extra); else fn(`${msg}${tail}`);
  return true;
}

module.exports = { throttledLog };
