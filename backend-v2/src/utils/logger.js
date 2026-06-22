'use strict';
/**
 * 结构化日志 —— Winston + JSON 格式
 * 支持多种日志级别、日志文件轮转、监控集成
 */

const winston = require('winston');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');

// 日志格式
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(info => {
    const { timestamp, level, message, ...meta } = info;
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `[${timestamp}] [${level}] ${message} ${metaStr}`;
  })
);

// 创建 logger 实例
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: jsonFormat,
  defaultMeta: { service: 'vxin-backend' },
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: consoleFormat,
    }),

    // 错误日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),

    // 所有日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
  ],
});

// 快捷方法
function info(message, meta = {}) {
  logger.info(message, meta);
}

function warn(message, meta = {}) {
  logger.warn(message, meta);
}

function error(message, err = null, meta = {}) {
  const errorMeta = {
    ...meta,
    ...(err && { error: err.message, stack: err.stack }),
  };
  logger.error(message, errorMeta);
}

function debug(message, meta = {}) {
  logger.debug(message, meta);
}

// 敏感 query 字段脱敏（避免手机号/验证码/token 等明文落日志）
const SENSITIVE_QUERY_KEYS = ['password', 'oldpassword', 'newpassword', 'token', 'secret', 'code', 'otp', 'totp', 'phone'];
function redactQuery(query) {
  if (!query || !Object.keys(query).length) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(query)) {
    out[k] = SENSITIVE_QUERY_KEYS.includes(k.toLowerCase()) ? '***' : v;
  }
  return out;
}

// API 请求日志中间件
function requestLogger(req, res, next) {
  const start = Date.now();

  // 监听 response finish 事件
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';

    logger[logLevel]('HTTP Request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      query: redactQuery(req.query),
      status: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id,
      ip: req.ip,
    });
  });

  next();
}

// 性能监控日志
function logPerformance(label, duration, meta = {}) {
  const level = duration > 1000 ? 'warn' : 'debug';
  logger[level](`Performance: ${label}`, {
    duration: `${duration}ms`,
    ...meta,
  });
}

module.exports = {
  logger,
  info,
  warn,
  error,
  debug,
  requestLogger,
  logPerformance,
};
