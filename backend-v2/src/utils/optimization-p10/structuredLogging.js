/**
 * P10.4: 结构化日志 + 聚合
 */

class StructuredLogger {
  constructor(config = {}) {
    this.config = config;
    this.logs = [];
    this.levels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      FATAL: 4,
    };
    this.minLevel = this.levels[config.minLevel || 'INFO'];
  }

  /**
   * 记录结构化日志
   */
  log(level, message, context = {}) {
    if (this.levels[level] < this.minLevel) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        ...context,
        requestId: context.requestId || this.generateRequestId(),
        userId: context.userId || 'anonymous',
        endpoint: context.endpoint || 'unknown',
      },
      traceId: context.traceId || this.generateTraceId(),
    };
    
    this.logs.push(logEntry);
    
    // 输出为 JSON 格式
    console.log(JSON.stringify(logEntry));
    
    return logEntry;
  }

  /**
   * 快捷方法
   */
  debug(msg, ctx) { return this.log('DEBUG', msg, ctx); }
  info(msg, ctx) { return this.log('INFO', msg, ctx); }
  warn(msg, ctx) { return this.log('WARN', msg, ctx); }
  error(msg, ctx) { return this.log('ERROR', msg, ctx); }
  fatal(msg, ctx) { return this.log('FATAL', msg, ctx); }

  /**
   * 聚合日志
   */
  aggregateLogs(hours = 1) {
    const cutoff = Date.now() - hours * 3600 * 1000;
    const recent = this.logs.filter(l => 
      new Date(l.timestamp).getTime() > cutoff
    );
    
    const aggregated = {
      totalLogs: recent.length,
      byLevel: {},
      byEndpoint: {},
      errors: [],
    };
    
    recent.forEach(log => {
      aggregated.byLevel[log.level] = (aggregated.byLevel[log.level] || 0) + 1;
      aggregated.byEndpoint[log.context.endpoint] = 
        (aggregated.byEndpoint[log.context.endpoint] || 0) + 1;
      
      if (log.level === 'ERROR' || log.level === 'FATAL') {
        aggregated.errors.push(log);
      }
    });
    
    return aggregated;
  }

  /**
   * 性能分析日志
   */
  logPerformance(endpoint, duration, status = 200) {
    this.info('request_completed', {
      endpoint,
      duration,
      status,
      slow: duration > 1000,
    });
  }

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateTraceId() {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = StructuredLogger;
