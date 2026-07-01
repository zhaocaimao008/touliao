'use strict';
/**
 * Sentry 错误追踪集成（@sentry/node v10 API）
 * 自动捕获未处理异常、性能问题、以及自定义错误事件
 */

const Sentry = require('@sentry/node');
const config = require('../config');

const SENSITIVE_BODY_KEYS = new Set(['password', 'oldpassword', 'newpassword', 'token', 'secret', 'code', 'totp']);
function redactBody(body) {
  if (!body || typeof body !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SENSITIVE_BODY_KEYS.has(k.toLowerCase()) ? '***' : v;
  }
  return out;
}

/**
 * 初始化 Sentry
 */
function initSentry() {
  if (!config.sentry || !config.sentry.dsn) {
    console.warn('⚠️  Sentry DSN 未配置，错误追踪将被禁用');
    return null;
  }

  // v10 自动内置 HTTP/Express 追踪，无需手动传 integrations
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.nodeEnv || 'development',
    tracesSampleRate: config.sentry.tracesSampleRate || 0.1,
    beforeSend: (event, hint) => {
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.headers?.authorization) delete event.request.headers.authorization;
      if (hint?.originalException) {
        const message = hint.originalException.message || '';
        if (message.includes('404') || message.includes('Not Found')) return null;
      }
      return event;
    },
  });

  console.log('✅ Sentry 错误追踪已启用');
  return Sentry;
}

/**
 * 为 Express 添加 Sentry 中间件
 * @param {Express.Application} app
 */
function attachSentryMiddleware(app) {
  // v10: 请求追踪由 Sentry.init 自动配置，无需手动挂载 Handlers.requestHandler
  void app;
}

/**
 * 为 Express 添加 Sentry 错误处理
 * @param {Express.Application} app
 */
function attachSentryErrorHandler(app) {
  if (!config.sentry || !config.sentry.dsn) return;
  // v10 API：setupExpressErrorHandler 替代 Sentry.Handlers.errorHandler()
  if (typeof Sentry.setupExpressErrorHandler === 'function') {
    Sentry.setupExpressErrorHandler(app);
  }
}

/**
 * 捕获异常
 * @param {Error} error - 异常对象
 * @param {Object} context - 上下文信息
 */
function captureException(error, context = {}) {
  if (!config.sentry || !config.sentry.dsn) {
    console.error('Error:', error);
    return;
  }

  Sentry.withScope((scope) => {
    // 添加上下文信息
    if (context.userId) {
      scope.setUser({ id: context.userId });
    }

    if (context.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }

    if (context.extra) {
      scope.setContext('extra', context.extra);
    }

    // 设置级别
    scope.setLevel(context.level || 'error');

    // 发送异常
    Sentry.captureException(error);
  });
}

/**
 * 捕获消息
 * @param {String} message - 消息内容
 * @param {String} level - 日志级别 (fatal, error, warning, info, debug)
 * @param {Object} extra - 额外信息
 */
function captureMessage(message, level = 'info', extra = {}) {
  if (!config.sentry || !config.sentry.dsn) {
    console.log(`[${level.toUpperCase()}] ${message}`);
    return;
  }

  Sentry.withScope((scope) => {
    Object.entries(extra).forEach(([key, value]) => {
      scope.setContext(key, value);
    });

    Sentry.captureMessage(message, level);
  });
}

/**
 * 设置用户信息
 * @param {Object} user - 用户对象 {id, email, username}
 */
function setUser(user) {
  if (!config.sentry || !config.sentry.dsn) {
    return;
  }

  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.username,
  });
}

/**
 * 清除用户信息（登出时调用）
 */
function clearUser() {
  if (!config.sentry || !config.sentry.dsn) {
    return;
  }

  Sentry.setUser(null);
}

/**
 * 添加面包屑（用户操作追踪）
 * @param {Object} breadcrumb - 面包屑对象
 */
function addBreadcrumb(breadcrumb) {
  if (!config.sentry || !config.sentry.dsn) {
    return;
  }

  Sentry.addBreadcrumb({
    category: breadcrumb.category || 'user-action',
    message: breadcrumb.message || '',
    level: breadcrumb.level || 'info',
    data: breadcrumb.data || {},
    timestamp: Date.now() / 1000,
  });
}

/**
 * 记录性能指标
 * @param {String} name - 操作名称
 * @param {Number} duration - 耗时（毫秒）
 * @param {Object} metadata - 元数据
 */
function capturePerformance(name, duration, metadata = {}) {
  if (!config.sentry || !config.sentry.dsn) {
    return;
  }

  if (duration > 2000) {
    // v10: captureMessage 只接受 2 个参数，extra 通过 captureContext 传入
    Sentry.captureMessage(`Slow operation: ${name} took ${duration}ms`, {
      level: 'warning',
      extra: { operation: name, duration, ...metadata },
    });
  }

  addBreadcrumb({
    category: 'performance',
    message: `${name} completed in ${duration}ms`,
    level: duration > 1000 ? 'warning' : 'info',
    data: { duration, ...metadata },
  });
}

/**
 * Express 中间件：自动捕获未处理的路由错误
 */
function createErrorCatcherMiddleware() {
  return (err, req, res, next) => {
    if (!config.sentry || !config.sentry.dsn) {
      return next(err);
    }

    captureException(err, {
      userId: req.user?.id,
      tags: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
      },
      extra: {
        query: req.query,
        body: redactBody(req.body),
        ip: req.ip,
      },
    });

    next(err);
  };
}

/**
 * 获取 Sentry 实例
 */
function getSentry() {
  return Sentry;
}

module.exports = {
  initSentry,
  attachSentryMiddleware,
  attachSentryErrorHandler,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  addBreadcrumb,
  capturePerformance,
  createErrorCatcherMiddleware,
  getSentry,
};
