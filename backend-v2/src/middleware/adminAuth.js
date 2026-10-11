'use strict';
/**
 * 后台管理鉴权：独立于普通用户。
 *   - 从 touliao_admin_token Cookie 读 JWT，要求 payload.admin === true
 *   - 通过后下发 csrf_token（复用双提交机制）
 * 普通用户的 vxin_token 无 admin 声明，无法越权进后台。
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { csrfCookieOptions } = require('../utils/cookies');
const { isBlacklisted } = require('../utils/tokenBlacklist');
const { currentAdmin, allowedAdminIp } = require('../utils/adminAuthorization');

module.exports = function adminAuth(req, res, next) {
  if (!allowedAdminIp(req.ip)) return res.status(403).json({ error: '后台仅限白名单 IP 访问' });
  const token = req.cookies?.[config.admin.cookieName];
  if (!token) return res.status(401).json({ error: '未登录后台' });
  // 2026-10-11：先验签、再查黑名单（同 auth.js）。IP 白名单为空时本接口对公网开放，
  // 旧顺序下任意垃圾 cookie 都会打一次 SQLite 并写入 cleanCache。验签失败 → 401（照旧清 cookie）；
  // 黑名单查询失败仍走下方 .catch → 503，不降级放行。
  let payload;
  try {
    payload = jwt.verify(token, config.adminJwtSecret, { algorithms: ['HS256'] });
  } catch (e) {
    res.clearCookie(config.admin.cookieName, { path: '/' });
    return res.status(401).json({ error: '后台登录已过期' });
  }
  // 异步黑名单检查（仅验签通过的 token）
  isBlacklisted(token).then(blacklisted => {
    if (blacklisted) {
      res.clearCookie(config.admin.cookieName, { path: '/' });
      return res.status(401).json({ error: '后台登录已过期' });
    }
    try {
      if (payload.admin !== true) return res.status(403).json({ error: '无后台权限' });
      const identity = currentAdmin(payload);
      if (!identity) {
        res.clearCookie(config.admin.cookieName, { path: '/' });
        return res.status(401).json({ error: '后台登录已过期' });
      }
      req.admin = identity;
      req.adminToken = token;
      req.csrfToken = payload.csrf;
      res.cookie(config.csrfCookie, payload.csrf, csrfCookieOptions(req));
      res.setHeader('X-CSRF-Token', payload.csrf);
      next();
    } catch (e) {
      res.clearCookie(config.admin.cookieName, { path: '/' });
      return res.status(401).json({ error: '后台登录已过期' });
    }
  }).catch(err => {
    console.error('[AdminAuth] Blacklist check error:', err);
    res.clearCookie(config.admin.cookieName, { path: '/' });
    return res.status(503).json({ error: '认证服务暂时不可用，请稍后再试' });
  });
};
