'use strict';
/**
 * Token 黑名单 —— 支持内存和 Redis 存储（生产用 Redis）
 * Logout 时加入黑名单，拒绝后续使用
 * 降级顺序：Redis → SQLite（持久，重启不丢）→ 内存（最后兜底）
 */

const redis = require('redis');

let redisClient = null;
let useRedis = false;

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

  const key = `blacklist:${token}`;
  try {
    if (useRedis && redisClient) {
      await redisClient.setEx(key, ttl, '1');
      return;
    }
  } catch (err) {
    console.error('[TokenBlacklist] Redis add error:', err.message);
  }

  // SQLite 持久化降级（重启安全）
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
  try {
    if (useRedis && redisClient) {
      const exists = await redisClient.exists(`blacklist:${token}`);
      return exists === 1;
    }
  } catch (err) {
    console.error('[TokenBlacklist] Redis check error:', err.message);
  }

  // SQLite 降级检查
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = getDb().prepare('SELECT 1 FROM token_blacklist WHERE token=? AND expires_at > ?').get(token, now);
    return !!row;
  } catch (err) {
    console.error('[TokenBlacklist] SQLite check error:', err.message);
    throw err; // 双重降级失败：让 auth.js 返回 503，不 fail open
  }
}

/**
 * 清空黑名单（仅用于测试）
 */
async function clear() {
  try {
    if (useRedis && redisClient) {
      const keys = await redisClient.keys('blacklist:*');
      if (keys.length > 0) await redisClient.del(keys);
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
