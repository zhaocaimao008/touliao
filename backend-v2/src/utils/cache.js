'use strict';
/**
 * Redis 缓存工具 —— 支持对话列表、用户信息、搜索结果
 * TTL: 对话列表 5min, 用户信息 30min, 搜索 10min
 */

const redis = require('redis');

let client = null;
let disabled = false;      // Redis 不可用时置位，后续所有操作直接 no-op，避免阻塞请求
let initPromise = null;

function init() {
  if (disabled) return Promise.resolve();
  if (client?.isReady) return Promise.resolve();
  if (initPromise) return initPromise;

  client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    database: 0,
    socket: {
      connectTimeout: 1000,
      // 连接失败快速放弃：重试 2 次后彻底禁用缓存，绝不让请求挂起
      reconnectStrategy: (retries) => {
        if (retries >= 2) { disabled = true; return false; }
        return 200;
      },
    },
  });

  // 吞掉错误事件，避免未捕获异常 & 日志刷屏
  client.on('error', () => { disabled = true; });
  // 自动重连成功后恢复缓存（reconnectStrategy 重试路径不经过 connect().then）
  client.on('ready', () => { if (disabled) { disabled = false; console.log('[Redis Cache] Reconnected, cache re-enabled'); } });

  initPromise = client.connect()
    .then(() => { disabled = false; console.log('[Redis Cache] Connected'); })
    .catch(() => { disabled = true; })   // Redis 未运行 → 禁用缓存，降级为无缓存
    .finally(() => { initPromise = null; });

  return initPromise;
}

// 缓存键生成器
const keys = {
  conversations: userId => `conv:${userId}`,
  user: userId => `user:${userId}`,
  search: (userId, query) => `search:${userId}:${query}`,
  userSessions: userId => `sessions:${userId}`,
};

// 获取缓存
async function get(key) {
  try {
    if (disabled) return null;
    await init();
    if (disabled || !client?.isReady) return null;
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

// 设置缓存（带 TTL）
async function set(key, value, ttlSeconds = 300) {
  try {
    if (disabled) return;
    await init();
    if (disabled || !client?.isReady) return;
    await client.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch { /* 缓存失败不影响主流程 */ }
}

// 删除缓存
async function del(key) {
  try {
    if (disabled) return;
    await init();
    if (disabled || !client?.isReady) return;
    await client.del(key);
  } catch { /* noop */ }
}

// 删除匹配模式的缓存（SCAN 替代 KEYS，避免阻塞 Redis）
async function delPattern(pattern) {
  try {
    if (disabled) return;
    await init();
    if (disabled || !client?.isReady) return;
    const toDelete = [];
    for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      toDelete.push(key);
    }
    if (toDelete.length > 0) await client.del(toDelete);
  } catch { /* noop */ }
}

// 清空所有缓存
async function flush() {
  try {
    if (disabled) return;
    await init();
    if (disabled || !client?.isReady) return;
    await client.flushDb();
  } catch { /* noop */ }
}

module.exports = {
  init,
  keys,
  get,
  set,
  del,
  delPattern,
  flush,
};
