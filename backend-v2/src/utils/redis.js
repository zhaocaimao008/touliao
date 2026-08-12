'use strict';
/**
 * Redis 客户端导出 (测试友好)
 * 从 redisCache 集成中获取 Redis 实例，测试环境自动创建 mock
 */

let mockRedis = null;

function getRedisClient() {
  // 首先尝试获取真实 Redis
  try {
    const { redisCache } = require('../integrations/redisCache');
    if (redisCache && redisCache.client) {
      return redisCache.client;
    }
  } catch (e) {
    // redisCache 可能不存在或初始化失败
  }

  // 测试环境：创建简单 mock Redis
  if (process.env.NODE_ENV === 'test') {
    if (!mockRedis) {
      mockRedis = createMockRedis();
    }
    return mockRedis;
  }

  // 生产环境：返回 null，调用者需要处理
  return null;
}

function createMockRedis() {
  const storage = new Map();
  return {
    async get(key) {
      return storage.get(key) || null;
    },
    async set(key, value) {
      storage.set(key, value);
    },
    async setex(key, ttl, value) {
      storage.set(key, value);
      // 简化版：忽略 TTL 管理
    },
    async del(key) {
      storage.delete(key);
      return 1;
    },
    async mget(...keys) {
      return keys.map(key => storage.get(key) || null);
    },
    async mset(...args) {
      for (let i = 0; i < args.length; i += 2) {
        storage.set(args[i], args[i + 1]);
      }
    },
    async incrby(key, count) {
      const current = parseInt(storage.get(key) || '0', 10);
      const newVal = current + count;
      storage.set(key, newVal.toString());
      return newVal;
    },
    async expire(key, ttl) {
      // Mock 版忽略 TTL
      return 1;
    },
    async keys(pattern) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return Array.from(storage.keys()).filter(k => regex.test(k));
    },
    async pipeline() {
      return {
        get: () => this,
        set: () => this,
        del: () => this,
        exec: async () => [],
      };
    },
  };
}

module.exports = {
  get redis() {
    const client = getRedisClient();
    if (!client && process.env.NODE_ENV !== 'test') {
      console.warn('[redis] Redis client not initialized. Ensure redisCache.connect() is called in server.js');
    }
    return client || { get: async () => null, set: async () => {}, del: async () => {} };
  },
};
