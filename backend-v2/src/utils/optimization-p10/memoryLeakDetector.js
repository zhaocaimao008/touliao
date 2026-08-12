/**
 * P10.2: 内存泄漏检测系统
 * 自动检测引用未释放、闭包陷阱、事件监听器泄漏
 */

class MemoryLeakDetector {
  constructor() {
    this.snapshots = [];
    this.thresholds = {
      heapUsedIncrease: 50 * 1024 * 1024, // 50MB
      leakSuspicionCount: 3, // 连续3次增长
    };
    this.listeners = new Map();
    this.timers = new Map();
  }

  /**
   * 拍摄内存快照
   */
  takeSnapshot(label = 'snapshot') {
    const used = process.memoryUsage().heapUsed;
    const snapshot = {
      label,
      timestamp: Date.now(),
      heapUsed: used,
      external: process.memoryUsage().external,
    };
    
    this.snapshots.push(snapshot);
    return snapshot;
  }

  /**
   * 分析内存趋势
   */
  analyzeMemoryTrend() {
    if (this.snapshots.length < 2) return null;
    
    const trend = [];
    for (let i = 1; i < this.snapshots.length; i++) {
      const prev = this.snapshots[i - 1];
      const curr = this.snapshots[i];
      const increase = curr.heapUsed - prev.heapUsed;
      
      trend.push({
        from: prev.label,
        to: curr.label,
        increase,
        isLeakSuspicious: increase > this.thresholds.heapUsedIncrease,
      });
    }
    
    return trend;
  }

  /**
   * 检测内存泄漏
   */
  detectLeak() {
    const trend = this.analyzeMemoryTrend();
    if (!trend || trend.length < this.thresholds.leakSuspicionCount) {
      return { leakDetected: false };
    }
    
    // 检查连续增长
    const recentTrend = trend.slice(-this.thresholds.leakSuspicionCount);
    const allIncreasing = recentTrend.every(t => t.increase > 0);
    const allSuspicious = recentTrend.every(t => t.isLeakSuspicious);
    
    if (allIncreasing && allSuspicious) {
      return {
        leakDetected: true,
        severity: 'HIGH',
        consecutiveGrowth: this.thresholds.leakSuspicionCount,
        totalIncrease: recentTrend.reduce((sum, t) => sum + t.increase, 0),
      };
    }
    
    return { leakDetected: false };
  }

  /**
   * 追踪事件监听器
   */
  trackEventListener(emitter, event, listener) {
    const key = `${emitter.constructor.name}:${event}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(listener);
  }

  /**
   * 移除未追踪的监听器警告
   */
  warnUnremovedListeners() {
    const warnings = [];
    for (const [key, listeners] of this.listeners.entries()) {
      if (listeners.length > 10) {
        warnings.push({
          listener: key,
          count: listeners.length,
          message: `可能的事件监听器泄漏: ${key} 有 ${listeners.length} 个监听器`,
        });
      }
    }
    return warnings;
  }

  /**
   * 追踪计时器
   */
  trackTimer(timerId, timeout, type = 'interval') {
    this.timers.set(timerId, {
      type,
      timeout,
      createdAt: Date.now(),
    });
  }

  /**
   * 清理计时器
   */
  clearTimer(timerId) {
    this.timers.delete(timerId);
  }

  /**
   * 获取未清理的计时器
   */
  getUncleanedTimers() {
    const now = Date.now();
    const uncleaned = [];
    
    for (const [id, info] of this.timers.entries()) {
      if (now - info.createdAt > 300000) { // 5分钟未清理
        uncleaned.push({
          id,
          type: info.type,
          ageMs: now - info.createdAt,
        });
      }
    }
    
    return uncleaned;
  }

  /**
   * 获取诊断报告
   */
  getDiagnosticReport() {
    return {
      memoryTrend: this.analyzeMemoryTrend(),
      leakAnalysis: this.detectLeak(),
      eventListenerWarnings: this.warnUnremovedListeners(),
      uncleanedTimers: this.getUncleanedTimers(),
      currentHeap: process.memoryUsage(),
    };
  }
}

module.exports = MemoryLeakDetector;
