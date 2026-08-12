/**
 * P10.1: SQL注入防护 & 参数化查询审计
 * 防护 OWASP Top 1 漏洞
 */

class SQLInjectionDefense {
  constructor() {
    this.auditLog = [];
    this.suspiciousPatterns = [
      /('|("|`).*?(or|and).*?(=|<|>))/gi,
      /(union|select|insert|update|delete|drop|create|alter)/gi,
      /(;|--|\/\*|\*\/|xp_|sp_)/gi,
    ];
  }

  /**
   * 验证参数化查询
   */
  validateParameterizedQuery(query, params) {
    const issues = [];
    
    // 检查1: 查询中不应有直接字符串拼接
    if (query.includes('+') || query.includes('`${')) {
      issues.push({
        severity: 'HIGH',
        message: '检测到字符串拼接，应使用参数化查询',
        query: query.substring(0, 100),
      });
    }
    
    // 检查2: 参数数量匹配
    const placeholders = (query.match(/\?/g) || []).length;
    if (placeholders !== (params || []).length) {
      issues.push({
        severity: 'HIGH',
        message: `参数数量不匹配: 期望 ${placeholders}, 得到 ${(params || []).length}`,
      });
    }
    
    // 检查3: 参数值检查
    (params || []).forEach((param, idx) => {
      if (typeof param === 'string' && this.containsSuspiciousPattern(param)) {
        issues.push({
          severity: 'MEDIUM',
          message: `参数 ${idx} 包含可疑SQL关键字`,
          param: param.substring(0, 50),
        });
      }
    });
    
    return issues;
  }

  /**
   * 检查可疑SQL模式
   */
  containsSuspiciousPattern(value) {
    return this.suspiciousPatterns.some(pattern => pattern.test(value));
  }

  /**
   * 安全构建查询
   */
  buildSafeQuery(template, params = {}) {
    let query = template;
    let paramIndex = 0;
    
    // 替换命名参数
    query = query.replace(/:(\w+)/g, (match, key) => {
      if (!(key in params)) {
        throw new Error(`缺失参数: ${key}`);
      }
      return '?';
    });
    
    const paramValues = Object.values(params);
    
    // 验证
    const issues = this.validateParameterizedQuery(query, paramValues);
    if (issues.length > 0) {
      this.logAudit({
        type: 'POTENTIAL_SQL_INJECTION',
        issues,
        timestamp: Date.now(),
      });
    }
    
    return { query, params: paramValues };
  }

  /**
   * 审计日志
   */
  logAudit(entry) {
    this.auditLog.push({
      ...entry,
      timestamp: Date.now(),
    });
    
    // 高风险立即告警
    if (entry.issues?.some(i => i.severity === 'HIGH')) {
      console.error('[SQL INJECTION ALERT]', entry);
    }
  }

  /**
   * 获取审计报告
   */
  getAuditReport() {
    return {
      totalChecks: this.auditLog.length,
      highRiskCount: this.auditLog.filter(l => 
        l.issues?.some(i => i.severity === 'HIGH')
      ).length,
      mediumRiskCount: this.auditLog.filter(l => 
        l.issues?.some(i => i.severity === 'MEDIUM')
      ).length,
    };
  }
}

module.exports = SQLInjectionDefense;
