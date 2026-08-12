'use strict';
/**
 * 输入验证和清洗工具 - 防止XSS、SQL注入、恶意输入
 */
const { auditLogger, AuditEventType, RiskLevel } = require('./auditLogger');

// XSS黑名单模式
const XSS_PATTERNS = [
  /<script[^>]*>.*?<\/script>/gi,
  /<iframe[^>]*>.*?<\/iframe>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi, // onclick, onerror等事件处理器
  /<object[^>]*>.*?<\/object>/gi,
  /<embed[^>]*>/gi,
  /eval\(/gi,
  /expression\(/gi,
];

// SQL注入黑名单模式
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b.*\b(FROM|INTO|WHERE|TABLE|DATABASE)\b)/gi,
  /(UNION\s+SELECT)/gi,
  /(;|\-\-|\/\*|\*\/)/g,
  /(\bOR\b.*=.*)/gi,
  /(\bAND\b.*=.*)/gi,
  /'.*--/gi,
  /'.*\*/gi,
];

// 路径遍历攻击模式
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//g,
  /\.\.\\g,
  /%2e%2e%2f/gi,
  /%2e%2e\\/gi,
];

class InputValidator {
  /**
   * 清洗HTML，移除潜在XSS代码
   */
  sanitizeHTML(input) {
    if (typeof input !== 'string') return input;
    
    let sanitized = input;
    let detected = false;

    for (const pattern of XSS_PATTERNS) {
      if (pattern.test(sanitized)) {
        detected = true;
        sanitized = sanitized.replace(pattern, '');
      }
    }

    if (detected) {
      auditLogger.log({
        eventType: AuditEventType.XSS_ATTEMPT,
        riskLevel: RiskLevel.HIGH,
        details: { original: input.substring(0, 200), sanitized: sanitized.substring(0, 200) },
      });
    }

    // HTML实体编码
    return sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * 检测SQL注入
   */
  detectSQLInjection(input) {
    if (typeof input !== 'string') return false;

    for (const pattern of SQL_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        auditLogger.log({
          eventType: AuditEventType.SQL_INJECTION_ATTEMPT,
          riskLevel: RiskLevel.CRITICAL,
          details: { input: input.substring(0, 500) },
        });
        return true;
      }
    }

    return false;
  }

  /**
   * 检测路径遍历攻击
   */
  detectPathTraversal(input) {
    if (typeof input !== 'string') return false;

    for (const pattern of PATH_TRAVERSAL_PATTERNS) {
      if (pattern.test(input)) {
        auditLogger.log({
          eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
          riskLevel: RiskLevel.HIGH,
          details: { type: 'path_traversal', input: input.substring(0, 200) },
        });
        return true;
      }
    }

    return false;
  }

  /**
   * 验证邮箱格式
   */
  isValidEmail(email) {
    if (typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * 验证手机号（中国大陆）
   */
  isValidPhone(phone) {
    if (typeof phone !== 'string') return false;
    const phoneRegex = /^1[3-9]\d{9}$/;
    return phoneRegex.test(phone);
  }

  /**
   * 验证用户名（字母数字下划线，3-20位）
   */
  isValidUsername(username) {
    if (typeof username !== 'string') return false;
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    return usernameRegex.test(username);
  }

  /**
   * 验证密码强度
   * 要求：至少8位，包含大小写字母、数字
   */
  isStrongPassword(password) {
    if (typeof password !== 'string') return { valid: false, reason: '密码必须是字符串' };
    
    if (password.length < 8) {
      return { valid: false, reason: '密码至少需要8位' };
    }
    
    if (password.length > 128) {
      return { valid: false, reason: '密码不能超过128位' };
    }

    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);

    if (!hasUpperCase) {
      return { valid: false, reason: '密码必须包含大写字母' };
    }
    if (!hasLowerCase) {
      return { valid: false, reason: '密码必须包含小写字母' };
    }
    if (!hasNumber) {
      return { valid: false, reason: '密码必须包含数字' };
    }

    // 检查常见弱密码
    const weakPasswords = [
      'password', '12345678', 'abcd1234', 'qwerty123', 
      'password123', 'admin123', 'user1234'
    ];
    if (weakPasswords.some(weak => password.toLowerCase().includes(weak))) {
      return { valid: false, reason: '密码过于简单，请使用更复杂的密码' };
    }

    return { valid: true };
  }

  /**
   * 清洗文件名，防止路径遍历
   */
  sanitizeFilename(filename) {
    if (typeof filename !== 'string') return '';
    
    // 移除路径分隔符和特殊字符
    let sanitized = filename
      .replace(/[\/\\]/g, '')
      .replace(/\.\./g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');

    // 限制长度
    if (sanitized.length > 255) {
      sanitized = sanitized.substring(0, 255);
    }

    return sanitized;
  }

  /**
   * 验证URL
   */
  isValidURL(url) {
    if (typeof url !== 'string') return false;
    
    try {
      const parsed = new URL(url);
      // 只允许 http 和 https
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /**
   * 清洗对象（递归处理所有字符串字段）
   */
  sanitizeObject(obj, options = {}) {
    const { skipFields = [], onlyFields = null } = options;

    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item, options));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // 跳过指定字段
      if (skipFields.includes(key)) {
        sanitized[key] = value;
        continue;
      }

      // 只处理指定字段
      if (onlyFields && !onlyFields.includes(key)) {
        sanitized[key] = value;
        continue;
      }

      if (typeof value === 'string') {
        sanitized[key] = this.sanitizeHTML(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value, options);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * 验证整数范围
   */
  isValidInteger(value, min = -Infinity, max = Infinity) {
    const num = parseInt(value, 10);
    return !isNaN(num) && num >= min && num <= max;
  }

  /**
   * 验证字符串长度
   */
  isValidLength(str, minLength = 0, maxLength = Infinity) {
    if (typeof str !== 'string') return false;
    return str.length >= minLength && str.length <= maxLength;
  }

  /**
   * 验证枚举值
   */
  isValidEnum(value, allowedValues) {
    return allowedValues.includes(value);
  }
}

const validator = new InputValidator();

/**
 * Express 中间件 - 验证请求体
 */
function validateRequest(schema) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      // 必填验证
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} 是必填项`);
        continue;
      }

      // 如果不是必填且值为空，跳过其他验证
      if (!rules.required && !value) {
        continue;
      }

      // 类型验证
      if (rules.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== rules.type) {
          errors.push(`${field} 必须是 ${rules.type} 类型`);
          continue;
        }
      }

      // 字符串长度验证
      if (rules.minLength && !validator.isValidLength(value, rules.minLength)) {
        errors.push(`${field} 长度不能少于 ${rules.minLength}`);
      }
      if (rules.maxLength && !validator.isValidLength(value, 0, rules.maxLength)) {
        errors.push(`${field} 长度不能超过 ${rules.maxLength}`);
      }

      // 整数范围验证
      if (rules.min !== undefined || rules.max !== undefined) {
        if (!validator.isValidInteger(value, rules.min, rules.max)) {
          errors.push(`${field} 必须在 ${rules.min || '-∞'} 到 ${rules.max || '+∞'} 之间`);
        }
      }

      // 枚举值验证
      if (rules.enum && !validator.isValidEnum(value, rules.enum)) {
        errors.push(`${field} 必须是以下值之一: ${rules.enum.join(', ')}`);
      }

      // 邮箱验证
      if (rules.email && !validator.isValidEmail(value)) {
        errors.push(`${field} 必须是有效的邮箱地址`);
      }

      // 手机号验证
      if (rules.phone && !validator.isValidPhone(value)) {
        errors.push(`${field} 必须是有效的手机号`);
      }

      // 密码强度验证
      if (rules.strongPassword) {
        const result = validator.isStrongPassword(value);
        if (!result.valid) {
          errors.push(`${field}: ${result.reason}`);
        }
      }

      // URL验证
      if (rules.url && !validator.isValidURL(value)) {
        errors.push(`${field} 必须是有效的URL`);
      }

      // SQL注入检测
      if (rules.checkSQLInjection && validator.detectSQLInjection(value)) {
        errors.push(`${field} 包含非法字符`);
      }

      // 路径遍历检测
      if (rules.checkPathTraversal && validator.detectPathTraversal(value)) {
        errors.push(`${field} 包含非法字符`);
      }

      // 自定义验证函数
      if (rules.custom) {
        const customError = rules.custom(value, req);
        if (customError) {
          errors.push(customError);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: '输入验证失败', details: errors });
    }

    // 清洗所有字符串字段
    req.body = validator.sanitizeObject(req.body, {
      skipFields: schema.skipSanitize || [],
    });

    next();
  };
}

module.exports = {
  validator,
  validateRequest,
  InputValidator,
};
