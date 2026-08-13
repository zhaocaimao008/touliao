/**
 * ⚠️  安全警告：此文件为死代码，从未被任何路由或模块 require。
 *
 * 危险模式（禁止引入生产路由）：
 *   - 含有 `new RegExp(query)` 模式 —— 若 query 来自用户输入，存在 ReDoS 风险
 *
 * 切勿将该类 require 到任何 HTTP 请求处理链中。
 *
 * P10.3: 自动索引推荐系统
 */
class IndexRecommendationSystem {
  constructor(db) {
    this.db = db;
    this.queryPatterns = [];
    this.indexRecommendations = [];
  }

  /**
   * 分析查询模式
   */
  analyzeQueryPattern(query) {
    const pattern = {
      query,
      timestamp: Date.now(),
      whereColumns: this.extractWhereColumns(query),
      joinColumns: this.extractJoinColumns(query),
      orderByColumns: this.extractOrderByColumns(query),
    };
    
    this.queryPatterns.push(pattern);
    return pattern;
  }

  /**
   * 推荐索引
   */
  recommendIndices() {
    const recommendations = {};
    
    this.queryPatterns.forEach(pattern => {
      // WHERE 条件列
      pattern.whereColumns.forEach(col => {
        const key = `${col.table}.${col.column}`;
        if (!recommendations[key]) {
          recommendations[key] = { type: 'WHERE', score: 0, usage: 0 };
        }
        recommendations[key].score += 100;
        recommendations[key].usage++;
      });
      
      // ORDER BY 列
      pattern.orderByColumns.forEach(col => {
        const key = `${col.table}.${col.column}`;
        if (!recommendations[key]) {
          recommendations[key] = { type: 'ORDER_BY', score: 0, usage: 0 };
        }
        recommendations[key].score += 50;
        recommendations[key].usage++;
      });
    });
    
    return Object.entries(recommendations)
      .sort(([,a], [,b]) => b.score - a.score)
      .map(([key, value]) => ({ column: key, ...value }));
  }

  /**
   * 创建推荐索引
   */
  async createRecommendedIndex(table, column) {
    const indexName = `idx_${table}_${column.replace('.', '_')}`;
    try {
      await this.db.prepare(`CREATE INDEX ${indexName} ON ${table}(${column})`).run();
      return { success: true, indexName };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  extractWhereColumns(query) {
    const regex = /WHERE\s+(\w+)\.(\w+)/gi;
    const matches = [];
    let match;
    while ((match = regex.exec(query))) {
      matches.push({ table: match[1], column: match[2] });
    }
    return matches;
  }

  extractJoinColumns(query) {
    const regex = /JOIN\s+\w+\s+ON\s+(\w+)\.(\w+)/gi;
    const matches = [];
    let match;
    while ((match = regex.exec(query))) {
      matches.push({ table: match[1], column: match[2] });
    }
    return matches;
  }

  extractOrderByColumns(query) {
    const regex = /ORDER\s+BY\s+(\w+)\.(\w+)/gi;
    const matches = [];
    let match;
    while ((match = regex.exec(query))) {
      matches.push({ table: match[1], column: match[2] });
    }
    return matches;
  }
}

module.exports = IndexRecommendationSystem;
