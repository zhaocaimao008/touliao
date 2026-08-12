/**
 * P11.4: 全球监控系统
 * 实时监控多区域性能指标
 */
class GlobalMonitoring {
  constructor() {
    this.metrics = new Map();
    this.alerts = [];
    this.thresholds = {
      latency: 500,
      errorRate: 0.05,
      cpuUsage: 80,
      memoryUsage: 85,
    };
  }

  /**
   * 记录区域指标
   */
  recordMetric(region, metricName, value, timestamp = Date.now()) {
    const key = `${region}:${metricName}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    
    const history = this.metrics.get(key);
    history.push({ value, timestamp });
    
    // 保留最近 1000 个数据点
    if (history.length > 1000) {
      history.shift();
    }

    // 检查阈值
    this.checkThreshold(region, metricName, value);
  }

  /**
   * 检查阈值告警
   */
  checkThreshold(region, metricName, value) {
    if (value > this.thresholds[metricName]) {
      this.alerts.push({
        level: 'warning',
        region,
        metric: metricName,
        value,
        threshold: this.thresholds[metricName],
        timestamp: Date.now(),
      });
    }

    if (value > this.thresholds[metricName] * 1.5) {
      this.alerts.push({
        level: 'critical',
        region,
        metric: metricName,
        value,
        threshold: this.thresholds[metricName],
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 计算区域可用性
   */
  calculateAvailability(region, timeWindowMs = 3600000) {
    const latencyKey = `${region}:latency`;
    const history = this.metrics.get(latencyKey) || [];
    
    if (history.length === 0) return 100;

    const now = Date.now();
    const recentMetrics = history.filter(m => now - m.timestamp < timeWindowMs);
    
    if (recentMetrics.length === 0) return 100;

    const healthyCount = recentMetrics.filter(m => m.value < this.thresholds.latency).length;
    return ((healthyCount / recentMetrics.length) * 100).toFixed(2);
  }

  /**
   * 生成区域健康报告
   */
  getRegionReport(region) {
    return {
      region,
      availability: this.calculateAvailability(region),
      avgLatency: this.getAverageMetric(region, 'latency'),
      avgErrorRate: this.getAverageMetric(region, 'errorRate'),
      avgCpuUsage: this.getAverageMetric(region, 'cpuUsage'),
      avgMemoryUsage: this.getAverageMetric(region, 'memoryUsage'),
      recentAlerts: this.alerts.filter(a => a.region === region).slice(-5),
    };
  }

  getAverageMetric(region, metricName) {
    const key = `${region}:${metricName}`;
    const history = this.metrics.get(key) || [];
    
    if (history.length === 0) return 0;

    const sum = history.reduce((acc, m) => acc + m.value, 0);
    return (sum / history.length).toFixed(2);
  }

  /**
   * 全球概览
   */
  getGlobalStatus() {
    const regions = ['cn', 'us', 'eu'];
    return {
      timestamp: Date.now(),
      regions: regions.map(r => ({
        ...this.getRegionReport(r),
      })),
      globalAvailability: this.calculateGlobalAvailability(),
      recentAlerts: this.alerts.slice(-10),
    };
  }

  calculateGlobalAvailability() {
    const regions = ['cn', 'us', 'eu'];
    const availabilities = regions.map(r => parseFloat(this.calculateAvailability(r)));
    const avg = availabilities.reduce((a, b) => a + b, 0) / availabilities.length;
    return avg.toFixed(2);
  }
}

module.exports = GlobalMonitoring;
