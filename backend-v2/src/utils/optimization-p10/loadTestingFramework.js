/**
 * P10.5: 压力测试框架
 * 负载测试 + 尖峰测试 + 长期稳定性测试
 */

class LoadTestingFramework {
  constructor(config = {}) {
    this.config = config;
    this.results = [];
    this.currentLoad = 0;
  }

  /**
   * 执行负载测试
   */
  async loadTest(handler, options = {}) {
    const {
      duration = 60000, // 60秒
      rps = 100, // 每秒请求数
      name = 'load_test',
    } = options;

    const startTime = Date.now();
    const results = [];
    let requestCount = 0;
    let errorCount = 0;
    const latencies = [];

    const interval = setInterval(async () => {
      for (let i = 0; i < rps / 10; i++) {
        const reqStart = Date.now();
        try {
          await handler();
          latencies.push(Date.now() - reqStart);
          requestCount++;
        } catch (e) {
          errorCount++;
        }
      }
    }, 100);

    // 等待测试完成
    await new Promise(resolve => 
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, duration)
    );

    const totalDuration = Date.now() - startTime;

    return {
      name,
      totalRequests: requestCount,
      errorCount,
      errorRate: ((errorCount / requestCount) * 100).toFixed(2) + '%',
      avgLatency: (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2) + 'ms',
      p95Latency: this.percentile(latencies, 0.95).toFixed(2) + 'ms',
      p99Latency: this.percentile(latencies, 0.99).toFixed(2) + 'ms',
      throughput: (requestCount / (totalDuration / 1000)).toFixed(2) + ' req/s',
    };
  }

  /**
   * 尖峰测试
   */
  async spikeTest(handler, options = {}) {
    const {
      normalRps = 50,
      spikeRps = 500,
      duration = 30000,
    } = options;

    // 正常负载 10 秒
    const normalResult = await this.loadTest(handler, {
      rps: normalRps,
      duration: 10000,
      name: 'spike_normal',
    });

    // 尖峰 10 秒
    const spikeResult = await this.loadTest(handler, {
      rps: spikeRps,
      duration: 10000,
      name: 'spike_peak',
    });

    // 恢复 10 秒
    const recoveryResult = await this.loadTest(handler, {
      rps: normalRps,
      duration: 10000,
      name: 'spike_recovery',
    });

    return {
      normal: normalResult,
      spike: spikeResult,
      recovery: recoveryResult,
      spikeImpact: ((spikeResult.errorRate - normalResult.errorRate) * 100).toFixed(2) + '%',
    };
  }

  /**
   * 长期稳定性测试
   */
  async stabilityTest(handler, options = {}) {
    const {
      duration = 72 * 3600 * 1000, // 72小时
      rps = 100,
    } = options;

    const startTime = Date.now();
    let requestCount = 0;
    let errorCount = 0;
    const memorySnapshots = [];

    const interval = setInterval(async () => {
      try {
        await handler();
        requestCount++;
      } catch (e) {
        errorCount++;
      }

      // 记录内存使用
      memorySnapshots.push({
        timestamp: Date.now(),
        heap: process.memoryUsage().heapUsed,
      });
    }, 1000 / rps);

    await new Promise(resolve => 
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, duration)
    );

    return {
      duration: (Date.now() - startTime) / 3600000 + ' hours',
      totalRequests: requestCount,
      errorRate: ((errorCount / requestCount) * 100).toFixed(2) + '%',
      memoryLeakDetected: this.detectMemoryLeak(memorySnapshots),
    };
  }

  percentile(arr, p) {
    const sorted = arr.sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[index] || 0;
  }

  detectMemoryLeak(snapshots) {
    if (snapshots.length < 10) return false;

    const first = snapshots[0].heap;
    const last = snapshots[snapshots.length - 1].heap;
    const increase = ((last - first) / first) * 100;

    return increase > 20; // 20% 以上增长视为泄漏
  }
}

module.exports = LoadTestingFramework;
