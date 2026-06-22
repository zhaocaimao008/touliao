'use strict';
/**
 * 请求 ID（P2）：为每个请求分配/透传 requestId，贯穿日志与错误响应，便于串联单次请求的多条日志、
 * 以及用户报障时凭 X-Request-Id 定位。优先沿用上游（Nginx / 客户端）传入的 X-Request-Id。
 */
const { v4: uuidv4 } = require('uuid');

module.exports = function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = (typeof incoming === 'string' && incoming && incoming.length <= 100) ? incoming : uuidv4();
  res.setHeader('X-Request-Id', req.id);
  next();
};
