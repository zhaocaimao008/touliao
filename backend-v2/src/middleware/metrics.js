'use strict';
/**
 * Prometheus 指标中间件
 * 导出应用级别的业务指标
 */

const client = require('prom-client');

// 创建注册表
const register = new client.Registry();

// 默认指标（CPU、内存等）
client.collectDefaultMetrics({ register });

// HTTP 请求计数器
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

// HTTP 请求延迟直方图
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// 在线用户数
const onlineUsersGauge = new client.Gauge({
  name: 'online_users_total',
  help: 'Total number of online users',
  registers: [register],
});

// 消息发送计数器
const messagesTotal = new client.Counter({
  name: 'messages_total',
  help: 'Total number of messages sent',
  labelNames: ['type'],
  registers: [register],
});

// 消息发送失败计数器
const messagesFailedTotal = new client.Counter({
  name: 'messages_failed_total',
  help: 'Total number of failed messages',
  labelNames: ['type', 'reason'],
  registers: [register],
});

// 数据库查询延迟
const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['query_type'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

// WebSocket 连接数
const websocketConnectionsGauge = new client.Gauge({
  name: 'websocket_connections_total',
  help: 'Total number of WebSocket connections',
  registers: [register],
});

// Redis 缓存命中率
const cacheHitsTotal = new client.Counter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['cache_type'],
  registers: [register],
});

const cacheMissesTotal = new client.Counter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['cache_type'],
  registers: [register],
});

/**
 * HTTP 指标中间件
 */
function metricsMiddleware(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const path = req.route?.path || req.path || 'unknown';
    const method = req.method;
    const status = res.statusCode;
    
    httpRequestsTotal.inc({ method, path, status });
    httpRequestDuration.observe({ method, path, status }, duration);
  });
  
  next();
}

/**
 * 导出指标端点
 */
async function metricsEndpoint(req, res) {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (err) {
    res.status(500).end(err.message);
  }
}

/**
 * 更新在线用户数
 */
function updateOnlineUsers(count) {
  onlineUsersGauge.set(count);
}

/**
 * 记录消息发送
 */
function recordMessage(type = 'text') {
  messagesTotal.inc({ type });
}

/**
 * 记录消息失败
 */
function recordMessageFailure(type = 'text', reason = 'unknown') {
  messagesFailedTotal.inc({ type, reason });
}

/**
 * 记录数据库查询时间
 */
function recordDbQuery(queryType, duration) {
  dbQueryDuration.observe({ query_type: queryType }, duration);
}

/**
 * 更新 WebSocket 连接数
 */
function updateWebSocketConnections(count) {
  websocketConnectionsGauge.set(count);
}

/**
 * 记录缓存命中
 */
function recordCacheHit(cacheType) {
  cacheHitsTotal.inc({ cache_type: cacheType });
}

/**
 * 记录缓存未命中
 */
function recordCacheMiss(cacheType) {
  cacheMissesTotal.inc({ cache_type: cacheType });
}

module.exports = {
  register,
  metricsMiddleware,
  metricsEndpoint,
  updateOnlineUsers,
  recordMessage,
  recordMessageFailure,
  recordDbQuery,
  updateWebSocketConnections,
  recordCacheHit,
  recordCacheMiss,
};
