'use strict';
/**
 * CSRF 双提交 Cookie 校验（全域门控，注册在路由之前）。
 *   - 安全方法 GET/HEAD/OPTIONS 跳过
 *   - Bearer token 请求（移动端/Electron）跳过：第三方网站无法设置自定义 header，
 *     Bearer 鉴权天然不受 CSRF 攻击；且 Capacitor WebView 会把 session cookie
 *     带过来，sessionStorage 重启后清空，导致 cookie 有而 header 无 → 误报 403
 *   - 对比 csrf_token Cookie 与 X-CSRF-Token header
 *   - 无 CSRF Cookie = 尚未鉴权，放行交给 auth 处理 401
 */
const config = require('../config');

// 未鉴权入口：登录/注册。此时尚无会话可被 CSRF 攻击；若浏览器残留旧的
// csrf_token Cookie(如上次退出未清)，会让这些请求误报"CSRF token 无效"，
// 把真实的"邀请码不正确/密码错误"提示盖掉。故直接放行。
const CSRF_EXEMPT = ['/auth/login', '/auth/register'];

module.exports = function csrfProtection(req, res, next) {
  // 测试模式:e2e 跨端口前端读不到 csrf cookie,关双提交校验(生产默认不开)
  if (process.env.DISABLE_CSRF === '1') return next();
  if (/^(GET|HEAD|OPTIONS)$/i.test(req.method)) return next();
  if (CSRF_EXEMPT.includes(req.path)) return next();
  // Bearer token（移动端 Capacitor / Electron）：无 CSRF 风险，直接跳过
  if (req.headers['authorization']?.startsWith('Bearer ')) return next();

  const cookieToken = req.cookies?.[config.csrfCookie];
  if (!cookieToken) return next();

  const headerToken = req.headers['x-csrf-token'];
  if (!headerToken || headerToken !== cookieToken) {
    return res.status(403).json({ error: 'CSRF token 无效或缺失' });
  }
  next();
};
