/**
 * P10.1: 高级限流系统 (分布式 + 自适应)
 */

class AdvancedRateLimiter {
  constructor(redis) {
    this.redis = redis;
    this.strategies = {
      FIXED_WINDOW: 'fixed',
      SLIDING_WINDOW: 'sliding',
      TOKEN_BUCKET: 'token',
      LEAKY_BUCKET: 'leaky',
    };
    this.currentStrategy = this.strategies.TOKEN_BUCKET;
  }

  /**
   * Token Bucket 限流 (推荐)
   */
  async checkTokenBucket(userId, capacity = 100, refillRate = 10) {
    const key = `ratelimit:${userId}:tokens`;
    const lastRefillKey = `${key}:refill`;
    
    // 计算应有的令牌数
    const now = Date.now();
    const lastRefill = await this.redis.get(lastRefillKey) || now;
    const timePassed = (now - lastRefill) / 1000;
    const tokensToAdd = Math.floor(timePassed * refillRate);
    
    let currentTokens = parseInt(await this.redis.get(key) || capacity);
    currentTokens = Math.min(capacity, currentTokens + tokensToAdd);
    
    if (currentTokens >= 1) {
      await this.redis.set(key, currentTokens - 1);
      await this.redis.set(lastRefillKey, now);
      return { allowed: true, remainingTokens: currentTokens - 1 };
    }
    
    return { allowed: false, remainingTokens: 0 };
  }

  /**
   * 自适应限流 (基于系统负载)
   */
  async adaptiveRateLimit(userId, baseLimit = 100) {
    // 获取系统负载
    const cpuUsage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    const loadFactor = (memUsage.heapUsed / memUsage.heapTotal);
    
    // 动态调整限流阈值
    let adjustedLimit = baseLimit;
    if (loadFactor > 0.8) {
      adjustedLimit = Math.floor(baseLimit * 0.5); // 高负载时降低50%
    } else if (loadFactor > 0.6) {
      adjustedLimit = Math.floor(baseLimit * 0.75); // 中等负载
    }
    
    return this.checkTokenBucket(userId, adjustedLimit);
  }

  /**
   * 多维度限流 (用户 + IP + API)
   */
  async multiDimensionalLimit(userId, ip, endpoint, limits = {}) {
    const userLimit = await this.checkTokenBucket(`user:${userId}`, limits.perUser || 1000);
    const ipLimit = await this.checkTokenBucket(`ip:${ip}`, limits.perIP || 10000);
    const endpointLimit = await this.checkTokenBucket(`endpoint:${endpoint}`, limits.perEndpoint || 5000);
    
    return {
      allowed: userLimit.allowed && ipLimit.allowed && endpointLimit.allowed,
      details: { userLimit, ipLimit, endpointLimit },
    };
  }

  /**
   * 黑名单/白名单
   */
  async checkBlacklist(ip) {
    return await this.redis.get(`blacklist:${ip}`) ? true : false;
  }

  async addToBlacklist(ip, duration = 3600) {
    await this.redis.setex(`blacklist:${ip}`, duration, '1');
  }
}

module.exports = AdvancedRateLimiter;
