'use strict';
/**
 * 鉴权中间件：仅从 httpOnly Cookie 读取 JWT，不接受 Authorization header
 * （Token 从不进响应体/localStorage，消除 XSS 窃取风险）。
 * 校验通过后顺带下发 CSRF 双提交 Cookie + header，供前端回传比对。
 *
 * 性能优化：banned / password_changed_at 通过 userStatusCache 进程内缓存（30s TTL），
 * 命中时跳过 DB SELECT，大幅降低每请求的 SQLite 读压力。
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { csrfCookieOptions } = require('../utils/cookies');
const { isBlacklisted } = require('../utils/tokenBlacklist');
const { userAuthorizationError } = require('../utils/userAuthorization');
const { throttledLog } = require('../utils/throttledLog');

// 2026-10-12：鉴权失败的 401 统一带稳定机器码 error_code='UNAUTHORIZED'（与 errorCodes.STATUS_CODE 一致）
// 和细分 reason。客户端约定：401 且 error_code==='UNAUTHORIZED' → 本地会话已失效，应清登录态回登录页，
// 不要再循环 /auth/refresh、/auth/me（服务端对这两个接口有连续 401 退避，见 middleware/authBackoff.js）。
// error 文案保持不变，旧客户端照旧只读 error。
function deny(res, error, reason) {
  return res.status(401).json({ error, error_code: 'UNAUTHORIZED', reason });
}

module.exports = async function auth(req, res, next) {
  // Cookie first (web); fall back to Bearer header (Electron desktop)
  const bearerHeader = req.headers['authorization'];
  const token = req.cookies?.[config.cookieName] ||
    (bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice(7) : null);
  if (!token) return deny(res, '未授权', 'no_token');

  // 2026-10-11：先验签、再查黑名单（与 /uploads、socket 握手一致）。
  // 旧顺序下任意未签名的垃圾 cookie/Bearer 都会触发一次 SQLite 查询并以原串写入 cleanCache，
  // 匿名请求即可撑大进程内存、反复触发 pm2 600M 重启（断开全部 socket）。
  // 验签单独 try → 401；黑名单查询仍留在外层 try → 失败返回 503（H2：不降级放行）。
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (e) {
    return deny(res, 'Token无效或已过期', e?.name === 'TokenExpiredError' ? 'token_expired' : 'token_invalid');
  }

  try {
    // 异步检查 token 是否在黑名单中（logout 后）；仅验签通过的 token 才会走到这里
    const blacklisted = await isBlacklisted(token);
    if (blacklisted) {
      // P1-b 修复：这里命中"黑名单"不一定是真的被盗/主动登出——并发刷新场景下，
      // 输给兄弟请求的 token 也会落在这个分支（赢家刷新成功后把这把旧 token 拉黑）。
      // 此时浏览器 cookie 存储里很可能已经是赢家刚种下的新 token，如果无条件 clearCookie，
      // 这条清空指令一旦晚于赢家的 Set-Cookie 到达，就会把刚刷新出来的合法新会话也清掉，
      // 造成账号被误踢下线（100% 可复现，见 docs/TL-FULL-SYSTEM-AUDIT.md P1-b）。
      // 真正需要清 cookie 的场景（登出/封号/改密/删会话）在各自的处理器里已经显式
      // clearCookie 过一次（见 auth.controller.js logout/deleteAccount/changePassword），
      // 不依赖这里兜底；这里只需要正确返回 401 拒绝即可，不必再清一次可能是别人刚种下的新 cookie。
      return deny(res, '无效的Token，请重新登录', 'token_revoked');
    }

    try {
      const denied = await userAuthorizationError(payload);
      if (denied) {
        if (denied.status === 401) return deny(res, denied.error, 'session_invalid');
        return res.status(denied.status).json({ error: denied.error });
      }
      req.user = payload;
      req.token = token;  // 保存 token 供 logout 使用
      req.csrfToken = req.user.csrf;
      res.cookie(config.csrfCookie, req.csrfToken, csrfCookieOptions(req));
      res.setHeader('X-CSRF-Token', req.csrfToken);
      next();
    } catch {
      return deny(res, 'Token无效或已过期', 'token_invalid');
    }
  } catch (err) {
    // 2026-10-12：503 原因限频打点（同类原因 1 分钟 1 条 + 被吞条数），便于定位「快速 503」来自哪一层
    throttledLog('warn', 'auth503:blacklist', `[Auth] 503 reason=blacklist_lookup_failed path=${req.method} ${req.originalUrl?.split('?')[0]} err=${err?.code || ''} ${err?.message || err}`);
    // ⚠ 不降级放行，拒绝请求（H2）
    return res.status(503).json({ error: '认证服务暂时不可用，请稍后再试', error_code: 'AUTH_UNAVAILABLE' });
  }
};
