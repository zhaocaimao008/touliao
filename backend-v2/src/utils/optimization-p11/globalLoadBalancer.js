/**
 * P11.3: 全球负载均衡
 * 支持智能路由、故障转移、地理位置感知
 */
class GlobalLoadBalancer {
  constructor(config = {}) {
    this.regions = config.regions || [
      { code: 'cn', name: 'China', endpoint: 'https://cn.api.v-xin.app', weight: 0.5, latency: 0 },
      { code: 'us', name: 'US East', endpoint: 'https://us.api.v-xin.app', weight: 0.3, latency: 0 },
      { code: 'eu', name: 'EU Central', endpoint: 'https://eu.api.v-xin.app', weight: 0.2, latency: 0 },
    ];
    this.healthChecks = new Map();
    this.stats = { routed: 0, failovers: 0 };
  }

  /**
   * 根据用户地理位置和负载选择最优区域
   */
  selectOptimalRegion(userGeo, currentLoad = {}) {
    let selectedRegion = this.regions[0];
    let bestScore = -Infinity;

    for (const region of this.regions) {
      const health = this.healthChecks.get(region.code) || { status: 'healthy', load: 0 };
      
      // 地理距离权重 (30%)
      const geoScore = this.calculateGeoDistance(userGeo, region.code);
      
      // 区域权重 (40%)
      const weightScore = region.weight * 100;
      
      // 加权负载 (30%)
      const loadScore = 100 - (health.load * 100);
      
      const totalScore = geoScore * 0.3 + weightScore * 0.4 + loadScore * 0.3;
      
      if (totalScore > bestScore) {
        bestScore = totalScore;
        selectedRegion = region;
      }
    }

    this.stats.routed++;
    return selectedRegion;
  }

  /**
   * 故障转移
   */
  async failover(failedRegion) {
    const healthyRegions = this.regions.filter(
      r => r.code !== failedRegion && this.isHealthy(r.code)
    );
    
    if (healthyRegions.length > 0) {
      this.stats.failovers++;
      return healthyRegions[0];
    }
    
    throw new Error('所有区域均不可用');
  }

  /**
   * 健康检查
   */
  async healthCheck(regionCode) {
    const region = this.regions.find(r => r.code === regionCode);
    if (!region) return false;

    try {
      // 模拟健康检查
      const startTime = Date.now();
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
      const latency = Date.now() - startTime;

      this.healthChecks.set(regionCode, {
        status: 'healthy',
        latency,
        load: Math.random() * 0.8,
        checked: Date.now(),
      });

      region.latency = latency;
      return true;
    } catch (e) {
      this.healthChecks.set(regionCode, { status: 'unhealthy', error: e.message });
      return false;
    }
  }

  isHealthy(regionCode) {
    const health = this.healthChecks.get(regionCode);
    return health && health.status === 'healthy';
  }

  calculateGeoDistance(userGeo, regionCode) {
    // 简化的地理距离计算
    const distances = {
      cn: userGeo.country === 'CN' ? 100 : 20,
      us: userGeo.country === 'US' ? 100 : 30,
      eu: userGeo.country && ['DE', 'FR', 'UK'].includes(userGeo.country) ? 100 : 40,
    };
    return distances[regionCode] || 0;
  }

  getStats() {
    return {
      ...this.stats,
      regionHealth: Object.fromEntries(this.healthChecks),
    };
  }
}

module.exports = GlobalLoadBalancer;
