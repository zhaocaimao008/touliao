/**
 * P10.4: 健康检查框架
 */
class HealthCheckFramework {
  constructor() {
    this.checks = [];
    this.status = { healthy: true, lastCheck: null };
  }

  /**
   * 注册健康检查
   */
  registerCheck(name, checkFn, timeout = 5000) {
    this.checks.push({
      name,
      checkFn,
      timeout,
      lastResult: null,
    });
  }

  /**
   * 执行所有检查
   */
  async performHealthCheck() {
    const results = {};
    let allHealthy = true;
    
    for (const check of this.checks) {
      try {
        const result = await Promise.race([
          check.checkFn(),
          new Promise((_, r) => 
            setTimeout(() => r(new Error('Timeout')), check.timeout)
          ),
        ]);
        
        results[check.name] = { status: 'UP', result };
        check.lastResult = result;
      } catch (e) {
        results[check.name] = { status: 'DOWN', error: e.message };
        allHealthy = false;
      }
    }
    
    this.status = {
      healthy: allHealthy,
      checks: results,
      lastCheck: Date.now(),
    };
    
    return this.status;
  }

  /**
   * 获取健康状态
   */
  getStatus() {
    return this.status;
  }

  /**
   * 深度诊断
   */
  async deepDiagnostics() {
    const health = await this.performHealthCheck();
    
    return {
      overall: health.healthy ? 'HEALTHY' : 'DEGRADED',
      checks: health.checks,
      timestamp: health.lastCheck,
      recommendations: this.generateRecommendations(health),
    };
  }

  generateRecommendations(health) {
    const recommendations = [];
    
    for (const [name, check] of Object.entries(health.checks)) {
      if (check.status === 'DOWN') {
        recommendations.push(`检查 ${name} 失败，请调查`);
      }
    }
    
    return recommendations;
  }
}

module.exports = HealthCheckFramework;
