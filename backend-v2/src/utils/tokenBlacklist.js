'use strict';
/**
 * Token 黑名单 —— 支持内存和 Redis 存储（生产用 Redis）
 * Logout 时加入黑名单，拒绝后续使用
 * 降级顺序：Redis → SQLite（持久，重启不丢）→ 内存（最后兜底）
 *
 * 性能优化：
 *   cleanCache — 进程内 Map，缓存"确认干净"的 token，TTL=30s。
 *   正常请求（非黑名单 token）命中 cleanCache 后跳过 Redis+SQLite 双查，
 *   将每请求 2 次 I/O 降为 0。加入黑名单时立即驱逐对应条目，保证一致性。
 */

const redis = require('redis');

let redisClient = null;
let useRedis = false;

// ── 干净 token 进程内短期缓存（30s TTL）──────────────────────────
const CLEAN_TTL_MS = 30_000;
const cleanCache = new Map(); // token → expiresAtMs
function _cleanGet(token) {
  const exp = cleanCache.get(token);
  if (exp === undefined) return false;
  if (Date.now() < exp) return true;
  cleanCache.delete(token);
  return false;
}
function _cleanSet(token) {
  cleanCache.set(token, Date.now() + CLEAN_TTL_MS);
}
function _cleanDel(token) {
  cleanCache.delete(token);
}
// 每5分钟清理过期条目，防止 Map 随 token 无限增长
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of cleanCache) if (now >= exp) cleanCache.delete(k);
}, 5 * 60_000).unref();

// SQLite 延迟初始化（避免循环依赖：connection 模块在 schema 执行前加载）
let _db = null;
function getDb() {
  if (!_db) _db = require('../db/connection').db;
  return _db;
}

// 清理过期 SQLite 黑名单条目（启动时 + 定期）
function purgeSqliteExpired() {
  try {
    getDb().prepare('DELETE FROM token_blacklist WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
  } catch {}
}

async function initRedis() {
  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      database: 1,  // 使用 db 1，cache 用 db 0
    });

    redisClient.on('error', err => {
      console.warn('[TokenBlacklist] Redis error, falling back to SQLite:', err.message);
      useRedis = false;
    });
    redisClient.on('ready', () => {
      useRedis = true;
      console.log('[TokenBlacklist] Redis reconnected, resuming Redis storage');
    });

    await redisClient.connect();
    useRedis = true;
    console.log('[TokenBlacklist] Using Redis storage');
  } catch (err) {
    console.warn('[TokenBlacklist] Redis unavailable, using SQLite fallback:', err.message);
    useRedis = false;
  }

  // 启动时清理 SQLite 过期条目，之后每小时一次
  purgeSqliteExpired();
  setInterval(purgeSqliteExpired, 3600 * 1000);
}

/**
 * 将 token 加入黑名单
 * @param {string} token - JWT token
 * @param {number} expiresAt - token 过期时间戳（秒）
 */
async function addToBlacklist(token, expiresAt) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = expiresAt - now;
  if (ttl <= 0) return;

  // 立即驱逐干净缓存，防止同一 token 在 30s 内继续被放行
  _cleanDel(token);

  const key = `blacklist:${token}`;
  try {
    if (useRedis && redisClient) {
      await redisClient.setEx(key, ttl, '1');
      // 不 return：继续双写 SQLite 作为持久备份，防 Redis 抖动时注销 token 被复活
    }
  } catch (err) {
    console.error('[TokenBlacklist] Redis add error:', err.message);
  }

  // SQLite 持久化（主路径 + Redis 双写备份）
  try {
    getDb().prepare('INSERT OR REPLACE INTO token_blacklist (token, expires_at) VALUES (?, ?)').run(token, expiresAt);
  } catch (err) {
    console.error('[TokenBlacklist] SQLite add error:', err.message);
  }
}

/**
 * 检查 token 是否在黑名单中
 * @param {string} token - JWT token
 * @returns {boolean}
 */
async function isBlacklisted(token) {
  // 命中干净缓存：该 token 在 30s 内已确认不在黑名单，直接跳过 I/O
  if (_cleanGet(token)) return false;

  try {
    if (useRedis && redisClient) {
      const exists = await redisClient.exists(`blacklist:${token}`);
      if (exists === 1) return true;
      // Redis 未命中仍继续查 SQLite，防双写不一致时漏放
    }
  } catch (err) {
    console.error('[TokenBlacklist] Redis check error:', err.message);
  }

  // SQLite 降级检查
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = getDb().prepare('SELECT 1 FROM token_blacklist WHERE token=? AND expires_at > ?').get(token, now);
    if (row) return true;
    // 两层均未命中 → 确认干净，写入短期缓存
    _cleanSet(token);
    return false;
  } catch (err) {
    console.error('[TokenBlacklist] SQLite check error:', err.message);
    throw err; // 双重降级失败：让 auth.js 返回 503，不 fail open
  }
}

/**
 * 清空黑名单（仅用于测试）
 */
async function clear() {
  // 同时清掉进程内干净缓存，确保测试隔离
  cleanCache.clear();
  try {
    if (useRedis && redisClient) {
      // 用 SCAN 替代 KEYS，避免阻塞 Redis（KEYS 是 O(N) 阻塞命令）。
      // redis v6 scanIterator 按批次 yield 键数组，需展开。
      const toDelete = [];
      for await (const batch of redisClient.scanIterator({ MATCH: 'blacklist:*', COUNT: 100 })) {
        if (Array.isArray(batch)) toDelete.push(...batch);
        else toDelete.push(batch);
      }
      if (toDelete.length > 0) await redisClient.del(toDelete);
    }
  } catch (err) {
    console.error('[TokenBlacklist] Clear error:', err.message);
  }
  try {
    getDb().prepare('DELETE FROM token_blacklist').run();
  } catch {}
}

// 启动时初始化 Redis
initRedis();

module.exports = { addToBlacklist, isBlacklisted, clear };
