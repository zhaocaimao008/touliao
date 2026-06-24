'use strict';
/**
 * 集中式配置：所有环境变量读取的唯一入口。
 * 业务代码一律 require('../config') 取值，禁止散落 process.env。
 */
require('dotenv').config();
const path = require('path');

const config = {
  env:  process.env.NODE_ENV || 'development',
  // backend-v2 验证期跑 3003，避免与生产 3002 冲突；上线切换时改回 3002
  port: parseInt(process.env.PORT_V2 || process.env.PORT, 10) || 3003,

  // ── 数据库 ──────────────────────────────────────────────────
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../../wechat.db'),

  // ── 鉴权 ────────────────────────────────────────────────────
  jwtSecret:    process.env.JWT_SECRET,
  adminJwtSecret: process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
  cookieName:   'vxin_token',
  csrfCookie:   'csrf_token',
  walletCookie: 'vxin_wallet',     // 设备多账号钱包(丝滑切换), httpOnly 长效
  walletMaxAge: 30 * 24 * 60 * 60, // 30天（秒）
  tokenMaxAge:  7 * 24 * 60 * 60, // 7天（秒） — 原30天，缩至7天降低token泄漏风险（H3）
  inviteCode:   process.env.INVITE_CODE || '',

  // ── 后台管理（独立超管账号）────────────────────────────────
  admin: {
    username:    process.env.ADMIN_USERNAME || '',
    password:    process.env.ADMIN_PASSWORD || '',
    cookieName:  'vxin_admin_token',
    tokenMaxAge: 12 * 60 * 60, // 12小时（秒）
    // IP 白名单(逗号分隔)。为空=不限制(默认，避免误锁)；非空时仅允许列表内 IP 访问后台。
    ipWhitelist: (process.env.ADMIN_IP_WHITELIST || '').split(',').map(s => s.trim()).filter(Boolean),
  },

  // ── CORS ────────────────────────────────────────────────────
  // CORS_ORIGINS（逗号分隔）：新部署只需在 .env 设置自己的域名即可，无需改代码。
  // CORS_ORIGINS_ONLY=true：忽略内置白名单，仅使用 CORS_ORIGINS（完全覆盖模式）。
  allowedOrigins: (() => {
    const extra = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    if (process.env.CORS_ORIGINS_ONLY === 'true') {
      return [...new Set([...extra, 'http://localhost:3000', 'http://localhost:5173'])];
    }
    const defaults = [
      'https://chat.91aigu.com',
      'https://vxin.91aigu.com',
      'https://91aigu.com',
      'https://www.91aigu.com',
      'https://dipsin.com',
      'https://www.dipsin.com',
      'http://dipsin.com',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://104.244.95.70:8086',
      'http://93.179.127.50:8086',
    ];
    return [...new Set([...defaults, ...extra])];
  })(),

  // ── 应用 ────────────────────────────────────────────────────
  appUrl:      process.env.APP_URL || 'https://chat.91aigu.com',
  // 未显式配置时：老部署沿用 backend/uploads（兼容线上），全新部署自包含到 backend-v2/uploads
  uploadsRoot: process.env.UPLOADS_ROOT || (() => {
    const legacy = path.resolve(__dirname, '../../../backend/uploads');
    return require('fs').existsSync(legacy) ? legacy : path.resolve(__dirname, '../../uploads');
  })(),

  // ── 业务常量 ────────────────────────────────────────────────
  limits: {
    maxMsgLength:   2000,
    msgRateLimit:   3,      // Socket：每用户每秒最多 3 条
    msgRateWindow:  1000,
    recallWindow:   120,    // 撤回/编辑时限（秒）
    groupMembersPreview: 9, // 会话列表群头像预览数
    unreadCap:      99,     // 未读早停上限
  },

  vapid: {
    publicKey:  process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    email:      process.env.VAPID_EMAIL || 'mailto:admin@vxin.app',
  },

  // ── WebRTC ICE / TURN ───────────────────────────────────────
  // 通话 NAT 穿透。STUN 始终下发；配置 TURN_SECRET + TURN_URLS 后启用
  // coturn 时效凭证（use-auth-secret 模式），三端通过 GET /api/turn/credentials 动态拉取。
  turn: {
    // coturn static-auth-secret（与 coturn 配置一致）。为空=不签发 TURN，仅返回 STUN。
    secret: process.env.TURN_SECRET || '',
    // TURN 服务器 URL（逗号分隔），如 turn:turn.example.com:3478,turns:turn.example.com:5349
    urls: (process.env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean),
    ttl: parseInt(process.env.TURN_TTL, 10) || 3600, // 凭证有效期（秒）
    // 公共/自建 STUN 兜底（逗号分隔），始终下发
    stun: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
      .split(',').map(s => s.trim()).filter(Boolean),
  },

  moments: {
    // 取消赞 / 删评论时是否同步删除互动通知。默认 false（保留历史，对标微信）
    deleteNotifOnCancel: process.env.MOMENTS_DELETE_NOTIF_ON_CANCEL === 'true',
    // like/comment 离线推送。默认 true（可置 'false' 关闭）
    pushOnInteract: process.env.MOMENTS_PUSH_ON_INTERACT !== 'false',
  },
};

if (!config.jwtSecret) {
  console.error('[config] 致命错误：未设置 JWT_SECRET');
  process.exit(1);
}

module.exports = config;
