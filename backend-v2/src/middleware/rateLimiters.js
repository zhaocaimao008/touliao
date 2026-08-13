'use strict';
/**
 * 集中式 HTTP 限流器定义（express-rate-limit）。
 * Socket 层的逐用户限流见 realtime/presence 中的 checkMsgRate。
 *
 * 存储策略：
 *   - REDIS_URL 配置且连接成功 → 使用 rate-limit-redis 共享存储（多进程/多实例安全）。
 *   - Redis 不可用 → 降级为进程内存存储（当前单进程 fork 模式下与之前行为完全一致）。
 *   两种路径下限流语义相同，仅多进程场景下共享模式才有实质差异。
 */
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const redis = require('redis');

// ── Redis 共享存储（可选）────────────────────────────────────────
// 尝试连接 Redis；失败时静默降级为内存存储，不阻塞启动。
let _redisClient = null;
let _redisReady  = false;

(async () => {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    const c = redis.createClient({
      url,
      database: 3, // db3 供 rate-limit 专用，与 cache(0)/blacklist(1) 隔离
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: (n) => (n >= 2 ? false : 200),
      },
    });
    c.on('error', () => { _redisReady = false; });
    c.on('ready', () => { _redisReady = true; });
    await c.connect();
    _redisClient = c;
    _redisReady  = true;
    console.debug('[RateLimit] Redis store connected (db3)');
  } catch {
    console.warn('[RateLimit] Redis unavailable, using in-memory store');
  }
})();

/** 构建 store 配置：Redis 可用则共享，否则内存。 */
function makeStore(prefix) {
  if (_redisReady && _redisClient) {
    return new RedisStore({
      sendCommand: (...args) => _redisClient.sendCommand(args),
      prefix: `rl:${prefix}:`,
    });
  }
  return undefined; // express-rate-limit 默认内存存储
}

const json = msg => ({ error: msg });
const base = { standardHeaders: true, legacyHeaders: false };

// 登录：5 次失败 → 10 分钟锁定
const loginLimiter = rateLimit({
  ...base, windowMs: 10 * 60 * 1000, max: 5,
  store: makeStore('login'),
  keyGenerator: (req) => req.body?.phone || ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).json(json('登录尝试过于频繁，账户已锁定10分钟')),
  message: json('登录尝试过于频繁，请10分钟后再试'),
});

// 注册：1 小时 5 次
const registerLimiter = rateLimit({
  ...base, windowMs: 60 * 60 * 1000, max: 5,
  store: makeStore('register'),
  message: json('注册过于频繁，请1小时后再试'),
});

// HTTP 发消息：单用户每分钟 60 条
const sendMsgLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 60,
  store: makeStore('sendMsg'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('发送消息过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 上传凭证：单用户 10 分钟 30 次
const uploadCredentialLimiter = rateLimit({
  ...base, windowMs: 10 * 60 * 1000, max: 30,
  store: makeStore('uploadCred'),
  keyGenerator: req => req.user.id,
  handler: (req, res) => res.status(429).json(json('上传过于频繁，请稍后再试')),
  validate: { xForwardedForHeader: false },
});

// 免密切换账号：单 IP 每分钟 10 次
const switchLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 10,
  store: makeStore('switch'),
  message: json('切换账号过于频繁，请稍后再试'),
});

// forget（移除设备账号）：单 IP 每分钟 5 次
const forgetLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 5,
  store: makeStore('forget'),
  message: json('操作过于频繁，请稍后再试'),
});

// 朋友圈图片上传：单用户 10 分钟 30 次
const momentImageLimiter = rateLimit({
  ...base, windowMs: 10 * 60 * 1000, max: 30,
  store: makeStore('momentImg'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).json(json('图片上传过于频繁，请稍后再试')),
  validate: { xForwardedForHeader: false },
});

// 重置密码：单手机号 1 小时最多 3 次
const resetPasswordLimiter = rateLimit({
  ...base, windowMs: 60 * 60 * 1000, max: 3,
  store: makeStore('resetPwd'),
  keyGenerator: (req) => req.body?.phone || ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).json(json('重置密码过于频繁，请1小时后再试')),
  validate: { xForwardedForHeader: false },
});

// emoji reaction：单用户每分钟 30 次
const reactLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 30,
  store: makeStore('react'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('操作过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 本地分块上传：init 每分钟 10 次，chunk 每分钟 120 片
const chunkInitLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 10,
  store: makeStore('chunkInit'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('上传请求过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});
const chunkUploadLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 120,
  store: makeStore('chunkUp'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('上传过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 充值：单用户每小时最多 10 次
const rechargeLimiter = rateLimit({
  ...base, windowMs: 60 * 60 * 1000, max: 10,
  store: makeStore('recharge'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).json(json('充值过于频繁，请1小时后再试')),
  validate: { xForwardedForHeader: false },
});

// 用户搜索：单用户每分钟 30 次
const searchLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 30,
  store: makeStore('search'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('搜索过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 发布动态：单用户每分钟 10 次
const createMomentLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 10,
  store: makeStore('moment'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('发动态过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 朋友圈点赞/评论：单用户每分钟 20 次
const commentLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 20,
  store: makeStore('comment'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('操作过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 资料/头像/封面更新：单用户每小时 10 次
const profileUpdateLimiter = rateLimit({
  ...base, windowMs: 60 * 60 * 1000, max: 10,
  store: makeStore('profile'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('资料修改过于频繁，请1小时后再试'),
  validate: { xForwardedForHeader: false },
});

// 贴纸上传/收藏：单用户每分钟 20 次
const stickerLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 20,
  store: makeStore('sticker'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('表情操作过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 推送订阅注册：单用户每分钟 10 次
const pushSubscribeLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 10,
  store: makeStore('pushSub'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('推送订阅操作过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// TURN ICE 凭证：单用户每分钟 20 次
const turnCredentialLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 20,
  store: makeStore('turn'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('请求 ICE 凭证过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 群邀请链接加入：单用户每分钟 10 次
const joinGroupLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 10,
  store: makeStore('joinGroup'),
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('加入群组过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 测试模式:DISABLE_RATE_LIMIT=1 时所有限流变 no-op
const limiters = { loginLimiter, registerLimiter, sendMsgLimiter, uploadCredentialLimiter, switchLimiter, forgetLimiter, momentImageLimiter, reactLimiter, resetPasswordLimiter, chunkInitLimiter, chunkUploadLimiter, rechargeLimiter, searchLimiter, createMomentLimiter, commentLimiter, profileUpdateLimiter, stickerLimiter, pushSubscribeLimiter, turnCredentialLimiter, joinGroupLimiter };
if (process.env.DISABLE_RATE_LIMIT === '1') {
  const noop = (req, res, next) => next();
  for (const k of Object.keys(limiters)) limiters[k] = noop;
}
module.exports = limiters;

