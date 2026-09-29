'use strict';
/**
 * Redis 缓存工具 —— 支持对话列表、用户信息、搜索结果
 * TTL: 对话列表 5min, 用户信息 30min, 搜索 10min
 */

const redis = require('redis');

let client = null;
let disabled = false;      // Redis 不可用时置位，后续所有操作直接 no-op，避免阻塞请求
let initPromise = null;
// 区分「从未连上过」（快速放弃，避免冷启动请求被拖住）与「曾经连上、运行中掉线」
// （无限重试 + 退避自愈，否则重试 2 次后永久禁用缓存，只能重启进程恢复）。
let everConnected = false;

function init() {
  if (disabled) return Promise.resolve();
  // 曾经创建过 client 就绝不再 new 一个——node-redis 自己的 reconnectStrategy 在后台
  // 持续重试，我们只需要等；这里如果重新 createClient() 会在每次 get/set 调用时都
  // 造一个新客户端、把正在重连的旧客户端晾在一边，是明显的资源泄漏。
  if (client) return Promise.resolve();
  if (initPromise) return initPromise;
  // 只有显式配置 REDIS_URL 才连 Redis(否则纯内存模式,避免误连本机其他服务的 Redis)
  if (!process.env.REDIS_URL) {
    disabled = true;
    return Promise.resolve();
  }

  client = require('./redisClients').track(redis.createClient({
    url: process.env.REDIS_URL,
    database: 0,
    socket: {
      connectTimeout: 1000,
      reconnectStrategy: (retries) => {
        // 从未连上过：快速放弃，绝不让冷启动请求被 Redis 缺失拖住。
        if (!everConnected) {
          if (retries >= 2) { disabled = true; return false; }
          return 200;
        }
        // 曾经连上过、这次是运行中掉线：无限重试 + 退避上限 5s，与
        // tokenBlacklist.js/integrations/redisCache.js 的自愈行为保持一致。
        return Math.min(200 * 2 ** retries, 5000);
      },
    },
  }));

  // 吞掉错误事件，避免未捕获异常 & 日志刷屏；仅在"从未连上过"阶段才置 disabled，
  // 运行中掉线不在这里禁用——交给 reconnectStrategy 的无限重试 + 下面的 ready 处理自愈。
  client.on('error', () => { if (!everConnected) disabled = true; });
  // 自动重连成功后恢复缓存（reconnectStrategy 重试路径不经过 connect().then）
  // 测试环境静默：连接可能在测试结束后才 resolve，避免 jest "Cannot log after tests" 噪音
  const quiet = process.env.NODE_ENV === 'test';
  client.on('ready', () => { everConnected = true; if (disabled) { disabled = false; if (!quiet) console.log('[Redis Cache] Reconnected, cache re-enabled'); } });

  initPromise = client.connect()
    .then(() => { everConnected = true; disabled = false; if (!quiet) console.log('[Redis Cache] Connected'); })
    .catch(() => { if (!everConnected) disabled = true; })   // Redis 未运行 → 禁用缓存，降级为无缓存
    .finally(() => { initPromise = null; });

  return initPromise;
}

// 缓存键生成器
const keys = {
  // 会话列表缓存改为 conversations.service 进程内 convCache（2s TTL + 成员级失效），
  // 不再走 Redis；search 缓存键在 messages.service 内联拼接；userSessions 未启用。
  // 此处仅保留真实在用的 user 键（users.service 的用户详情缓存）。
  user: userId => `user:${userId}`,
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
// redis v6 scanIterator 按批次 yield 键数组，需展开。
async function delPattern(pattern) {
  try {
    if (disabled) return;
    await init();
    if (disabled || !client?.isReady) return;
    const toDelete = [];
    for await (const batch of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (Array.isArray(batch)) toDelete.push(...batch);
      else toDelete.push(batch);
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

/** 关闭 Redis 连接（优雅退出 / 测试收尾）；之后所有操作 no-op。 */
async function close() {
  if (initPromise) await initPromise.catch(() => {});
  disabled = true;
  if (client?.isOpen) await client.quit().catch(() => client.disconnect?.());
}

module.exports = {
  init,
  close,
  keys,
  get,
  set,
  del,
  delPattern,
  flush,
};
