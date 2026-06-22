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

/* ── 成功响应辅助（P2）──────────────────────────────────────────────
 * ⚠ 仅用于**新接口**。存量端点的裸 JSON / {success:true} 契约保持不动，
 *   不得用这些 helper 回填改写，否则破坏在线 Web/Electron 前端（见上方说明）。
 */

// 201 Created：创建成功，响应体携带新资源；可选 Location 指向新资源 URL
const created = (res, payload, location) => {
  if (location) res.set('Location', location);
  return res.status(201).json(payload);
};

// 204 No Content：删除 / 无返回体场景；按规范不得携带 body
const noContent = res => res.status(204).end();

/**
 * 列表分页元信息——新列表接口统一返回 { items, total, hasMore }。
 *
 *   paginated(rows, { total, limit, offset })
 *
 * - total 已知（如单独 COUNT(*)）：total 原样回传，hasMore = offset+本页条数 < total。
 * - total 未知：total 兜底为本页累计已知数（offset+本页条数）；
 *   hasMore 用「是否拿满一页」启发式判定（本页条数 >= limit）；
 *   连 limit 都没有时无从判断，保守置 false。
 */
const paginated = (items, { total, limit, offset = 0 } = {}) => {
  const list = Array.isArray(items) ? items : [];
  const off = Math.max(Number(offset) || 0, 0);
  const lim = limit != null ? Math.max(Number(limit) || 0, 0) : undefined;
  const known = Number.isFinite(total);
  let hasMore;
  if (known) hasMore = off + list.length < total;
  else if (lim) hasMore = list.length >= lim;
  else hasMore = false;
  return { items: list, total: known ? total : off + list.length, hasMore };
};

module.exports = {
  ApiError, asyncHandler,
  badRequest, unauthorized, forbidden, notFound, conflict,
  created, noContent, paginated,
};
