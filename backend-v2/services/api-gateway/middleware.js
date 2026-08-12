/**
 * P7 深化实施：API Gateway 中间件
 */

class GatewayMiddleware {
  static requestLogging() {
    return (req, res, next) => {
      const startTime = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        console.log(`[GATEWAY] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
      });
      next();
    };
  }

  static rateLimiting() {
    const buckets = new Map();
    return (req, res, next) => {
      const key = req.ip;
      const now = Date.now();
      if (!buckets.has(key)) buckets.set(key, []);
      
      const timestamps = buckets.get(key).filter(t => now - t < 60000);
      if (timestamps.length > 100) {
        return res.status(429).json({ error: '请求过于频繁' });
      }
      
      timestamps.push(now);
      buckets.set(key, timestamps);
      next();
    };
  }

  static circuitBreaker(serviceUrl, threshold = 5, timeout = 60000) {
    let failureCount = 0;
    let lastFailureTime = null;
    let isOpen = false;

    return async (req, res, next) => {
      if (isOpen) {
        const timeSinceLastFailure = Date.now() - lastFailureTime;
        if (timeSinceLastFailure > timeout) {
          isOpen = false;
          failureCount = 0;
        } else {
          return res.status(503).json({ error: '服务暂时不可用' });
        }
      }

      try {
        // 尝试调用下游服务
        req.serviceUrl = serviceUrl;
        next();
      } catch (err) {
        failureCount++;
        lastFailureTime = Date.now();
        if (failureCount >= threshold) {
          isOpen = true;
        }
        throw err;
      }
    };
  }

  static serviceRouting() {
    return (req, res, next) => {
      if (req.path.startsWith('/api/users')) {
        req.targetService = 'user-service';
      } else if (req.path.startsWith('/api/messages')) {
        req.targetService = 'message-service';
      } else if (req.path.startsWith('/api/groups')) {
        req.targetService = 'social-service';
      }
      next();
    };
  }
}

module.exports = GatewayMiddleware;
