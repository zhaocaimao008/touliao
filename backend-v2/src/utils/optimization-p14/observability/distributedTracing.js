/**
 * P14.5: 分布式链路追踪增强
 */
class DistributedTracing {
  constructor() {
    this.traces = new Map();
    this.spans = new Map();
    this.logAggregation = [];
  }

  /**
   * 增强的链路追踪
   */
  createTrace(traceId, serviceName) {
    const trace = {
      traceId,
      serviceName,
      startTime: Date.now(),
      spans: [],
      status: 'in_progress',
    };
    this.traces.set(traceId, trace);
    return trace;
  }

  /**
   * 精细化 Span 记录
   */
  addSpan(traceId, spanName, operation, details = {}) {
    const span = {
      spanId: `span_${Date.now()}`,
      traceId,
      spanName,
      operation,
      startTime: Date.now(),
      details,
      status: 'in_progress',
    };

    if (!this.spans.has(traceId)) {
      this.spans.set(traceId, []);
    }
    this.spans.get(traceId).push(span);
    return span;
  }

  /**
   * 日志聚合和分析
   */
  aggregateLogs(traceId, startTime, endTime) {
    const logs = this.logAggregation.filter(log => 
      log.traceId === traceId && 
      log.timestamp >= startTime && 
      log.timestamp <= endTime
    );

    return {
      totalLogs: logs.length,
      byLevel: {
        ERROR: logs.filter(l => l.level === 'ERROR').length,
        WARN: logs.filter(l => l.level === 'WARN').length,
        INFO: logs.filter(l => l.level === 'INFO').length,
        DEBUG: logs.filter(l => l.level === 'DEBUG').length,
      },
      byService: this.groupLogsByService(logs),
    };
  }

  /**
   * 关键路径分析
   */
  analyzeTrace(traceId) {
    const spans = this.spans.get(traceId) || [];
    
    // 计算关键路径
    const criticalPath = spans.sort((a, b) => {
      const durationA = b.endTime - a.startTime || 0;
      const durationB = b.endTime - b.startTime || 0;
      return durationB - durationA;
    });

    return {
      traceId,
      totalSpans: spans.length,
      criticalPath: criticalPath.slice(0, 5).map(s => ({
        spanName: s.spanName,
        operation: s.operation,
        duration: (s.endTime - s.startTime) || 0,
      })),
      totalDuration: criticalPath[0]?.endTime - spans[0]?.startTime || 0,
    };
  }

  /**
   * 异常检测
   */
  detectAnomalies() {
    const anomalies = [];
    
    for (const [traceId, spans] of this.spans) {
      const avgDuration = spans.reduce((a, b) => a + (b.duration || 0), 0) / spans.length;
      
      for (const span of spans) {
        if ((span.duration || 0) > avgDuration * 2) {
          anomalies.push({
            traceId,
            spanName: span.spanName,
            duration: span.duration,
            avgDuration: avgDuration.toFixed(2),
            deviation: '> 2x 平均值',
          });
        }

        if (span.status === 'error') {
          anomalies.push({
            traceId,
            spanName: span.spanName,
            issue: '执行失败',
            error: span.error,
          });
        }
      }
    }

    return anomalies;
  }

  groupLogsByService(logs) {
    const grouped = {};
    logs.forEach(log => {
      if (!grouped[log.service]) grouped[log.service] = 0;
      grouped[log.service]++;
    });
    return grouped;
  }
}

module.exports = DistributedTracing;
