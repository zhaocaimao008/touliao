/**
 * P14.1: 多层缓存系统
 * L1本地缓存 → L2 Redis → L3 CDN
 */
class MultiLayerCache {
  constructor() {
    this.l1Cache = new Map();      // 本地内存缓存
    this.l1TTL = new Map();        // TTL管理
    this.redisClient = null;       // Redis连接
    this.cdnCache = new Map();     // CDN缓存元数据
    this.stats = { l1Hit: 0, l2Hit: 0, l3Hit: 0, miss: 0 };
  }

  /**
   * 智能预热策略
   */
  async preWarmCache(hotKeys) {
    for (const key of hotKeys) {
      const value = await this.fetchFromSource(key);
      
      // L1: 热数据保留1小时
      this.l1Cache.set(key, value);
      this.l1TTL.set(key, Date.now() + 3600000);
      
      // L2: 关键数据保留24小时
      if (await this.redisClient?.set(key, JSON.stringify(value), 'EX', 86400)) {
        // L3: 推送到CDN
        this.cdnCache.set(key, { ttl: 86400, timestamp: Date.now() });
      }
    }
  }

  /**
   * 智能读取策略
   */
  async get(key) {
    // L1检查
    if (this.l1Cache.has(key)) {
      const ttl = this.l1TTL.get(key);
      if (ttl && Date.now() < ttl) {
        this.stats.l1Hit++;
        return this.l1Cache.get(key);
      }
      this.l1Cache.delete(key);
    }

    // L2检查
    const l2Value = await this.redisClient?.get(key);
    if (l2Value) {
      this.stats.l2Hit++;
      const value = JSON.parse(l2Value);
      // 同步到L1
      this.l1Cache.set(key, value);
      this.l1TTL.set(key, Date.now() + 3600000);
      return value;
    }

    // L3检查（从CDN获取）
    if (this.cdnCache.has(key)) {
      this.stats.l3Hit++;
      return this.getCDNValue(key);
    }

    // 源数据
    this.stats.miss++;
    const value = await this.fetchFromSource(key);
    await this.set(key, value);
    return value;
  }

  /**
   * 主动失效策略
   */
  async invalidate(keyPattern) {
    const regex = new RegExp(keyPattern);
    
    // L1失效
    for (const key of this.l1Cache.keys()) {
      if (regex.test(key)) {
        this.l1Cache.delete(key);
        this.l1TTL.delete(key);
      }
    }

    // L2失效
    const redisKeys = await this.redisClient?.keys(keyPattern);
    if (redisKeys?.length > 0) {
      await this.redisClient?.del(...redisKeys);
    }

    // L3失效
    for (const key of this.cdnCache.keys()) {
      if (regex.test(key)) {
        this.cdnCache.delete(key);
      }
    }
  }

  /**
   * 缓存统计
   */
  getStats() {
    const total = Object.values(this.stats).reduce((a, b) => a + b, 0);
    return {
      hitRate: total > 0 ? (((this.stats.l1Hit + this.stats.l2Hit + this.stats.l3Hit) / total) * 100).toFixed(2) + '%' : '0%',
      l1HitRate: total > 0 ? ((this.stats.l1Hit / total) * 100).toFixed(2) + '%' : '0%',
      l2HitRate: total > 0 ? ((this.stats.l2Hit / total) * 100).toFixed(2) + '%' : '0%',
      l3HitRate: total > 0 ? ((this.stats.l3Hit / total) * 100).toFixed(2) + '%' : '0%',
      ...this.stats,
    };
  }

  async set(key, value) {
    this.l1Cache.set(key, value);
    this.l1TTL.set(key, Date.now() + 3600000);
    await this.redisClient?.setex(key, 86400, JSON.stringify(value));
  }

  async fetchFromSource(key) {
    return { data: 'source_data', timestamp: Date.now() };
  }

  getCDNValue(key) {
    return this.l1Cache.get(key) || { data: 'cdn_cached' };
  }
}

module.exports = MultiLayerCache;
