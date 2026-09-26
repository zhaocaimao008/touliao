'use strict';
/**
 * CSRF 双提交 Cookie 校验（全域门控，注册在路由之前）。
 *   - 安全方法 GET/HEAD/OPTIONS 跳过
 *   - 仅靠 Bearer token 鉴权的请求（移动端/Electron）跳过
 *   - Cookie 与 Bearer 为同一 token（原生客户端自动回传 Cookie）跳过
 *   - 对比 csrf_token Cookie 与 X-CSRF-Token header
 *   - Cookie 鉴权的写请求必须完成双提交，即使 CSRF Cookie 丢失
 */
const config = require('../config');

// 未鉴权入口：登录/注册。此时尚无会话可被 CSRF 攻击；若浏览器残留旧的
// csrf_token Cookie(如上次退出未清)，会让这些请求误报"CSRF token 无效"，
// 把真实的"邀请码不正确/密码错误"提示盖掉。故直接放行。
const CSRF_EXEMPT = ['/auth/login', '/auth/register', '/metrics/vitals'];

module.exports = function csrfProtection(req, res, next) {
  // 测试模式:e2e 跨端口前端读不到 csrf cookie,关双提交校验(生产默认不开)
  if (process.env.DISABLE_CSRF === '1') return next();
  if (/^(GET|HEAD|OPTIONS)$/i.test(req.method)) return next();
  if (CSRF_EXEMPT.includes(req.path)) return next();
  // 与 auth 的 Cookie 优先级一致；添加 Bearer 不能绕过 Cookie 会话的检查。
  // isolatedSession 已在此之前移除隔离客户端的共享 Cookie。
  const authCookie = req.cookies?.[config.cookieName];
  const authHeader = req.headers['authorization'];
  if (!authCookie && authHeader?.startsWith('Bearer ')) return next();
  // 原生客户端（iOS URLSession.shared）会自动回传登录响应种下的 Cookie，同时带 Bearer，
  // 但从不发 X-CSRF-Token —— 2026-09-24 起 iOS 已读/推送注册/上传/登出全部 403。
  // Bearer 与 Cookie 是同一个 token 时不可能是跨站伪造（伪造方拿不到受害者 token），放行；
  // 他人的或伪造的 Bearer 仍不能绕过 Cookie 会话的检查。
  if (authCookie && authHeader === `Bearer ${authCookie}`) return next();

  const cookieToken = req.cookies?.[config.csrfCookie];
  const headerToken = req.headers['x-csrf-token'];
  // 无登录凭据且无双提交字段时，继续交给路由鉴权；保留既有双提交语义。
  if (!authCookie && !cookieToken && !headerToken) return next();
  if (!cookieToken || !headerToken || headerToken !== cookieToken) {
    return res.status(403).json({ error: 'CSRF token 无效或缺失' });
  }
  next();
};
