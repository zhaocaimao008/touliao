'use strict';
/**
 * 监控告警模块 —— 实时性能指标和告警
 * 支持 Prometheus、Grafana 导出
 */

const { logger } = require('./logger');

// 性能指标收集器
class Metrics {
  constructor() {
    this.reset();
  }

  reset() {
    this.requests = {
      total: 0,
      success: 0,
      error: 0,
      avgTime: 0,
      responseTimes: [],
    };

    this.database = {
      queries: 0,
      avgTime: 0,
      queryTimes: [],
      errors: 0,
    };

    this.cache = {
      hits: 0,
      misses: 0,
      hitRate: 0,
    };

    this.startTime = Date.now();
  }

  // 记录 API 请求
  recordRequest(duration, statusCode) {
    this.requests.total++;
    this.requests.responseTimes.push(duration);

    if (statusCode >= 400) {
      this.requests.error++;
    } else {
      this.requests.success++;
    }

    // 计算平均响应时间（最后 100 个请求）
    if (this.requests.responseTimes.length > 100) {
      this.requests.responseTimes.shift();
    }
    this.requests.avgTime =
      this.requests.responseTimes.reduce((a, b) => a + b, 0) /
      this.requests.responseTimes.length;

    // 告警：响应时间过长
    if (duration > 2000) {
      logger.warn('Slow API Request', {
        duration: `${duration}ms`,
        statusCode,
      });
    }
  }

  // 记录数据库查询
  recordQuery(duration) {
    this.database.queries++;
    this.database.queryTimes.push(duration);

    if (this.database.queryTimes.length > 100) {
      this.database.queryTimes.shift();
    }
    this.database.avgTime =
      this.database.queryTimes.reduce((a, b) => a + b, 0) /
      this.database.queryTimes.length;

    // 告警：查询过慢
    if (duration > 500) {
      logger.warn('Slow Database Query', {
        duration: `${duration}ms`,
      });
    }
  }

  recordQueryError() {
    this.database.errors++;
    if (this.database.errors % 10 === 0) {
      const errorRate = this.database.queries > 0
        ? `${((this.database.errors / this.database.queries) * 100).toFixed(2)}%`
        : 'N/A';
      logger.warn('Database Error Rate High', {
        errors: this.database.errors,
        queries: this.database.queries,
        errorRate,
      });
    }
  }

  // 记录缓存命中
  recordCacheHit() {
    this.cache.hits++;
    this.updateHitRate();
  }

  recordCacheMiss() {
    this.cache.misses++;
    this.updateHitRate();
  }

  updateHitRate() {
    const total = this.cache.hits + this.cache.misses;
    this.cache.hitRate = total > 0 ? (this.cache.hits / total) * 100 : 0;
  }

  // 获取当前指标
  getMetrics() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    return {
      uptime: `${uptime}s`,
      requests: {
        total: this.requests.total,
        success: this.requests.success,
        error: this.requests.error,
        errorRate: `${((this.requests.error / this.requests.total) * 100 || 0).toFixed(2)}%`,
        avgTime: `${this.requests.avgTime.toFixed(2)}ms`,
      },
      database: {
        queries: this.database.queries,
        avgTime: `${this.database.avgTime.toFixed(2)}ms`,
        errors: this.database.errors,
      },
      cache: {
        hits: this.cache.hits,
        misses: this.cache.misses,
        hitRate: `${this.cache.hitRate.toFixed(2)}%`,
      },
    };
  }

  // 导出 Prometheus 格式
  getPrometheusMetrics() {
    const m = this.getMetrics();
    return `# HELP vxin_requests_total Total number of requests
# TYPE vxin_requests_total counter
vxin_requests_total{status="success"} ${m.requests.success}
vxin_requests_total{status="error"} ${m.requests.error}

# HELP vxin_request_duration_avg Average request duration in milliseconds
# TYPE vxin_request_duration_avg gauge
vxin_request_duration_avg ${this.requests.avgTime}

# HELP vxin_cache_hit_rate Cache hit rate percentage
# TYPE vxin_cache_hit_rate gauge
vxin_cache_hit_rate ${this.cache.hitRate}

# HELP vxin_database_queries_total Total database queries
# TYPE vxin_database_queries_total counter
vxin_database_queries_total ${m.database.queries}

# HELP vxin_uptime Server uptime in seconds
# TYPE vxin_uptime gauge
vxin_uptime ${Math.floor((Date.now() - this.startTime) / 1000)}
`;
  }
}

// 全局指标实例
const metrics = new Metrics();

// API 中间件：自动记录请求
function metricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    metrics.recordRequest(duration, res.statusCode);
  });

  next();
}

module.exports = {
  metrics,
  metricsMiddleware,
  Metrics,
};
