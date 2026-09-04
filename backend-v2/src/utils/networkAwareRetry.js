'use strict';
/**
 * 事件循环延迟感知的重试策略 (原 P4.7「网络感知重试」)
 *
 * ⚠ 2026-09-04 更正命名与日志：这个探针**从来就没有测过网络**。
 *   detectNetworkQuality() 的实现是 `await setTimeout(10)` 然后量它实际花了多久，
 *   测到的是 setTimeout 漂移 / 事件循环滞后（event loop delay），与网络无关——
 *   网线拔了它照样报「excellent」。把它叫「网络质量」会在真出网络故障时
 *   误导排查（日志上白纸黑字写着「网络质量: excellent (延迟: 10ms)」）。
 *
 *   而事件循环滞后本身对这个服务是有意义的指标（见 realtime/broadcaster.js 里
 *   关于大房间广播压垮 ELD 的注释），所以不删除机制，只把语义改对：
 *   对外仍保留 quality 分级与 retryConfigs（/api/optimization 端点在用），
 *   但阈值与文案按「事件循环滞后」重新表述。
 *
 *   另：executeWithRetry() 全仓无任何调用方，retryConfigs 目前只被诊断端点读取，
 *   不参与任何实际重试决策——保留待用，但不要误以为线上重试行为受它影响。
 */

class NetworkAwareRetry {
  constructor(options = {}) {
    this.networkQuality = 'good'; // 'excellent', 'good', 'poor', 'offline'（字段名保持不变：诊断端点/外部调用方在读）
    // 阈值单位是「事件循环滞后毫秒数」，不是网络 RTT
    this.latencyThreshold = {
      excellent: 100,   // < 100ms 滞后
      good: 500,
      poor: 2000,
      offline: 10000,   // 事件循环严重阻塞
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
   * 采样一次事件循环滞后：排一个 10ms 的定时器，量它实际晚了多久。
   * （方法名保持 detectNetworkQuality，/api/optimization 路由在调用。）
   */
  async detectNetworkQuality() {
    const previousQuality = this.networkQuality;
    try {
      const startTime = Date.now();

      const SCHEDULED_MS = 10;
      await new Promise(resolve => setTimeout(resolve, SCHEDULED_MS));

      // 减去本来就要等的 10ms，剩下的才是滞后量；此前直接把整段耗时当「网络延迟」，
      // 所以空载时也恒定报 10ms 上下。
      const latency = Math.max(0, Date.now() - startTime - SCHEDULED_MS);

      if (latency < this.latencyThreshold.excellent) {
        this.networkQuality = 'excellent';
      } else if (latency < this.latencyThreshold.good) {
        this.networkQuality = 'good';
      } else if (latency < this.latencyThreshold.poor) {
        this.networkQuality = 'poor';
      } else {
        this.networkQuality = 'offline';
      }

      // 只在分级发生变化时记一行。此前每 30 秒无条件打一行，生产日志实测
      // 2929 行/天 = 全部应用日志的 43%，真事故会被这条恒定「excellent」淹掉。
      if (this.networkQuality !== previousQuality) {
        console.warn(`[EventLoopLag] 事件循环滞后分级变化: ${previousQuality} → ${this.networkQuality} (滞后 ${latency}ms)`);
      }
      return this.networkQuality;
    } catch (err) {
      this.networkQuality = 'offline';
      console.error('[EventLoopLag] 采样失败:', err.message);
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
        console.debug(`[NetworkAware] 执行 ${taskName} (尝试 ${attempt}/${config.maxRetries})`);
        return await task();
      } catch (err) {
        if (attempt === config.maxRetries) {
          console.error(`[EventLoopLag] ${taskName} 最终失败:`, err.message);
          throw err;
        }

        const delay = this.calculateDelay(attempt);
        console.warn(
          `[EventLoopLag] ${taskName} 失败，${Math.round(delay)}ms 后重试:`,
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
      console.debug(`[EventLoopLag] 分级已手动设置: ${quality}`);
    }
  }

  /**
   * 启动网络质量监测
   */
  startMonitoring(interval = 30000) { // 默认 30 秒
    setInterval(async () => {
      await this.detectNetworkQuality();
    }, interval).unref();

    console.debug(`[EventLoopLag] 事件循环滞后监测已启动 (间隔: ${interval}ms)`);
  }
}

module.exports = NetworkAwareRetry;
