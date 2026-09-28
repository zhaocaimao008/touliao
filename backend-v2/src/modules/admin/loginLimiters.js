'use strict';
/**
 * 后台登录限流（/api/admin/login 与备用路径 /api/vxin-admin-login 共用）。
 *   - 按 IP：15 分钟 10 次（原有）
 *   - 按用户名：15 分钟内失败 20 次即锁定该后台账号 15 分钟，与来源 IP 无关。
 *     只按 IP 计数时换 IP 就能继续猜密码/谷歌验证码；成功登录不计数，正常使用不受影响。
 */
const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const message = { error: '登录尝试过于频繁，请稍后再试' };

const adminLoginLimiter = rateLimit({ windowMs: WINDOW_MS, max: 10, message, standardHeaders: true, legacyHeaders: false });

const adminUsernameLimiter = rateLimit({
  windowMs: WINDOW_MS, max: 20, message, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: req => `admin-user:${String(req.body?.username || '').trim().toLowerCase()}`,
  validate: { keyGeneratorIpFallback: false },
});

module.exports = { adminLoginLimiter, adminUsernameLimiter };
