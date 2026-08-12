/**
 * P10.5: 混沌工程工具集
 */
class ChaosEngineeringKit {
  /**
   * 网络故障注入
   */
  static injectNetworkLatency(latencyMs = 500) {
    return {
      type: 'NETWORK_LATENCY',
      latency: latencyMs,
      apply: async (fn) => {
        await new Promise(r => setTimeout(r, latencyMs));
        return fn();
      }
    };
  }

  /**
   * 服务故障注入
   */
  static injectServiceFailure(errorRate = 0.1) {
    return {
      type: 'SERVICE_FAILURE',
      errorRate,
      apply: async (fn) => {
        if (Math.random() < errorRate) {
          throw new Error('Injected service failure');
        }
        return fn();
      }
    };
  }

  /**
   * 资源限制测试
   */
  static injectResourceConstraint(type = 'memory', limit = 100 * 1024 * 1024) {
    return {
      type: 'RESOURCE_CONSTRAINT',
      resource: type,
      limit,
      message: `${type} limited to ${(limit / 1024 / 1024).toFixed(0)}MB`,
    };
  }

  /**
   * 故障转移验证
   */
  static async testFailover(primaryFn, backupFn, failureInjection) {
    try {
      return await failureInjection.apply(primaryFn);
    } catch (e) {
      console.log('Primary failed, switching to backup');
      return await backupFn();
    }
  }

  /**
   * 获取混沌报告
   */
  static getChaosReport(results) {
    return {
      totalTests: results.length,
      successful: results.filter(r => r.success).length,
      resilience: ((results.filter(r => r.recovered).length / results.length) * 100).toFixed(2) + '%',
    };
  }
}

module.exports = ChaosEngineeringKit;
