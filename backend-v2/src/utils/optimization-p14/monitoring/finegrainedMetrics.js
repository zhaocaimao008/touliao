/**
 * P14.2: 细粒度性能分析
 */
class FineGrainedMetrics {
  constructor() {
    this.metrics = new Map();
    this.traces = [];
    this.heatmap = new Map();
  }

  /**
   * 方法级别追踪
   */
  traceMethod(className, methodName, duration, result) {
    const key = `${className}.${methodName}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, { count: 0, totalTime: 0, maxTime: 0, minTime: Infinity, errors: 0 });
    }

    const metric = this.metrics.get(key);
    metric.count++;
    metric.totalTime += duration;
    metric.maxTime = Math.max(metric.maxTime, duration);
    metric.minTime = Math.min(metric.minTime, duration);
    
    if (!result.success) metric.errors++;
  }

  /**
   * 热点函数识别
   */
  identifyHotspots(threshold = 100) {
    const hotspots = [];
    
    for (const [method, metric] of this.metrics) {
      const avgTime = metric.totalTime / metric.count;
      if (avgTime > threshold) {
        hotspots.push({
          method,
          avgTime: avgTime.toFixed(2),
          calls: metric.count,
          totalTime: metric.totalTime,
          errorRate: ((metric.errors / metric.count) * 100).toFixed(2) + '%',
        });
      }
    }

    return hotspots.sort((a, b) => b.avgTime - a.avgTime);
  }

  /**
   * 自适应调优建议
   */
  generateOptimizationSuggestions() {
    const suggestions = [];
    const hotspots = this.identifyHotspots();

    for (const hotspot of hotspots.slice(0, 5)) {
      if (hotspot.avgTime > 500) {
        suggestions.push({
          method: hotspot.method,
          issue: '响应时间过长',
          recommendation: '考虑异步处理或缓存',
          priority: 'HIGH',
        });
      }

      if (parseFloat(hotspot.errorRate) > 5) {
        suggestions.push({
          method: hotspot.method,
          issue: '错误率过高',
          recommendation: '增加错误处理和重试机制',
          priority: 'HIGH',
        });
      }
    }

    return suggestions;
  }

  /**
   * 性能热力图
   */
  getPerformanceHeatmap() {
    const heatmapData = [];
    
    for (const [method, metric] of this.metrics) {
      const avgTime = metric.totalTime / metric.count;
      const intensity = Math.min(100, (avgTime / 1000) * 10);
      
      heatmapData.push({
        method,
        intensity: intensity.toFixed(2),
        color: intensity > 70 ? 'red' : intensity > 40 ? 'yellow' : 'green',
      });
    }

    return heatmapData;
  }

  getReport() {
    return {
      totalMethods: this.metrics.size,
      hotspots: this.identifyHotspots(),
      suggestions: this.generateOptimizationSuggestions(),
      heatmap: this.getPerformanceHeatmap(),
    };
  }
}

module.exports = FineGrainedMetrics;
