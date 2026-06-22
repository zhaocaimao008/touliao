'use strict';
/**
 * 统一错误处理（注册在所有路由之后）。
 * ApiError → 对应状态码 + { error }；其余未预期错误 → 500，日志保留堆栈。
 * 响应结构与旧后端一致：失败永远是 { error: '...' }。
 */
const { ApiError } = require('../utils/http');
const { codeForStatus } = require('../utils/errorCodes');
const { error: logError } = require('../utils/logger');

// 404 兜底
function notFoundHandler(req, res) {
  res.status(404).json({ error: '接口不存在', error_code: 'NOT_FOUND' });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // 响应双写：error(中文,旧前端) + error_code(机器码,新前端)，向后兼容
  if (err instanceof ApiError) {
    const body = { error: err.message, error_code: err.code || codeForStatus(err.status) };
    // 红包领取冲突等场景需透传额外字段（如 amount）
    if (err.amount !== undefined) body.amount = err.amount;
    return res.status(err.status).json(body);
  }
  // multer / 业务 throw 的普通 Error：若带 status 用之，否则 500
  if (err && err.status && err.message) {
    // multer 的 err.code（如 LIMIT_FILE_SIZE）本身即可读机器码，优先采用
    const code = typeof err.code === 'string' ? err.code : codeForStatus(err.status);
    return res.status(err.status).json({ error: err.message, error_code: code });
  }
  // 未预期错误 → 500：结构化记录堆栈到 winston（error.log + combined.log），不再走 console
  logError('Unhandled error', err, { method: req.method, url: req.originalUrl, userId: req.user?.id, ip: req.ip });
  res.status(500).json({ error: '服务器内部错误', error_code: 'INTERNAL_ERROR' });
}

module.exports = { notFoundHandler, errorHandler };
