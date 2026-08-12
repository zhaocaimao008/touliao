/**
 * 性能监控：慢查询告警、API响应时间追踪
 */
'use strict';

const { warn, error: logError } = require('./logger');

// 慢查询阈值（毫秒）
const SLOW_QUERY_THRESHOLD = 100;
const VERY_SLOW_QUERY_THRESHOLD = 500;

// 慢 API 阈值（毫秒）
const SLOW_API_THRESHOLD = 1000;
const VERY_SLOW_API_THRESHOLD = 3000;

// 统计数据
const stats = {
  slowQueries: [],
  slowApis: [],
  queryCount: 0,
  apiCount: 0
};

/**
 * 记录慢查询
 */
function logSlowQuery(sql, duration, params = []) {
  stats.queryCount++;
  
  if (duration >= VERY_SLOW_QUERY_THRESHOLD) {
    logError(`[PERF] 极慢查询 ${duration}ms: ${sql.slice(0, 200)}`, { params });
  } else if (duration >= SLOW_QUERY_THRESHOLD) {
    warn(`[PERF] 慢查询 ${duration}ms: ${sql.slice(0, 200)}`, { params });
  }
  
  if (duration >= SLOW_QUERY_THRESHOLD) {
    stats.slowQueries.push({
      sql: sql.slice(0, 500),
      duration,
      params: params.slice(0, 10),
      timestamp: Date.now()
    });
    
    // 只保留最近 100 条
    if (stats.slowQueries.length > 100) {
      stats.slowQueries.shift();
    }
  }
}

/**
 * 记录慢 API
 */
function logSlowApi(method, path, duration, statusCode) {
  stats.apiCount++;
  
  if (duration >= VERY_SLOW_API_THRESHOLD) {
    logError(`[PERF] 极慢API ${duration}ms: ${method} ${path} → ${statusCode}`);
  } else if (duration >= SLOW_API_THRESHOLD) {
    warn(`[PERF] 慢API ${duration}ms: ${method} ${path} → ${statusCode}`);
  }
  
  if (duration >= SLOW_API_THRESHOLD) {
    stats.slowApis.push({
      method,
      path,
      duration,
      statusCode,
      timestamp: Date.now()
    });
    
    // 只保留最近 100 条
    if (stats.slowApis.length > 100) {
      stats.slowApis.shift();
    }
  }
}

/**
 * 获取性能统计
 */
function getPerformanceStats() {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  
  const recentSlowQueries = stats.slowQueries.filter(q => q.timestamp >= oneHourAgo);
  const recentSlowApis = stats.slowApis.filter(a => a.timestamp >= oneHourAgo);
  
  return {
    totalQueries: stats.queryCount,
    totalApis: stats.apiCount,
    recentSlowQueries: recentSlowQueries.length,
    recentSlowApis: recentSlowApis.length,
    slowestQueries: stats.slowQueries
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10),
    slowestApis: stats.slowApis
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
  };
}

/**
 * 重置统计
 */
function resetStats() {
  stats.slowQueries = [];
  stats.slowApis = [];
  stats.queryCount = 0;
  stats.apiCount = 0;
}

/**
 * 包装数据库查询，自动监控性能
 */
function wrapDbQuery(db) {
  const originalPrepare = db.prepare.bind(db);
  
  db.prepare = function(sql) {
    const stmt = originalPrepare(sql);
    
    // 包装 get
    const originalGet = stmt.get.bind(stmt);
    stmt.get = function(...params) {
      const start = Date.now();
      try {
        return originalGet(...params);
      } finally {
        const duration = Date.now() - start;
        logSlowQuery(sql, duration, params);
      }
    };
    
    // 包装 all
    const originalAll = stmt.all.bind(stmt);
    stmt.all = function(...params) {
      const start = Date.now();
      try {
        return originalAll(...params);
      } finally {
        const duration = Date.now() - start;
        logSlowQuery(sql, duration, params);
      }
    };
    
    // 包装 run
    const originalRun = stmt.run.bind(stmt);
    stmt.run = function(...params) {
      const start = Date.now();
      try {
        return originalRun(...params);
      } finally {
        const duration = Date.now() - start;
        logSlowQuery(sql, duration, params);
      }
    };
    
    return stmt;
  };
  
  return db;
}

/**
 * Express 中间件：监控 API 响应时间
 */
function performanceMiddleware(req, res, next) {
  const start = Date.now();
  
  // 监听响应结束
  res.on('finish', () => {
    const duration = Date.now() - start;
    logSlowApi(req.method, req.path, duration, res.statusCode);
  });
  
  next();
}

module.exports = {
  logSlowQuery,
  logSlowApi,
  getPerformanceStats,
  resetStats,
  wrapDbQuery,
  performanceMiddleware,
  SLOW_QUERY_THRESHOLD,
  SLOW_API_THRESHOLD
};
