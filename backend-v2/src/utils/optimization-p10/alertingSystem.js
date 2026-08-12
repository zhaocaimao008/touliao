/**
 * P10.4: 智能告警系统
 */
class AlertingSystem {
  constructor() {
    this.rules = [];
    this.alerts = [];
    this.alertHistory = [];
  }

  /**
   * 定义告警规则
   */
  defineRule(name, condition, severity = 'MEDIUM') {
    this.rules.push({
      name,
      condition,
      severity,
      enabled: true,
      createdAt: Date.now(),
    });
  }

  /**
   * 评估指标
   */
  evaluateMetrics(metric) {
    const triggered = [];
    
    this.rules.forEach(rule => {
      if (!rule.enabled) return;
      
      if (rule.condition(metric)) {
        triggered.push({
          rule: rule.name,
          severity: rule.severity,
          metric,
          timestamp: Date.now(),
        });
      }
    });
    
    return triggered;
  }

  /**
   * 告警聚合 (去重)
   */
  aggregateAlerts(maxAge = 300000) {
    const now = Date.now();
    const recent = this.alerts.filter(a => now - a.timestamp < maxAge);
    
    const grouped = {};
    recent.forEach(alert => {
      const key = alert.rule;
      if (!grouped[key]) {
        grouped[key] = {
          count: 0,
          lastOccurrence: 0,
          severity: alert.severity,
        };
      }
      grouped[key].count++;
      grouped[key].lastOccurrence = alert.timestamp;
    });
    
    return grouped;
  }

  /**
   * 告警升级
   */
  escalateAlert(alertName, failureThreshold = 3) {
    const aggregated = this.aggregateAlerts();
    if (aggregated[alertName]?.count >= failureThreshold) {
      return {
        escalated: true,
        level: 'CRITICAL',
        message: `Alert '${alertName}' triggered ${aggregated[alertName].count} times`,
      };
    }
    
    return { escalated: false };
  }
}

module.exports = AlertingSystem;
