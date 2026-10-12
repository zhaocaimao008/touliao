'use strict';
/**
 * 结构化日志 —— Winston + JSON 格式
 * 支持多种日志级别、日志文件轮转、监控集成
 */

const winston = require('winston');
const path = require('path');
const { redact } = require('./redact');

const logDir = process.env.NODE_ENV === 'test' && process.env.LOG_DIR
  ? process.env.LOG_DIR : path.join(__dirname, '../../logs');

// 日志格式
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format(info => Object.assign(info, redact(info)))(),
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
  defaultMeta: { service: 'touliao-backend' },
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
// 健康探针路径：pm2/nginx/外部 uptime 每 30 秒打一次，成功时没有任何信息量，
// 只会稀释日志（真出事时要在成千上万行 200 里翻）。失败（>=400）仍照常记录，
// 因为那才是探针唯一值得看的时刻。
const HEALTH_PROBE_PATHS = new Set(['/health', '/healthz', '/api/health', '/ping']);

// 2026-10-12 日志降噪：out.log 一天 17MB，其中 1320 万字节是逐请求的 info 行（2xx/3xx），155 万是 warn（多为
// 客户端带过期 token 的 401）。新级别：
//   5xx 或 慢请求（> SLOW_REQUEST_MS，默认 1000ms） → warn（保留，真正要看的）
//   401                                          → debug（预期内：未登录/过期 token，量大无信息量）
//   其他 4xx                                      → info
//   2xx/3xx                                      → debug
// 另每 ACCESS_SUMMARY_MS（默认 5 分钟）输出一条 info 汇总：各状态段计数、慢请求数、4xx/5xx 最多的路径（ID 归一化）。
const SLOW_REQUEST_MS = parseInt(process.env.SLOW_REQUEST_MS || '1000', 10);
const ACCESS_SUMMARY_MS = parseInt(process.env.ACCESS_SUMMARY_MS || String(5 * 60 * 1000), 10);
const ID_SEG = /\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{24,})(?=\/|$)/gi;
let summary = null;
function resetSummary() { summary = { total: 0, s2: 0, s3: 0, s4: 0, s401: 0, s5: 0, slow: 0, errPaths: new Map() }; }
resetSummary();
function flushSummary() {
  if (summary.total > 0) {
    const top = [...summary.errPaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, n]) => `${k}×${n}`);
    logger.info('HTTP summary', {
      windowSec: Math.round(ACCESS_SUMMARY_MS / 1000), total: summary.total,
      '2xx': summary.s2, '3xx': summary.s3, '4xx': summary.s4, '401': summary.s401, '5xx': summary.s5,
      slow: summary.slow, topErrors: top.length ? top : undefined,
    });
  }
  resetSummary();
}
if (process.env.NODE_ENV !== 'test' && ACCESS_SUMMARY_MS > 0) setInterval(flushSummary, ACCESS_SUMMARY_MS).unref();

function requestLevel(status, duration) {
  if (status >= 500 || duration > SLOW_REQUEST_MS) return 'warn';
  if (status === 401) return 'debug';
  if (status >= 400) return 'info';
  return 'debug';
}

function requestLogger(req, res, next) {
  const start = Date.now();

  // 监听 response finish 事件
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (res.statusCode < 400 && HEALTH_PROBE_PATHS.has(req.path)) return;
    const st = res.statusCode;
    summary.total++;
    if (st >= 500) summary.s5++; else if (st >= 400) { summary.s4++; if (st === 401) summary.s401++; }
    else if (st >= 300) summary.s3++; else summary.s2++;
    if (duration > SLOW_REQUEST_MS) summary.slow++;
    if (st >= 400 && st !== 401) {
      const key = `${st} ${req.method} ${req.originalUrl.split('?')[0].replace(ID_SEG, '/:id')}`;
      if (summary.errPaths.size < 500 || summary.errPaths.has(key)) summary.errPaths.set(key, (summary.errPaths.get(key) || 0) + 1);
    }
    const logLevel = requestLevel(st, duration);
    if (!logger.isLevelEnabled(logLevel)) return;

    logger[logLevel]('HTTP Request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
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
  requestLevel,
  flushSummary,
  logPerformance,
};
