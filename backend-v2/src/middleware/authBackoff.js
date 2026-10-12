'use strict';
/**
 * /api/auth/refresh、/api/auth/me 的「连续 401」退避（2026-10-12）。
 *
 * 背景：线上一天 /auth/refresh 909 次几乎全是 401、/auth/me 73% 是 401——客户端拿着已失效的 token
 * 循环重试。这里按「客户端 IP」与「所出示 token 的哈希」两个维度在进程内存里数连续 401：
 *   - 同一个 token 连续 401 达 TOKEN_MAX 次 → 该 token 直接 429（它已死，合法用户不会再用它）；
 *   - 同一 IP 连续 401 达 IP_MAX 次 → 该 IP 上「签名无效/无 token」的请求 429；
 *     出示签名有效 token（含已过期但签名真实的）的请求照常放行（只做一次 HMAC 验签，不查库），
 *     避免同一 NAT 后面的正常用户被别人的死循环连坐。已过期的真 token 也放行：它会在 auth
 *     拿到真正的 401 token_expired，各版本客户端都据此回登录页；若在这里给 429，iOS(main)/
 *     Android 8.1.44 会当成临时服务端错误，在「服务暂时不可用，正在重试」里卡满整个退避期。
 *     过期 token 若持续 401，仍会被 token 维度的计数单独退避。
 *   - 任一请求成功（2xx）即清零它的 IP 与 token 计数。
 * 429 响应带 Retry-After，body.error_code = 'AUTH_BACKOFF'。
 * 单进程内存实现（pm2 单实例 fork）；多实例时各实例各自计数，只是阈值相应放宽，不影响正确性。
 * DISABLE_RATE_LIMIT=1（测试环境）时整体关闭；AUTH_BACKOFF_DISABLED=1 可单独关闭。
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

function createAuthBackoff(opts = {}) {
  const WINDOW_MS = opts.windowMs ?? 10 * 60 * 1000;   // 连续失败统计窗口
  const BLOCK_MS = opts.blockMs ?? 5 * 60 * 1000;      // 达阈值后的退避时长
  const TOKEN_MAX = opts.tokenMax ?? 10;
  const IP_MAX = opts.ipMax ?? 30;
  const MAX_ENTRIES = opts.maxEntries ?? 50000;
  const force = !!opts.force;
  const entries = new Map(); // key → { count, first, blockedUntil }

  function enabled() {
    if (force) return true;
    return process.env.DISABLE_RATE_LIMIT !== '1' && process.env.AUTH_BACKOFF_DISABLED !== '1';
  }

  function prune(now) {
    for (const [k, e] of entries) {
      if (e.blockedUntil <= now && now - e.first > WINDOW_MS) entries.delete(k);
    }
    // 极端情况下（海量不同 IP/token）仍超上限：丢最早插入的一半，宁可漏判也不让内存无界增长
    if (entries.size > MAX_ENTRIES) {
      let drop = entries.size - Math.floor(MAX_ENTRIES / 2);
      for (const k of entries.keys()) { if (drop-- <= 0) break; entries.delete(k); }
    }
  }

  function fail(key, max, now) {
    let e = entries.get(key);
    if (!e || now - e.first > WINDOW_MS) { e = { count: 0, first: now, blockedUntil: 0 }; entries.set(key, e); }
    e.count++;
    if (e.count >= max) e.blockedUntil = now + BLOCK_MS;
  }

  function blockedFor(key, now) {
    const e = entries.get(key);
    return e && e.blockedUntil > now ? e.blockedUntil - now : 0;
  }

  function presentedToken(req) {
    const h = req.headers['authorization'];
    return req.cookies?.[config.cookieName] || (h?.startsWith('Bearer ') ? h.slice(7) : null);
  }

  function signatureValid(token) {
    if (!token) return false;
    try { jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], ignoreExpiration: true }); return true; } catch { return false; }
  }

  let lastPrune = 0;
  function middleware(req, res, next) {
    if (!enabled()) return next();
    const now = Date.now();
    if (now - lastPrune > 60 * 1000 || entries.size > MAX_ENTRIES) { lastPrune = now; prune(now); }

    const token = presentedToken(req);
    const ipKey = `ip:${req.ip || 'unknown'}`;
    const tokKey = token ? `tok:${crypto.createHash('sha256').update(token).digest('base64url').slice(0, 22)}` : null;

    let wait = tokKey ? blockedFor(tokKey, now) : 0;
    if (!wait) {
      const ipWait = blockedFor(ipKey, now);
      if (ipWait && !signatureValid(token)) wait = ipWait;
    }
    if (wait) {
      const secs = Math.max(1, Math.ceil(wait / 1000));
      res.setHeader('Retry-After', String(secs));
      return res.status(429).json({
        error: '认证失败次数过多，请重新登录',
        error_code: 'AUTH_BACKOFF',
        retry_after: secs,
      });
    }

    res.on('finish', () => {
      const t = Date.now();
      if (res.statusCode === 401) {
        if (tokKey) fail(tokKey, TOKEN_MAX, t);
        fail(ipKey, IP_MAX, t);
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        if (tokKey) entries.delete(tokKey);
        entries.delete(ipKey);
      }
    });
    next();
  }

  middleware._entries = entries; // 测试用
  return middleware;
}

module.exports = createAuthBackoff();
module.exports.createAuthBackoff = createAuthBackoff;
