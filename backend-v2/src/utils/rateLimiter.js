'use strict';

// 内存存储的速率限制器（生产环境应使用 Redis）
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.cleanup();
  }

  // 检查是否超出速率限制
  check(key, maxRequests, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }
    
    const timestamps = this.requests.get(key);
    
    // 清理过期记录
    const validTimestamps = timestamps.filter(ts => ts > windowStart);
    this.requests.set(key, validTimestamps);
    
    if (validTimestamps.length >= maxRequests) {
      const oldestRequest = validTimestamps[0];
      const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);
      return {
        allowed: false,
        retryAfter,
        remaining: 0,
        limit: maxRequests
      };
    }
    
    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);
    
    return {
      allowed: true,
      remaining: maxRequests - validTimestamps.length,
      limit: maxRequests
    };
  }

  // 定期清理过期数据，避免内存泄漏
  cleanup() {
    setInterval(() => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;
      
      for (const [key, timestamps] of this.requests.entries()) {
        const valid = timestamps.filter(ts => ts > oneHourAgo);
        if (valid.length === 0) {
          this.requests.delete(key);
        } else {
          this.requests.set(key, valid);
        }
      }
    }, 300000); // 每5分钟清理一次
  }

  // 重置指定 key 的限制
  reset(key) {
    this.requests.delete(key);
  }
}

const limiter = new RateLimiter();

// 速率限制中间件工厂
function createRateLimitMiddleware(options = {}) {
  const {
    maxRequests = 100,
    windowMs = 60000, // 1分钟
    keyGenerator = (req) => req.ip,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    handler = null
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const result = limiter.check(key, maxRequests, windowMs);
    
    res.set({
      'X-RateLimit-Limit': result.limit,
      'X-RateLimit-Remaining': result.remaining
    });
    
    if (!result.allowed) {
      res.set('Retry-After', result.retryAfter);
      
      if (handler) {
        return handler(req, res, next);
      }
      
      return res.status(429).json({
        error: '请求过于频繁，请稍后再试',
        retryAfter: result.retryAfter
      });
    }
    
    // 根据响应状态决定是否计数
    if (skipSuccessfulRequests || skipFailedRequests) {
      const originalSend = res.send;
      res.send = function(data) {
        const statusCode = res.statusCode;
        if ((skipSuccessfulRequests && statusCode < 400) ||
            (skipFailedRequests && statusCode >= 400)) {
          limiter.reset(key);
        }
        return originalSend.call(this, data);
      };
    }
    
    next();
  };
}

// 预定义的速率限制器
const rateLimiters = {
  // 严格限制（登录、注册等敏感操作）
  strict: createRateLimitMiddleware({
    maxRequests: 5,
    windowMs: 60000, // 1分钟5次
    keyGenerator: (req) => `strict:${req.ip}`
  }),
  
  // 中等限制（API 调用）
  moderate: createRateLimitMiddleware({
    maxRequests: 100,
    windowMs: 60000, // 1分钟100次
    keyGenerator: (req) => `moderate:${req.ip}`
  }),
  
  // 宽松限制（只读操作）
  lenient: createRateLimitMiddleware({
    maxRequests: 300,
    windowMs: 60000, // 1分钟300次
    keyGenerator: (req) => `lenient:${req.ip}`
  }),
  
  // 按用户限制
  perUser: (maxRequests = 100, windowMs = 60000) => createRateLimitMiddleware({
    maxRequests,
    windowMs,
    keyGenerator: (req) => `user:${req.userId || req.ip}`
  }),
  
  // 管理员操作限制
  admin: createRateLimitMiddleware({
    maxRequests: 50,
    windowMs: 60000, // 1分钟50次
    keyGenerator: (req) => `admin:${req.admin?.username || req.ip}`
  })
};

module.exports = {
  RateLimiter,
  createRateLimitMiddleware,
  rateLimiters,
  limiter
};
