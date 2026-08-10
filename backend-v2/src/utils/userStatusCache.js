'use strict';
/**
 * 用户状态进程内缓存（banned + password_changed_at）。
 *
 * auth 中间件每个请求都要查这两个字段，但它们变化极低频（封禁/改密）。
 * 用 30s TTL 的进程内 Map 缓存，命中后跳过 DB SELECT，把热路径每请求的
 * 一次 SQLite 读降为 0。
 *
 * 使用方式：
 *   - 读：getUserStatus(userId) → { banned, password_changed_at } | null
 *   - 驱逐：invalidateUser(userId)  ← 封禁/改密/删号时调用
 */

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // userId → { banned, password_changed_at, exp }

/** 返回缓存的状态，不存在或已过期则返回 null。 */
function getUserStatus(userId) {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.exp) { cache.delete(userId); return null; }
  return { banned: entry.banned, password_changed_at: entry.password_changed_at };
}

/** 写入缓存。 */
function setUserStatus(userId, banned, password_changed_at) {
  cache.set(userId, { banned, password_changed_at, exp: Date.now() + CACHE_TTL_MS });
}

/** 主动驱逐（封禁/改密/删号时调用，保证下次请求立即穿透到 DB）。 */
function invalidateUser(userId) {
  cache.delete(userId);
}

// 每分钟清理过期条目，防止 Map 无限增长
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (now > v.exp) cache.delete(k);
}, 60_000).unref();

module.exports = { getUserStatus, setUserStatus, invalidateUser };
