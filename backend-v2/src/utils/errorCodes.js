'use strict';
/**
 * 机器可读错误码（P0-3，向后兼容引入）。
 *
 * 响应同时输出 `error`（中文字符串，旧 Web/Electron 前端继续读）与
 * `error_code`（稳定机器码，新前端按它做分支，可国际化）。
 *
 * 未显式指定 code 的错误，由 errorHandler 按 HTTP 状态码兜底派生，
 * 因此即便存量代码不传 code，也能零成本获得稳定的 error_code。
 *
 * 需要细分语义时（如「已收藏」对比一般冲突），在抛错时显式传第二参 code：
 *   throw conflict('已收藏', 'COLLECTION_DUPLICATE')
 */
const STATUS_CODE = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

function codeForStatus(status) {
  return STATUS_CODE[status] || (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
}

module.exports = { STATUS_CODE, codeForStatus };
