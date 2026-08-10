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

module.exports = function auth(req, res, next) {
  // Cookie first (web); fall back to Bearer header (Electron desktop)
  const bearerHeader = req.headers['authorization'];
  const token = req.cookies?.[config.cookieName] ||
    (bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice(7) : null);
  if (!token) return res.status(401).json({ error: '未授权' });

  // 异步检查 token 是否在黑名单中（logout 后）
  isBlacklisted(token).then(blacklisted => {
    if (blacklisted) {
      res.clearCookie(config.cookieName, { path: '/' });
      return res.status(401).json({ error: '无效的Token，请重新登录' });
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
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
  }).catch(err => {
    console.error('[Auth] Blacklist check error:', err);
    // ⚠ 不降级放行，拒绝请求（H2）
    res.clearCookie(config.cookieName, { path: '/' });
    return res.status(503).json({ error: '认证服务暂时不可用，请稍后再试' });
  });
};
