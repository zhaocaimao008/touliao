'use strict';
/**
 * HTTP 辅助
 *   ApiError      —— 带状态码的业务错误，被 errorHandler 统一转成 JSON
 *   asyncHandler  —— 包裹 async controller，自动 catch 并转交 next(err)
 *
 * ⚠ 响应结构保持与旧后端逐字一致（裸 JSON，非信封），
 *   否则会破坏正在运行的 Web/Electron 前端。失败一律 { error: '...' }。
 */
class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code; // 可选机器码；未指定时由 errorHandler 按状态码兜底派生
    this.expose = true;
  }
}

const badRequest   = (msg, code) => new ApiError(400, msg, code);
const unauthorized = (msg, code) => new ApiError(401, msg, code);
const forbidden    = (msg, code) => new ApiError(403, msg, code);
const notFound     = (msg, code) => new ApiError(404, msg, code);
const conflict     = (msg, code) => new ApiError(409, msg, code);

const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, asyncHandler, badRequest, unauthorized, forbidden, notFound, conflict };
