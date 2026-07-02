'use strict';
/**
 * 后台管理鉴权：独立于普通用户。
 *   - 从 vxin_admin_token Cookie 读 JWT，要求 payload.admin === true
 *   - 通过后下发 csrf_token（复用双提交机制）
 * 普通用户的 vxin_token 无 admin 声明，无法越权进后台。
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { csrfCookieOptions } = require('../utils/cookies');
const { isBlacklisted } = require('../utils/tokenBlacklist');

module.exports = function adminAuth(req, res, next) {
  const token = req.cookies?.[config.admin.cookieName];
  if (!token) return res.status(401).json({ error: '未登录后台' });
  // 异步黑名单检查
  isBlacklisted(token).then(blacklisted => {
    if (blacklisted) {
      res.clearCookie(config.admin.cookieName, { path: '/' });
      return res.status(401).json({ error: '后台登录已过期' });
    }
    try {
      const payload = jwt.verify(token, config.adminJwtSecret, { algorithms: ['HS256'] });
      if (!payload.admin) return res.status(403).json({ error: '无后台权限' });
      req.admin = payload;
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
