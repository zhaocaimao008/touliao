'use strict';
/**
 * 集中式 HTTP 限流器定义（express-rate-limit）。
 * Socket 层的逐用户限流见 realtime/presence 中的 checkMsgRate。
 */
const rateLimit = require('express-rate-limit');
// IPv6 安全的 IP 取值助手；直接用 req.ip 会触发 express-rate-limit 的
// ERR_ERL_KEY_GEN_IPV6 校验（启动期抛错导致进程崩溃）。
const { ipKeyGenerator } = require('express-rate-limit');

const json = msg => ({ error: msg });
const base = { standardHeaders: true, legacyHeaders: false };

// 登录：5 次失败 → 10 分钟锁定（需在 auth controller 中调用 recordFailedAttempt）
// keyGenerator 以手机号为主键；无手机号时回退到 IPv6 归一化后的 IP。
const loginLimiter = rateLimit({
  ...base, windowMs: 10 * 60 * 1000, max: 5,
  keyGenerator: (req, res) => req.body?.phone || ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).json(json('登录尝试过于频繁，账户已锁定10分钟')),
  message: json('登录尝试过于频繁，请10分钟后再试'),
});

// 注册：1 小时 5 次
const registerLimiter = rateLimit({
  ...base, windowMs: 60 * 60 * 1000, max: 5,
  message: json('注册过于频繁，请1小时后再试'),
});

// HTTP 发消息：单用户每分钟 60 条（用 userId 而非 IP，避免 NAT 用户共享同一桶）
const sendMsgLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 60,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('发送消息过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 上传凭证：单用户 10 分钟 30 次
const uploadCredentialLimiter = rateLimit({
  ...base, windowMs: 10 * 60 * 1000, max: 30,
  keyGenerator: req => req.user.id,
  handler: (req, res) => res.status(429).json(json('上传过于频繁，请稍后再试')),
  validate: { xForwardedForHeader: false },
});

// 免密切换账号：单 IP 每分钟 10 次（限暴力尝试，无需断然封禁）
const switchLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 10,
  message: json('切换账号过于频繁，请稍后再试'),
});

// forget（移除设备账号）：单 IP 每分钟 5 次
const forgetLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 5,
  message: json('操作过于频繁，请稍后再试'),
});

// 朋友圈图片上传：单用户 10 分钟 30 次（每次最多9张，相当于270张/10min）
const momentImageLimiter = rateLimit({
  ...base, windowMs: 10 * 60 * 1000, max: 30,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).json(json('图片上传过于频繁，请稍后再试')),
  validate: { xForwardedForHeader: false },
});

// 重置密码：单手机号 1 小时最多 3 次（邀请码可暴力枚举，必须严格限流）
const resetPasswordLimiter = rateLimit({
  ...base, windowMs: 60 * 60 * 1000, max: 3,
  keyGenerator: (req) => req.body?.phone || ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).json(json('重置密码过于频繁，请1小时后再试')),
  validate: { xForwardedForHeader: false },
});

// emoji reaction：单用户每分钟 30 次
const reactLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 30,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('操作过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 本地分块上传：init 每分钟 10 次，chunk 每分钟 120 片（单用户）
const chunkInitLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 10,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('上传请求过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});
const chunkUploadLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 120,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('上传过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 充值：单用户每小时最多 10 次（占位接口，接入真实支付前防滥刷）
const rechargeLimiter = rateLimit({
  ...base, windowMs: 60 * 60 * 1000, max: 10,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).json(json('充值过于频繁，请1小时后再试')),
  validate: { xForwardedForHeader: false },
});

// 用户搜索：单用户每分钟 30 次（含手机号精确查找，防穷举）
const searchLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 30,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('搜索过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 发布动态：单用户每分钟 10 次
const createMomentLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 10,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('发动态过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 朋友圈点赞/评论：单用户每分钟 20 次
const commentLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 20,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('操作过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 资料/头像/封面更新：单用户每小时 10 次
const profileUpdateLimiter = rateLimit({
  ...base, windowMs: 60 * 60 * 1000, max: 10,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('资料修改过于频繁，请1小时后再试'),
  validate: { xForwardedForHeader: false },
});

// 贴纸上传/收藏：单用户每分钟 20 次
const stickerLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 20,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('表情操作过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 推送订阅注册：单用户每分钟 10 次（防刷库存储 DoS）
const pushSubscribeLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 10,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('推送订阅操作过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// TURN ICE 凭证：单用户每分钟 20 次（通话发起/重连场景足够，防 HMAC 侧信道探测）
const turnCredentialLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 20,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('请求 ICE 凭证过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 群邀请链接加入：单用户每分钟 10 次（token 为 UUID 级熵无法暴力猜测，此限流主防 DoS 写压力）
const joinGroupLimiter = rateLimit({
  ...base, windowMs: 60 * 1000, max: 10,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  message: json('加入群组过于频繁，请稍后再试'),
  validate: { xForwardedForHeader: false },
});

// 测试模式:DISABLE_RATE_LIMIT=1 时所有限流变 no-op,供 e2e 自动化批量造号/发消息。
// 生产默认不设此变量,限流照常生效。
const limiters = { loginLimiter, registerLimiter, sendMsgLimiter, uploadCredentialLimiter, switchLimiter, forgetLimiter, momentImageLimiter, reactLimiter, resetPasswordLimiter, chunkInitLimiter, chunkUploadLimiter, rechargeLimiter, searchLimiter, createMomentLimiter, commentLimiter, profileUpdateLimiter, stickerLimiter, pushSubscribeLimiter, turnCredentialLimiter, joinGroupLimiter };
if (process.env.DISABLE_RATE_LIMIT === '1') {
  const noop = (req, res, next) => next();
  for (const k of Object.keys(limiters)) limiters[k] = noop;
}
module.exports = limiters;
