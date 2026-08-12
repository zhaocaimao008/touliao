/**
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
