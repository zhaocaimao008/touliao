'use strict';
/**
 * 查询优化器 - 慢查询监控、缓存、索引建议
 */
const { readDb } = require('../db/connection');
const { warn, info } = require('./logger');

// 慢查询阈值（毫秒）
const SLOW_QUERY_THRESHOLD = 100;

// 查询缓存（内存LRU缓存，生产环境应使用Redis）
class QueryCache {
  constructor(maxSize = 1000, ttl = 60000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.hits = 0;
    this.misses = 0;
    this.startCleanup();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    // LRU: 重新插入到末尾
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    // 如果已满，删除最老的条目（Map保持插入顺序）
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttl,
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  // 清理过期条目
  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiry) {
          this.cache.delete(key);
        }
      }
    }, 60000); // 每分钟清理一次
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : '0%',
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}

// 全局查询缓存实例
const queryCache = new QueryCache(1000, 60000); // 1000条缓存，60秒TTL

// 慢查询记录
const slowQueries = [];
const MAX_SLOW_QUERIES = 100;

class QueryOptimizer {
  /**
   * 执行查询并监控性能
   */
  static execute(sql, params = [], options = {}) {
    const { cache = false, cacheKey = null, cacheTTL = 60000 } = options;

    // 尝试从缓存获取
    if (cache && cacheKey) {
      const cached = queryCache.get(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    const startTime = Date.now();
    let result;

    try {
      const stmt = readDb.prepare(sql);
      
      // 根据查询类型选择执行方法
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        result = stmt.all(...params);
      } else {
        result = stmt.run(...params);
      }

      const duration = Date.now() - startTime;

      // 记录慢查询
      if (duration > SLOW_QUERY_THRESHOLD) {
        this.recordSlowQuery(sql, params, duration);
      }

      // 缓存结果
      if (cache && cacheKey && sql.trim().toUpperCase().startsWith('SELECT')) {
        queryCache.set(cacheKey, result);
      }

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      warn('查询执行失败', { sql, params, duration, error: err.message });
      throw err;
    }
  }

  /**
   * 记录慢查询
   */
  static recordSlowQuery(sql, params, duration) {
    const slowQuery = {
      sql: sql.substring(0, 500),
      params: JSON.stringify(params).substring(0, 200),
      duration,
      timestamp: Date.now(),
    };

    slowQueries.unshift(slowQuery);
    
    // 限制记录数量
    if (slowQueries.length > MAX_SLOW_QUERIES) {
      slowQueries.pop();
    }

    warn('慢查询检测', slowQuery);
  }

  /**
   * 获取慢查询列表
   */
  static getSlowQueries(limit = 20) {
    return slowQueries.slice(0, limit);
  }

  /**
   * 分析查询并提供索引建议
   */
  static analyzeQuery(sql) {
    try {
      const plan = readDb.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
      
      const suggestions = [];

      // 检查是否使用了索引
      const hasFullScan = plan.some(step => 
        step.detail && step.detail.includes('SCAN TABLE')
      );

      if (hasFullScan) {
        suggestions.push('查询进行了全表扫描，考虑添加索引');
      }

      // 检查临时表使用
      const usesTempTable = plan.some(step =>
        step.detail && step.detail.includes('USE TEMP B-TREE')
      );

      if (usesTempTable) {
        suggestions.push('查询使用了临时表，可能影响性能');
      }

      return {
        plan,
        suggestions,
        needsOptimization: suggestions.length > 0,
      };
    } catch (err) {
      return {
        plan: [],
        suggestions: ['查询分析失败: ' + err.message],
        needsOptimization: false,
      };
    }
  }

  /**
   * 获取表统计信息
   */
  static getTableStats(tableName) {
    try {
      const rowCount = readDb.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
      const indexes = readDb.prepare(`PRAGMA index_list(${tableName})`).all();
      
      const indexDetails = indexes.map(idx => {
        const info = readDb.prepare(`PRAGMA index_info(${idx.name})`).all();
        return {
          name: idx.name,
          unique: idx.unique === 1,
          columns: info.map(col => col.name),
        };
      });

      return {
        tableName,
        rowCount: rowCount.count,
        indexes: indexDetails,
      };
    } catch (err) {
      return {
        tableName,
        error: err.message,
      };
    }
  }

  /**
   * 获取数据库整体统计
   */
  static getDatabaseStats() {
    try {
      const tables = readDb.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `).all();

      const stats = {
        tables: [],
        totalRows: 0,
        cacheStats: queryCache.getStats(),
        slowQueryCount: slowQueries.length,
      };

      for (const table of tables) {
        const tableStats = this.getTableStats(table.name);
        stats.tables.push(tableStats);
        stats.totalRows += tableStats.rowCount || 0;
      }

      return stats;
    } catch (err) {
      return {
        error: err.message,
      };
    }
  }

  /**
   * 清空查询缓存
   */
  static clearCache(pattern = null) {
    if (pattern) {
      // 清空匹配模式的缓存键
      for (const key of queryCache.cache.keys()) {
        if (key.includes(pattern)) {
          queryCache.delete(key);
        }
      }
    } else {
      queryCache.clear();
    }
    info('查询缓存已清空', { pattern });
  }

  /**
   * 预热常用查询
   */
  static warmupCache(queries) {
    info('开始预热查询缓存', { count: queries.length });
    
    for (const { sql, params, cacheKey } of queries) {
      try {
        this.execute(sql, params, { cache: true, cacheKey });
      } catch (err) {
        warn('缓存预热失败', { sql, error: err.message });
      }
    }

    info('查询缓存预热完成', queryCache.getStats());
  }
}

/**
 * 批量查询优化器
 */
class BatchQueryOptimizer {
  constructor(batchSize = 100, flushInterval = 50) {
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
    this.queue = [];
    this.timer = null;
  }

  /**
   * 添加查询到批处理队列
   */
  add(sql, params) {
    return new Promise((resolve, reject) => {
      this.queue.push({ sql, params, resolve, reject });

      if (this.queue.length >= this.batchSize) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.flushInterval);
      }
    });
  }

  /**
   * 执行批处理
   */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.batchSize);

    try {
      readDb.transaction(() => {
        for (const { sql, params, resolve, reject } of batch) {
          try {
            const stmt = readDb.prepare(sql);
            const result = stmt.all(...params);
            resolve(result);
          } catch (err) {
            reject(err);
          }
        }
      })();
    } catch (err) {
      // 事务失败，拒绝所有查询
      batch.forEach(({ reject }) => reject(err));
    }
  }
}

module.exports = {
  QueryOptimizer,
  BatchQueryOptimizer,
  queryCache,
  SLOW_QUERY_THRESHOLD,
};
