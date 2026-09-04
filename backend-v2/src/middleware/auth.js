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
const { readDb } = require('../db/connection');
const { getUserStatus, setUserStatus } = require('../utils/userStatusCache');

module.exports = async function auth(req, res, next) {
  // Cookie first (web); fall back to Bearer header (Electron desktop)
  const bearerHeader = req.headers['authorization'];
  const token = req.cookies?.[config.cookieName] ||
    (bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice(7) : null);
  if (!token) return res.status(401).json({ error: '未授权' });

  try {
    // 异步检查 token 是否在黑名单中（logout 后）
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
      return res.status(401).json({ error: '无效的Token，请重新登录' });
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      // A004: 会话被删（deleteSession）后，该会话签发的 JWT 即使未过期也立即失效。
      // 删除会话时已将 `jti:<sessionId>` 加入黑名单，此处按 jti 精确拦截。
      if (payload.jti) {
        const jtiBlacklisted = await isBlacklisted(`jti:${payload.jti}`);
        if (jtiBlacklisted) {
          res.clearCookie(config.cookieName, { path: '/' });
          return res.status(401).json({ error: '该会话已失效，请重新登录' });
        }
      }
      // 校验账号状态：封禁即拒（与 socket 握手一致），及 token 是否早于密码修改时间。
      // 优先命中进程内缓存（30s TTL），未命中才查 DB 并回填缓存。
      if (payload.id) {
        let row = getUserStatus(payload.id);
        if (!row) {
          row = readDb.prepare('SELECT banned, password_changed_at FROM users WHERE id=?').get(payload.id);
          if (row) setUserStatus(payload.id, row.banned, row.password_changed_at);
        }
        if (row?.banned) {
          res.clearCookie(config.cookieName, { path: '/' });
          return res.status(403).json({ error: '账号已被封禁' });
        }
        if (payload.iat && row?.password_changed_at && payload.iat < row.password_changed_at) {
          res.clearCookie(config.cookieName, { path: '/' });
          return res.status(401).json({ error: '密码已修改，请重新登录' });
        }
      }
      req.user = payload;
      req.token = token;  // 保存 token 供 logout 使用
      req.csrfToken = req.user.csrf;
      res.cookie(config.csrfCookie, req.csrfToken, csrfCookieOptions(req));
      res.setHeader('X-CSRF-Token', req.csrfToken);
      next();
    } catch {
      res.clearCookie(config.cookieName, { path: '/' });
      return res.status(401).json({ error: 'Token无效或已过期' });
    }
  } catch (err) {
    console.error('[Auth] Blacklist check error:', err);
    // ⚠ 不降级放行，拒绝请求（H2）
    res.clearCookie(config.cookieName, { path: '/' });
    return res.status(503).json({ error: '认证服务暂时不可用，请稍后再试' });
  }
};
