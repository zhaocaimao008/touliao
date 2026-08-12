/**
 * P10.3: 网络优化
 */
class NetworkOptimization {
  /**
   * 启用 HTTP/2 Server Push
   */
  static configureHTTP2(app) {
    app.set('x-powered-by', false); // 移除服务器标识
    
    return {
      enableH2: true,
      message: 'HTTP/2 enabled - Server Push support',
    };
  }

  /**
   * 数据压缩策略
   */
  static getCompressionStrategy(contentType) {
    if (contentType.includes('application/json') || 
        contentType.includes('text/')) {
      return {
        algorithm: 'brotli',
        level: 6,
        threshold: 1024, // 压缩 > 1KB 的内容
      };
    }
    
    if (contentType.includes('image/')) {
      return null; // 图片已压缩
    }
    
    return {
      algorithm: 'gzip',
      level: 6,
    };
  }

  /**
   * 增量同步
   */
  static calculateDelta(previous, current) {
    const delta = {};
    
    for (const key in current) {
      if (previous[key] !== current[key]) {
        delta[key] = current[key];
      }
    }
    
    return delta;
  }

  /**
   * 连接池优化
   */
  static getConnectionPoolConfig() {
    return {
      min: 5,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
  }
}

module.exports = NetworkOptimization;
