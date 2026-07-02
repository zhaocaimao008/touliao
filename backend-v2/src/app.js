'use strict';
/**
 * Express 应用装配（不含 HTTP/Socket 启动，便于测试与复用）。
 * 中间件顺序：helmet → cors → cookieParser → body 解析 → 静态 → CSRF 门控 → 路由 → 错误处理。
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const csrfProtection = require('./middleware/csrf');
const requestId = require('./middleware/requestId');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const { requestLogger, warn } = require('./utils/logger');
const { metricsMiddleware, metrics } = require('./utils/monitoring');
const swaggerSpec = require('./utils/swagger');
const sentry = require('./utils/sentry');

const app = express();

// ── Sentry 错误追踪初始化 ────────────────────────────────────────
sentry.initSentry();
sentry.attachSentryMiddleware(app);

// Cloudflare → Nginx → Node 双层代理，trust proxy:2 确保 req.ip 取到真实客户端 IP
// 限流器(sendMsgLimiter 等)以此为 key，若取到 Nginx 内网 IP 则所有用户共享同一限流桶
app.set('trust proxy', 2);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
      imgSrc:     ["'self'", 'data:', 'blob:', 'https:'],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https:'],
      fontSrc:    ["'self'", 'https:'],
      frameSrc:   ["'self'"],
      mediaSrc:   ["'self'", 'data:', 'blob:', 'https:'],
    },
  },
}));

app.use(cors({
  origin: (origin, cb) => {
    // origin === 'null'：Electron 桌面端 file:// 页面发送的字面量 "null"，需放行
    if (!origin || origin === 'null' || config.allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// 请求 ID（贯穿日志/错误响应）→ 日志和监控中间件
app.use(requestId);
app.use(requestLogger);
app.use(metricsMiddleware);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// H9: /uploads 静态文件鉴权 — 用户JWT或Admin JWT均可访问，同时校验黑名单
const jwt = require('jsonwebtoken');
const { isBlacklisted } = require('./utils/tokenBlacklist');
// 仅图片/音频/视频允许内联（<img>/<audio>/<video> 预览与播放）；文档/压缩包/文本一律以附件下发，
// 使 HTML/SVG 等只会被下载、绝不在本站源被当页面执行 → 消除存储型 XSS。（须与 upload.js 的常见格式白名单同步）
const INLINE_PREVIEW_EXTS = new Set([
  // 图片
  '.jpg', '.jpeg', '.jpe', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.avif', '.tif', '.tiff',
  // 视频
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.3gp', '.3g2', '.ogv',
  // 音频
  '.mp3', '.m4a', '.m4b', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus', '.wma', '.amr', '.mid', '.midi', '.aif', '.aiff',
]);
app.use('/uploads', (req, res, next) => {
  // Cookie 优先；Electron/移动端用 Bearer 鉴权、<img> 无法带 header，故同时支持 ?token= 查询参数与 Bearer 兜底
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  const token = req.cookies?.[config.cookieName] || req.cookies?.[config.admin.cookieName]
    || req.query?.token || bearer;
  if (!token) return res.status(401).json({ error: '未授权' });
  try {
    jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    try {
      jwt.verify(token, config.adminJwtSecret, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: '未授权' });
    }
  }
  isBlacklisted(token).then(blacklisted => {
    if (blacklisted) return res.status(401).json({ error: '登录已失效，请重新登录' });
    next();
  }).catch(err => {
    console.error('[uploads] blacklist check error:', err.message);
    res.status(503).json({ error: '认证服务暂时不可用' });
  });
}, express.static(config.uploadsRoot, {
  // uploads 均为 uuid 命名、内容永不变更 → 强缓存，消除每次加载的 304 回源往返，
  // 头像/图片打开会话即从本地缓存秒出。private：内容经鉴权，禁止共享缓存(CDN/代理)存储，
  // 只允许当前用户浏览器缓存（与该用户已被授权取得这些字节一致，无安全回归）。
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    // 上传已放行所有格式 → 安全兜底改在下发层：一律 nosniff（禁止浏览器 MIME 嗅探），
    // 且仅图片/音频/视频允许内联预览，其余（HTML/SVG/脚本/文档/压缩包…）一律以附件下发，
    // 使 HTML/SVG 只会被下载、绝不在本站源被当页面执行 → 消除存储型 XSS。
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const ext = path.extname(filePath).toLowerCase();
    if (!INLINE_PREVIEW_EXTS.has(ext)) {
      // 不带 filename：强制下载防 XSS，同时让前端 <a download="原名"> 决定保存文件名
      // （Content-Disposition 若带 filename 会按规范覆盖 download 属性，导致存成 uuid 名）。
      res.setHeader('Content-Disposition', 'attachment');
    }
  },
}));
app.use('/downloads', express.static(path.join(__dirname, '../../downloads'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  },
}));

// ── 下载中心页面 ─────────────────────────────────────────────────────
app.use('/download', require('./modules/download'));

// ── API 文档 ────────────────────────────────────────────────────────
// 生产环境禁掉 Swagger，防止 API 合同泄漏
if (config.env === 'production') {
  app.use('/api-docs', (req, res) => res.status(404).json({ error: 'Not found' }));
} else {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// 性能指标端点（Prometheus 格式）—— 生产环境也用不上
app.get('/metrics', (req, res) => {
  if (config.env === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  res.type('text/plain');
  res.send(metrics.getPrometheusMetrics());
});

// 实时指标端点（JSON 格式，用于前端展示）
app.get('/api/metrics', (req, res) => {
  if (config.env === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(metrics.getMetrics());
});

// 前端错误边界上报（免鉴权 / 免 CSRF，置于 CSRF 门控之前）。仅记录日志，best-effort。
const clientErrorLimiter = require('express-rate-limit')({ windowMs: 60 * 1000, max: 20, legacyHeaders: false });
app.post('/api/client-errors', clientErrorLimiter, (req, res) => {
  try {
    const { message, stack, componentStack, url, ua } = req.body || {};
    warn('[client-error] 前端异常上报', {
      message: String(message || '').slice(0, 500),
      stack: String(stack || '').slice(0, 2000),
      componentStack: String(componentStack || '').slice(0, 2000),
      url: String(url || '').slice(0, 300),
      ua: String(ua || '').slice(0, 300),
      ip: req.ip,
    });
  } catch { /* 上报失败不影响前端 */ }
  res.json({ ok: true });
});

// CSRF 双提交门控（路由之前）
app.use('/api', csrfProtection);

// ── 路由 ────────────────────────────────────────────────────────
app.use('/api/auth',          require('./modules/auth/auth.routes'));
app.use('/api/users',         require('./modules/users/users.routes'));
// 后台登录备用路径（绕过 CF WAF /api/admin/* 限流），复用 admin.routes 的防护中间件
{
  const rateLimit = require('express-rate-limit');
  const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10,
    message: { error: '登录尝试过于频繁，请稍后再试' },
    standardHeaders: true, legacyHeaders: false,
  });
  const normIp = ip => (ip || '').replace(/^::ffff:/, '');
  const ipGuard = (req, res, next) => {
    const wl = config.admin.ipWhitelist;
    if (!wl.length) return next();
    if (wl.includes(normIp(req.ip))) return next();
    return res.status(403).json({ error: '后台仅限白名单 IP 访问' });
  };
  app.post('/api/vxin-admin-login', ipGuard, adminLoginLimiter, require('./modules/admin/admin.controller').login);
}
app.use('/api/messages',      require('./modules/messages/messages.routes'));
app.use('/api/moments',       require('./modules/moments/moments.routes'));
app.use('/api/notifications', require('./modules/notifications/notifications.routes'));
app.use('/api/upload',        require('./modules/upload/upload.routes'));
app.use('/api/stickers',      require('./modules/stickers/stickers.routes'));
app.use('/api/redpackets',    require('./modules/redpackets/redpackets.routes'));
app.use('/api/wallet',        require('./modules/wallet/wallet.routes'));
app.use('/api/turn',          require('./modules/turn/turn.routes'));
app.use('/api/admin',         require('./modules/admin/admin.routes'));
app.use('/api/friend-labels', require('./modules/contacts/friend_labels.routes'));

// 公开配置（前端读取功能开关，决定朋友圈/收藏入口显隐）
const { getFeatures } = require('./modules/admin/admin.service');
app.get('/api/config', (req, res) => res.json({ features: getFeatures() }));

// 健康检查（含数据库探测）
app.get('/health', (req, res) => {
  try {
    const db = require('./db');
    db.prepare('SELECT 1').get();
    res.json({ ok: true, version: 2, db: 'ok' });
  } catch (e) {
    res.status(503).json({ ok: false, version: 2, db: 'error', error: e.message });
  }
});

// ── 兜底 ────────────────────────────────────────────────────────
app.use(notFoundHandler);
sentry.attachSentryErrorHandler(app);
app.use(errorHandler);

module.exports = app;
