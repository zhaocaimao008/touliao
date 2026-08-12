/**
 * P14.4: 成本优化系统
 * 存储优化 + 计算资源管理
 */
class CostOptimizer {
  constructor() {
    this.resourceUsage = new Map();
    this.costMetrics = { storage: 0, compute: 0, bandwidth: 0, total: 0 };
    this.optimizationRules = [];
  }

  /**
   * 存储成本优化
   */
  optimizeStorage(dataSize, accessFrequency) {
    // 热数据存储在快速存储（SSD）
    if (accessFrequency > 1000) {
      return { storage: 'SSD', costPerGB: 0.1, estimated: dataSize * 0.1 };
    }
    // 温数据存储在标准存储
    if (accessFrequency > 100) {
      return { storage: 'Standard', costPerGB: 0.023, estimated: dataSize * 0.023 };
    }
    // 冷数据存储在对象存储
    return { storage: 'Archive', costPerGB: 0.004, estimated: dataSize * 0.004 };
  }

  /**
   * 计算资源精细化管理
   */
  optimizeCompute(workloadPattern) {
    const recommendations = [];

    // 自动扩缩容
    if (workloadPattern.peakHour) {
      recommendations.push({
        action: '自动扩容',
        timing: workloadPattern.peakHour,
        instances: Math.ceil(workloadPattern.avgLoad * 1.2),
        savingPotential: '15-20%',
      });
    }

    // 预留实例推荐
    if (workloadPattern.baselineLoad > 60) {
      recommendations.push({
        action: '购买预留实例',
        percentage: Math.floor(workloadPattern.baselineLoad / 100 * 100),
        savingPotential: '40%',
      });
    }

    // Spot 实例混合
    if (workloadPattern.variability > 0.3) {
      recommendations.push({
        action: '混合 Spot 实例',
        proportion: '30-40%',
        savingPotential: '60-70%',
      });
    }

    return recommendations;
  }

  /**
   * 带宽成本优化
   */
  optimizeBandwidth(transferPattern) {
    const optimizations = [];

    // CDN 加速
    if (transferPattern.externalTransfer > 100) {
      optimizations.push({
        action: 'CDN 加速',
        reduction: '70-80%',
        cost: transferPattern.externalTransfer * 0.08 * 0.3,
      });
    }

    // 数据压缩
    optimizations.push({
      action: 'Gzip/Brotli 压缩',
      reduction: '60-70%',
      cost: transferPattern.totalBandwidth * 0.08 * 0.4,
    });

    // 智能缓存
    optimizations.push({
      action: '多层缓存',
      reduction: '40-50%',
      cost: transferPattern.totalBandwidth * 0.08 * 0.5,
    });

    return optimizations;
  }

  /**
   * 成本预测和告警
   */
  predictCost(currentSpending, trend) {
    const projectedMonthly = currentSpending * (1 + trend);
    const projectedAnnual = projectedMonthly * 12;

    return {
      currentMonthly: currentSpending,
      projectedMonthly: projectedMonthly.toFixed(2),
      projectedAnnual: projectedAnnual.toFixed(2),
      alert: projectedMonthly > currentSpending * 1.1 ? 'COST_SPIKE_WARNING' : 'NORMAL',
    };
  }

  /**
   * 成本优化报告
   */
  generateOptimizationReport() {
    return {
      storageOptimization: this.optimizeStorage(1000, 500),
      computeOptimization: this.optimizeCompute({ peakHour: '18:00', avgLoad: 70, baselineLoad: 50, variability: 0.4 }),
      bandwidthOptimization: this.optimizeBandwidth({ externalTransfer: 200, totalBandwidth: 500 }),
      costProjection: this.predictCost(10000, 0.05),
      estimatedSavings: '30-40% 月度成本',
    };
  }
}

module.exports = CostOptimizer;
