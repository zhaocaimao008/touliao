'use strict';
/**
 * Redis 连接配置的唯一来源（2026-10-12）。
 *
 * 之前各处各读各的：tokenBlacklist / cache / rateLimiters 读 REDIS_URL，integrations/redisCache 却读
 * REDIS_HOST/REDIS_PORT 并默认连 127.0.0.1:6379——于是 REDIS_URL 未配置（或该进程没读到 .env）时，
 * 前者正确降级为内存/SQLite，后者仍然无条件连本机 6379，Redis 不在时一天刷 1 万条 ECONNREFUSED。
 * 现在统一：只有 REDIS_URL 非空才算「已配置」；REDIS_DISABLED=1 可强制关闭。
 * .env 按 backend-v2 根目录的绝对路径加载，不依赖进程 cwd（cwd 不同会导致某些进程读不到 .env）。
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function redisUrl() {
  if (process.env.REDIS_DISABLED === '1') return null;
  const v = (process.env.REDIS_URL || '').trim();
  return v || null;
}

function redisEnabled() {
  return redisUrl() !== null;
}

module.exports = { redisUrl, redisEnabled };
