/**
 * P10.3: 查询优化引擎 + EXPLAIN分析
 */

class QueryOptimizationEngine {
  constructor(db) {
    this.db = db;
    this.queryStats = [];
    this.slowQueryThreshold = 1000; // 1秒
  }

  /**
   * 分析查询执行计划
   */
  async analyzeExecutionPlan(query) {
    try {
      const plan = await this.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all();
      return {
        query,
        plan,
        optimizations: this.suggestOptimizations(plan),
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  /**
   * 建议优化方案
   */
  suggestOptimizations(plan) {
    const suggestions = [];
    const planStr = JSON.stringify(plan);
    
    if (planStr.includes('SCAN TABLE')) {
      suggestions.push({
        type: 'MISSING_INDEX',
        severity: 'HIGH',
        message: '检测到全表扫描，建议添加索引',
      });
    }
    
    if (planStr.includes('CROSS PRODUCT')) {
      suggestions.push({
        type: 'INEFFICIENT_JOIN',
        severity: 'MEDIUM',
        message: '检测到低效JOIN，考虑优化条件',
      });
    }
    
    return suggestions;
  }

  /**
   * 执行并统计查询
   */
  async executeAndProfile(query, params = []) {
    const startTime = Date.now();
    const result = await this.db.prepare(query).all(...params);
    const duration = Date.now() - startTime;
    
    this.queryStats.push({
      query: query.substring(0, 100),
      duration,
      timestamp: Date.now(),
      isSlow: duration > this.slowQueryThreshold,
    });
    
    return { result, duration, isSlow: duration > this.slowQueryThreshold };
  }

  /**
   * 检测 N+1 查询
   */
  detectNPlusOne() {
    const groupedQueries = {};
    
    this.queryStats.forEach(stat => {
      const key = stat.query.substring(0, 50);
      groupedQueries[key] = (groupedQueries[key] || 0) + 1;
    });
    
    return Object.entries(groupedQueries)
      .filter(([_, count]) => count > 5)
      .map(([query, count]) => ({
        query,
        count,
        severity: count > 20 ? 'CRITICAL' : 'HIGH',
      }));
  }

  /**
   * 获取性能报告
   */
  getPerformanceReport() {
    const slowQueries = this.queryStats.filter(s => s.isSlow);
    const avgDuration = this.queryStats.length > 0
      ? this.queryStats.reduce((sum, s) => sum + s.duration, 0) / this.queryStats.length
      : 0;
    
    return {
      totalQueries: this.queryStats.length,
      slowQueries: slowQueries.length,
      averageDuration: avgDuration.toFixed(2),
      nPlusOnePatterns: this.detectNPlusOne(),
    };
  }
}

module.exports = QueryOptimizationEngine;
