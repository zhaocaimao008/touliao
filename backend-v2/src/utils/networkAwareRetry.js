'use strict';
/**
 * 网络感知重试策略 (P4.7 优化)
 * 根据网络质量调整重试策略
 */

class NetworkAwareRetry {
  constructor(options = {}) {
    this.networkQuality = 'good'; // 'excellent', 'good', 'poor', 'offline'
    this.latencyThreshold = {
      excellent: 100,   // < 100ms
      good: 500,        // < 500ms
      poor: 2000,       // < 2000ms
      offline: 10000,   // 离线
    };
    this.retryConfigs = {
      excellent: {
        maxRetries: 2,
        baseDelay: 1000,      // 1s
        multiplier: 2,
        maxDelay: 5000,
      },
      good: {
        maxRetries: 3,
        baseDelay: 2000,      // 2s
        multiplier: 2,
        maxDelay: 15000,
      },
      poor: {
        maxRetries: 5,
        baseDelay: 5000,      // 5s
        multiplier: 1.5,
        maxDelay: 30000,
      },
      offline: {
        maxRetries: 10,
        baseDelay: 10000,     // 10s
        multiplier: 1,
        maxDelay: 60000,
      },
    };
  }

  /**
   * 检测网络质量 (通过 ping)
   */
  async detectNetworkQuality() {
    try {
      const startTime = Date.now();
      
      // 简单的延迟测试
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const latency = Date.now() - startTime;

      if (latency < this.latencyThreshold.excellent) {
        this.networkQuality = 'excellent';
      } else if (latency < this.latencyThreshold.good) {
        this.networkQuality = 'good';
      } else if (latency < this.latencyThreshold.poor) {
        this.networkQuality = 'poor';
      } else {
        this.networkQuality = 'offline';
      }

      console.log(`[NetworkAware] 网络质量: ${this.networkQuality} (延迟: ${latency}ms)`);
      return this.networkQuality;
    } catch (err) {
      this.networkQuality = 'offline';
      console.error('[NetworkAware] 网络检测失败:', err.message);
      return 'offline';
    }
  }

  /**
   * 计算重试延迟
   */
  calculateDelay(attempt) {
    const config = this.retryConfigs[this.networkQuality];
    const delay = Math.min(
      config.baseDelay * Math.pow(config.multiplier, attempt - 1),
      config.maxDelay
    );

    // 添加随机抖动 (±20%)
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return Math.max(0, delay + jitter);
  }

  /**
   * 执行带重试的异步任务
   */
  async executeWithRetry(task, taskName = 'task') {
    const config = this.retryConfigs[this.networkQuality];
    
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        console.log(`[NetworkAware] 执行 ${taskName} (尝试 ${attempt}/${config.maxRetries})`);
        return await task();
      } catch (err) {
        if (attempt === config.maxRetries) {
          console.error(`[NetworkAware] ${taskName} 最终失败:`, err.message);
          throw err;
        }

        const delay = this.calculateDelay(attempt);
        console.warn(
          `[NetworkAware] ${taskName} 失败，${Math.round(delay)}ms 后重试:`,
          err.message
        );

        // 重新检测网络质量
        await this.detectNetworkQuality();
        
        // 等待重试
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * 批量任务重试
   */
  async executeBatchWithRetry(tasks, taskName = 'batch') {
    const results = [];

    for (let i = 0; i < tasks.length; i++) {
      try {
        const result = await this.executeWithRetry(
          tasks[i],
          `${taskName}[${i + 1}/${tasks.length}]`
        );
        results.push({ success: true, data: result });
      } catch (err) {
        results.push({ success: false, error: err.message });
      }
    }

    return results;
  }

  /**
   * 获取重试配置
   */
  getConfig() {
    return {
      currentQuality: this.networkQuality,
      config: this.retryConfigs[this.networkQuality],
      allConfigs: this.retryConfigs,
    };
  }

  /**
   * 手动设置网络质量
   */
  setNetworkQuality(quality) {
    if (this.retryConfigs[quality]) {
      this.networkQuality = quality;
      console.log(`[NetworkAware] 网络质量已设置: ${quality}`);
    }
  }

  /**
   * 启动网络质量监测
   */
  startMonitoring(interval = 30000) { // 默认 30 秒
    setInterval(async () => {
      await this.detectNetworkQuality();
    }, interval).unref();

    console.log(`[NetworkAware] 网络监测已启动 (间隔: ${interval}ms)`);
  }
}

module.exports = NetworkAwareRetry;
