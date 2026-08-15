'use strict';
/**
 * 安全审计日志系统 - 记录所有敏感操作
 * 用于安全审计、异常检测、合规要求
 */
const { db } = require('../db/connection');
const { info, warn, error } = require('./logger');

// 审计事件类型
const AuditEventType = {
  // 认证相关
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILED: 'login_failed',
  LOGOUT: 'logout',
  REGISTER: 'register',
  PASSWORD_CHANGE: 'password_change',
  PASSWORD_RESET: 'password_reset',

  // 权限相关
  PERMISSION_DENIED: 'permission_denied',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',

  // 数据操作
  DATA_CREATE: 'data_create',
  DATA_READ: 'data_read',
  DATA_UPDATE: 'data_update',
  DATA_DELETE: 'data_delete',

  // 敏感操作
  USER_BAN: 'user_ban',
  USER_UNBAN: 'user_unban',
  ADMIN_ACTION: 'admin_action',
  SETTINGS_CHANGE: 'settings_change',

  // 安全事件
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  SQL_INJECTION_ATTEMPT: 'sql_injection_attempt',
  XSS_ATTEMPT: 'xss_attempt',
};

// 风险级别
const RiskLevel = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

class AuditLogger {
  constructor() {
    this.initDatabase();
    this.startCleanupJob();
  }

  initDatabase() {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          risk_level TEXT NOT NULL,
          user_id TEXT,
          ip_address TEXT,
          user_agent TEXT,
          resource_type TEXT,
          resource_id TEXT,
          action TEXT,
          details TEXT,
          status TEXT DEFAULT 'success',
          error_message TEXT,
          request_id TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_risk ON audit_logs(risk_level, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_ip ON audit_logs(ip_address, created_at DESC);
      `);
    } catch (err) {
      error('审计日志表初始化失败', { error: err.message });
    }
  }

  /**
   * 记录审计日志
   */
  log(options) {
    const {
      eventType,
      riskLevel = RiskLevel.LOW,
      userId = null,
      ipAddress = null,
      userAgent = null,
      resourceType = null,
      resourceId = null,
      action = null,
      details = null,
      status = 'success',
      errorMessage = null,
      requestId = null,
    } = options;

    const logEntry = {
      id: require('uuid').v4(),
      event_type: eventType,
      risk_level: riskLevel,
      user_id: userId,
      ip_address: ipAddress,
      user_agent: userAgent ? userAgent.substring(0, 500) : null,
      resource_type: resourceType,
      resource_id: resourceId,
      action: action,
      details: details ? JSON.stringify(details).substring(0, 5000) : null,
      status: status,
      error_message: errorMessage,
      request_id: requestId,
    };

    try {
      const stmt = db.prepare(`
        INSERT INTO audit_logs (
          id, event_type, risk_level, user_id, ip_address, user_agent,
          resource_type, resource_id, action, details, status, error_message, request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        logEntry.id,
        logEntry.event_type,
        logEntry.risk_level,
        logEntry.user_id,
        logEntry.ip_address,
        logEntry.user_agent,
        logEntry.resource_type,
        logEntry.resource_id,
        logEntry.action,
        logEntry.details,
        logEntry.status,
        logEntry.error_message,
        logEntry.request_id
      );

      // 高风险事件额外打印到日志
      if (riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.CRITICAL) {
        warn('高风险审计事件', logEntry);
      }
    } catch (err) {
      error('写入审计日志失败', { error: err.message, logEntry });
    }
  }

  /**
   * 查询审计日志
   */
  query(filters = {}) {
    const {
      userId,
      eventType,
      riskLevel,
      ipAddress,
      startTime,
      endTime,
      limit = 100,
      offset = 0,
    } = filters;

    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }
    if (eventType) {
      sql += ' AND event_type = ?';
      params.push(eventType);
    }
    if (riskLevel) {
      sql += ' AND risk_level = ?';
      params.push(riskLevel);
    }
    if (ipAddress) {
      sql += ' AND ip_address = ?';
      params.push(ipAddress);
    }
    if (startTime) {
      sql += ' AND created_at >= ?';
      params.push(startTime);
    }
    if (endTime) {
      sql += ' AND created_at <= ?';
      params.push(endTime);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    try {
      return db.prepare(sql).all(...params);
    } catch (err) {
      error('查询审计日志失败', { error: err.message });
      return [];
    }
  }

  /**
   * 检测异常行为
   */
  detectAnomalies(userId, timeWindowSeconds = 300) {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - timeWindowSeconds;

      // 检测短时间内的失败登录尝试
      const failedLogins = db.prepare(`
        SELECT COUNT(*) as count FROM audit_logs
        WHERE user_id = ? AND event_type = ? AND created_at > ?
      `).get(userId, AuditEventType.LOGIN_FAILED, cutoff);

      if (failedLogins.count >= 5) {
        this.log({
          eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
          riskLevel: RiskLevel.HIGH,
          userId: userId,
          details: { reason: '短时间内多次登录失败', count: failedLogins.count },
        });
        return { anomaly: true, type: 'multiple_failed_logins', count: failedLogins.count };
      }

      // 检测来自多个IP的访问
      const distinctIPs = db.prepare(`
        SELECT COUNT(DISTINCT ip_address) as count FROM audit_logs
        WHERE user_id = ? AND created_at > ?
      `).get(userId, cutoff);

      if (distinctIPs.count >= 5) {
        this.log({
          eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
          riskLevel: RiskLevel.MEDIUM,
          userId: userId,
          details: { reason: '短时间内来自多个IP访问', count: distinctIPs.count },
        });
        return { anomaly: true, type: 'multiple_ips', count: distinctIPs.count };
      }

      return { anomaly: false };
    } catch (err) {
      error('异常检测失败', { error: err.message });
      return { anomaly: false };
    }
  }

  /**
   * 清理旧日志（保留90天）
   */
  startCleanupJob() {
    setInterval(() => {
      try {
        const cutoff = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60);
        const result = db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(cutoff);
        if (result.changes > 0) {
          info(`审计日志清理：删除 ${result.changes} 条旧记录`);
        }
      } catch (err) {
        error('审计日志清理失败', { error: err.message });
      }
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * 获取统计信息
   */
  getStats(days = 7) {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

      const stats = {
        total: db.prepare('SELECT COUNT(*) as count FROM audit_logs WHERE created_at > ?').get(cutoff).count,
        byRiskLevel: {},
        byEventType: {},
        topUsers: [],
        topIPs: [],
      };

      const riskStats = db.prepare(`
        SELECT risk_level, COUNT(*) as count FROM audit_logs
        WHERE created_at > ? GROUP BY risk_level
      `).all(cutoff);
      riskStats.forEach(row => {
        stats.byRiskLevel[row.risk_level] = row.count;
      });

      const eventStats = db.prepare(`
        SELECT event_type, COUNT(*) as count FROM audit_logs
        WHERE created_at > ? GROUP BY event_type ORDER BY count DESC LIMIT 10
      `).all(cutoff);
      eventStats.forEach(row => {
        stats.byEventType[row.event_type] = row.count;
      });

      stats.topUsers = db.prepare(`
        SELECT user_id, COUNT(*) as count FROM audit_logs
        WHERE created_at > ? AND user_id IS NOT NULL
        GROUP BY user_id ORDER BY count DESC LIMIT 10
      `).all(cutoff);

      stats.topIPs = db.prepare(`
        SELECT ip_address, COUNT(*) as count FROM audit_logs
        WHERE created_at > ? AND ip_address IS NOT NULL
        GROUP BY ip_address ORDER BY count DESC LIMIT 10
      `).all(cutoff);

      return stats;
    } catch (err) {
      error('获取审计统计失败', { error: err.message });
      return null;
    }
  }
}

const auditLogger = new AuditLogger();

function auditMiddleware(eventType, options = {}) {
  return (req, res, next) => {
    const originalSend = res.send;

    res.send = function(data) {
      const statusCode = res.statusCode;
      const status = statusCode < 400 ? 'success' : 'failed';

      auditLogger.log({
        eventType,
        riskLevel: options.riskLevel || RiskLevel.LOW,
        userId: req.userId || req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        resourceType: options.resourceType,
        resourceId: req.params?.id || req.body?.id,
        action: `${req.method} ${req.path}`,
        details: options.getDetails ? options.getDetails(req, res) : null,
        status,
        errorMessage: status === 'failed' ? JSON.stringify(data).substring(0, 500) : null,
        requestId: req.id,
      });

      return originalSend.call(this, data);
    };

    next();
  };
}

// admin.controller.js / admin.service.js 调用的是这个扁平化签名
// (adminId/adminUsername/ip 而非 log() 的 userId/ipAddress)。
// 之前这里没有导出 logAuditEvent，导致解构出 undefined，
// 封禁/解封/重置密码/加撤权限/发币/删号这些操作一调用审计日志就直接抛异常。
function logAuditEvent({
  adminId = null,
  adminUsername = null,
  action = null,
  resourceType = null,
  resourceId = null,
  details = null,
  ip = null,
  userAgent = null,
  riskLevel = RiskLevel.MEDIUM,
} = {}) {
  auditLogger.log({
    eventType: AuditEventType.ADMIN_ACTION,
    riskLevel,
    userId: adminId,
    ipAddress: ip,
    userAgent,
    resourceType,
    resourceId,
    action,
    details: adminUsername ? { ...details, adminUsername } : details,
  });
}

module.exports = {
  auditLogger,
  auditMiddleware,
  logAuditEvent,
  AuditEventType,
  RiskLevel,
};
