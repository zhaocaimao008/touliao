/**
 * Redis 缓存集成
 * 提供高性能分布式缓存能力
 */

const Redis = require('ioredis');

class RedisCache {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };
  }

  /**
   * 初始化 Redis 连接
   */
  async connect(config = {}) {
    const defaultConfig = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      db: parseInt(process.env.REDIS_CACHE_DB || '5', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: true,
      lazyConnect: false,
    };

    this.client = new Redis({ ...defaultConfig, ...config });

    this.client.on('connect', () => {
      console.log('[RedisCache] Connected');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      console.error('[RedisCache] Error:', err.message);
      this.stats.errors++;
      this.isConnected = false;
    });

    this.client.on('close', () => {
      console.log('[RedisCache] Connection closed');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      console.log('[RedisCache] Reconnecting...');
    });

    // 等待连接就绪
    await this.client.ping();
    return this;
  }

  /**
   * 获取缓存
   */
  async get(key, options = {}) {
    if (!this.isConnected) {
      this.stats.misses++;
      return null;
    }

    try {
      const value = await this.client.get(key);
      
      if (value === null) {
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      
      // 自动解析 JSON
      if (options.parse !== false) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      
      return value;
    } catch (error) {
      console.error('[RedisCache] Get error:', error.message);
      this.stats.errors++;
      this.stats.misses++;
      return null;
    }
  }

  /**
   * 设置缓存
   */
  async set(key, value, ttl = 3600) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      
      if (ttl > 0) {
        await this.client.setex(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      
      this.stats.sets++;
      return true;
    } catch (error) {
      console.error('[RedisCache] Set error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * 删除缓存
   */
  async del(key) {
    if (!this.isConnected) {
      return false;
    }

    try {
      await this.client.del(key);
      this.stats.deletes++;
      return true;
    } catch (error) {
      console.error('[RedisCache] Delete error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * 批量删除（支持模式匹配）
   */
  async delPattern(pattern) {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return 0;
      
      await this.client.del(...keys);
      this.stats.deletes += keys.length;
      return keys.length;
    } catch (error) {
      console.error('[RedisCache] Delete pattern error:', error.message);
      this.stats.errors++;
      return 0;
    }
  }

  /**
   * 检查键是否存在
   */
  async exists(key) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error('[RedisCache] Exists error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * 设置过期时间
   */
  async expire(key, ttl) {
    if (!this.isConnected) {
      return false;
    }

    try {
      await this.client.expire(key, ttl);
      return true;
    } catch (error) {
      console.error('[RedisCache] Expire error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * 递增
   */
  async incr(key, amount = 1) {
    if (!this.isConnected) {
      return null;
    }

    try {
      const result = await this.client.incrby(key, amount);
      return result;
    } catch (error) {
      console.error('[RedisCache] Incr error:', error.message);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * 递减
   */
  async decr(key, amount = 1) {
    if (!this.isConnected) {
      return null;
    }

    try {
      const result = await this.client.decrby(key, amount);
      return result;
    } catch (error) {
      console.error('[RedisCache] Decr error:', error.message);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * 批量获取
   */
  async mget(keys) {
    if (!this.isConnected || keys.length === 0) {
      return [];
    }

    try {
      const values = await this.client.mget(...keys);
      return values.map(v => {
        if (v === null) {
          this.stats.misses++;
          return null;
        }
        this.stats.hits++;
        try {
          return JSON.parse(v);
        } catch {
          return v;
        }
      });
    } catch (error) {
      console.error('[RedisCache] Mget error:', error.message);
      this.stats.errors++;
      return [];
    }
  }

  /**
   * 批量设置
   */
  async mset(keyValuePairs, ttl = 3600) {
    if (!this.isConnected || keyValuePairs.length === 0) {
      return false;
    }

    try {
      const pipeline = this.client.pipeline();
      
      for (const [key, value] of keyValuePairs) {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        if (ttl > 0) {
          pipeline.setex(key, ttl, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      }
      
      await pipeline.exec();
      this.stats.sets += keyValuePairs.length;
      return true;
    } catch (error) {
      console.error('[RedisCache] Mset error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * 缓存包装器 - 自动处理缓存逻辑
   */
  async wrap(key, fetchFn, ttl = 3600) {
    // 尝试从缓存获取
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    // 缓存未命中，执行获取函数
    const value = await fetchFn();
    
    // 存入缓存
    if (value !== null && value !== undefined) {
      await this.set(key, value, ttl);
    }
    
    return value;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : '0.00';
    
    return {
      ...this.stats,
      total,
      hitRate: `${hitRate}%`,
      isConnected: this.isConnected,
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };
  }

  /**
   * 关闭连接
   */
  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      console.log('[RedisCache] Disconnected');
    }
  }
}

// 单例实例
const redisCache = new RedisCache();

module.exports = {
  redisCache,
  RedisCache,
};
