'use strict';
/**
 * 后端数据脱敏工具
 * 用于管理后台 API 响应和日志输出时保护敏感信息
 */

/**
 * 手机号脱敏
 * @param {string} phone - 手机号
 * @returns {string} 脱敏后的手机号，如 138****0000
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return phone;
  if (phone.length < 11) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

/**
 * 邮箱脱敏
 * @param {string} email - 邮箱地址
 * @returns {string} 脱敏后的邮箱，如 ab***c@example.com
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return email;
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const [local, domain] = parts;
  if (local.length <= 3) return email;
  return local.slice(0, 2) + '***' + local.slice(-1) + '@' + domain;
}

/**
 * 身份证号脱敏
 * @param {string} idCard - 身份证号
 * @returns {string} 脱敏后的身份证号，如 110101********1234
 */
function maskIdCard(idCard) {
  if (!idCard || typeof idCard !== 'string') return idCard;
  if (idCard.length < 18) return idCard;
  return idCard.slice(0, 6) + '********' + idCard.slice(-4);
}

/**
 * 消息内容缩略
 * @param {string} content - 消息内容
 * @param {number} maxLen - 最大长度，默认 20
 * @returns {string} 缩略后的内容
 */
function maskContent(content, maxLen = 20) {
  if (!content || typeof content !== 'string') return '';
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + '...';
}

/**
 * IP 地址部分脱敏
 * @param {string} ip - IP 地址
 * @returns {string} 脱敏后的 IP，如 192.168.***.***
 */
function maskIp(ip) {
  if (!ip || typeof ip !== 'string') return ip;
  const parts = ip.split('.');
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.***.***`;
}

/**
 * 通用对象脱敏
 * @param {Object} obj - 数据对象
 * @param {Array<string>} additionalFields - 额外需要脱敏的字段
 * @returns {Object} 脱敏后的对象
 */
function maskObject(obj, additionalFields = []) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const masked = Array.isArray(obj) ? [...obj] : { ...obj };
  const sensitiveFields = ['password', 'token', 'secret', 'accessToken', 'refreshToken', ...additionalFields];
  
  for (const key in masked) {
    // 完全隐藏的字段
    if (sensitiveFields.includes(key)) {
      masked[key] = '[REDACTED]';
      continue;
    }
    
    // 特定类型脱敏
    if (key === 'phone' || key.includes('Phone')) {
      masked[key] = maskPhone(masked[key]);
    } else if (key === 'email') {
      masked[key] = maskEmail(masked[key]);
    } else if (key === 'idCard' || key === 'id_card') {
      masked[key] = maskIdCard(masked[key]);
    } else if (key === 'content' || key === 'message') {
      // 消息内容不自动缩略，由调用方决定
      // masked[key] = maskContent(masked[key]);
    } else if (key === 'ip') {
      masked[key] = maskIp(masked[key]);
    }
    
    // 递归处理嵌套对象
    if (masked[key] && typeof masked[key] === 'object') {
      masked[key] = maskObject(masked[key], additionalFields);
    }
  }
  
  return masked;
}

/**
 * Express 中间件：自动脱敏响应数据
 * @param {Object} options - 配置选项
 * @returns {Function} Express 中间件
 */
function maskResponseMiddleware(options = {}) {
  const { enabled = true, fields = [] } = options;
  
  return (req, res, next) => {
    if (!enabled) return next();
    
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      const masked = maskObject(data, fields);
      return originalJson(masked);
    };
    
    next();
  };
}

/**
 * 安全日志输出
 * @param {string} level - 日志级别 (info, warn, error)
 * @param {string} message - 日志消息
 * @param {Object} data - 附加数据
 */
function safeLog(level, message, data = {}) {
  const masked = maskObject(data);
  const timestamp = new Date().toISOString();
  console[level](`[${timestamp}] [${level.toUpperCase()}] ${message}`, masked);
}

module.exports = {
  maskPhone,
  maskEmail,
  maskIdCard,
  maskContent,
  maskIp,
  maskObject,
  maskResponseMiddleware,
  safeLog,
};
