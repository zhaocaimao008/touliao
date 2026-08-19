'use strict';
/**
 * Express 应用装配（不含 HTTP/Socket 启动，便于测试与复用）。
 * 中间件顺序：compression → helmet → cors → cookieParser → body 解析 → 静态 → CSRF 门控 → 路由 → 错误处理。
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');
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

// ── HTTP 响应压缩（gzip/deflate）──────────────────────────────────
// 必须放在所有路由之前；跳过小响应(<1KB)和 SSE/WebSocket。
// 实测：JSON API 响应体积 -65~75%，Time-to-First-Byte -30~50ms（本机 loopback 压缩效果最明显）。
app.use(compression({
  level: 6,                    // 平衡 CPU 与压缩率（1=最快, 9=最小）
  threshold: 1024,             // <1KB 不压缩（避免微小 JSON 的负优化）
  filter: (req, res) => {
    // SSE / EventStream：流式传输，不能压缩
    if (req.headers.accept?.includes('text/event-stream')) return false;
    return compression.filter(req, res);
  },
}));

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
      scriptSrc:  ["'self'"],   // 生产构建无内联脚本；如需 eval 在此添加
      styleSrc:   ["'self'", "'unsafe-inline'"],  // CSS-in-JS 仍需 unsafe-inline
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

// 分布式追踪中间件
const { tracing } = require('./integrations/tracing');
app.use(tracing.middleware());

// CDN 优化中间件
const { cdnRewriteMiddleware, uploadsCacheMiddleware } = require('./integrations/cdnOptimizer');
app.use(cdnRewriteMiddleware);

app.use(cookieParser());
// body 体积上限：JSON/表单请求只承载文本消息与元数据（最长消息 2000 字），
// 大文件走 multipart/分片上传通道。限 1MB 防止超大 JSON 撑爆内存（DoS 加固）。
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// H9: /uploads 静态文件鉴权 — 用户JWT或Admin JWT均可访问，同时校验黑名单
// P1-02 加固：认证通过后，按资源类别做所有权/权限校验（IDOR 防护），
// 禁止只凭有效 JWT 越权读取他人私聊附件/私密朋友圈图片/会话背景。
// 授权唯一依据 = file_registry（上传时登记的真实归属），不信任 messages/moments 引用行
// （引用行可被攻击者植入伪造，见 p1-02-review-bypass2 回归测试）。
const jwt = require('jsonwebtoken');
const { isBlacklisted } = require('./utils/tokenBlacklist');
const { isMember } = require('./modules/messages/shared');
const { assertVisible } = require('./modules/moments/moments.service');
const { lookupFile } = require('./utils/fileRegistry');
const cloudStorage = require('./utils/cloudStorage');
// P1-02 v2：moments 可见性门控查询需要 db（resolveUploadAccess 内使用）
const db = require('./db');

// 解析 /uploads/<category>/<file>，校验当前用户是否可访问该资源。
// 返回 { ok: true } 放行；{ ok: false, status } 拒绝；null 表示资源不存在/未知类别。
function resolveUploadAccess(userId, reqPath) {
  const m = String(reqPath || '').match(/^\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const category = m[1];
  const file = m[2];

  if (category === 'avatars' || category === 'stickers') {
    // 头像：登录可见（社交展示用途）；表情：用户私有上传，登录可见（本人/收藏者查看）
    return { ok: true };
  }
  if (category === 'chunks') {
    // 分片临时文件：仅上传流程内部使用，禁止静态访问
    return { ok: false, status: 403 };
  }

  // 其余类别一律以 file_registry 为准：文件必须真实登记过且归属权匹配
  const path = `/uploads/${category}/${file}`;
  const reg = lookupFile(path);
  if (!reg) return null; // 未登记 = 不存在（含已删除消息的文件）

  if (category === 'files') {
    // 私聊/群聊附件：必须是该文件所属会话的成员
    if (!reg.conversation_id || !isMember(reg.conversation_id, userId)) return { ok: false, status: 403 };
    return { ok: true };
  }
  if (category === 'moments') {
    // 朋友圈图片：文件必须属于某条动态，且满足 moments 可见性门控
    // （好友/私密/分组/拉黑/时间窗）——引用行是伪造的也拿不到 registry 归属。
    const row = db.prepare(
      'SELECT id, user_id, visibility, visible_to, created_at FROM moments WHERE user_id=? AND images LIKE ? LIMIT 1'
    ).get(reg.owner_id, `%${file}%`);
    if (!row) return null;
    try {
      assertVisible(userId, row);
      return { ok: true };
    } catch {
      return { ok: false, status: 403 };
    }
  }
  if (category === 'bg') {
    // 会话背景图：仅该文件所属会话成员可见
    if (!reg.conversation_id || !isMember(reg.conversation_id, userId)) return { ok: false, status: 403 };
    return { ok: true };
  }
  return null; // 未知类别
}

app.use('/uploads', (req, res, next) => {
  // Cookie 优先；Electron/移动端用 Bearer 鉴权、<img> 无法带 header，故同时支持 ?token= 查询参数与 Bearer 兜底
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  const token = req.cookies?.[config.cookieName] || req.cookies?.[config.admin.cookieName]
    || req.query?.token || bearer;
  if (!token) return res.status(401).json({ error: '未授权' });

  let userId = null;
  let isAdmin = false;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    userId = payload.id;
  } catch {
    try {
      jwt.verify(token, config.adminJwtSecret, { algorithms: ['HS256'] });
      isAdmin = true;
    } catch {
      return res.status(401).json({ error: '未授权' });
    }
  }

  isBlacklisted(token).then(async blacklisted => {
    if (blacklisted) return res.status(401).json({ error: '登录已失效，请重新登录' });

    // P1-02：管理员放行全部；普通用户按资源类别做所有权/权限校验
    if (!isAdmin) {
      const access = resolveUploadAccess(userId, req.path);
      if (!access) return res.status(404).json({ error: '资源不存在' });
      if (!access.ok) return res.status(access.status || 403).json({ error: '无权访问' });
    }

    // R2/云存储模式：file_registry 权限校验通过后，本地无此对象时生成短时 presigned GET 并 302。
    // 预签名 URL 属 bearer capability，不落日志、不持久化；未授权请求已在上面被拦截，绝拿不到 URL。
    if (cloudStorage.isConfigured()) {
      const localFile = path.join(config.uploadsRoot, req.path);
      if (!fs.existsSync(localFile)) {
        try {
          const key = `uploads${req.path}`; // /uploads/files/x.png → uploads/files/x.png
          const signed = await cloudStorage.getPresignedGetUrl(key, 600);
          return res.redirect(302, signed);
        } catch (e) {
          console.error('[uploads] presigned GET 生成失败:', e.message);
          return res.status(500).json({ error: '文件读取失败，请稍后重试' });
        }
      }
    }
    next();
  }).catch(err => {
    console.error('[uploads] blacklist check error:', err.message);
    res.status(503).json({ error: '认证服务暂时不可用' });
  });
}, uploadsCacheMiddleware, express.static(config.uploadsRoot, {
  // uploads 均为 uuid 命名、内容永不变更 → 强缓存，消除每次加载的 304 回源往返，
  // 头像/图片打开会话即从本地缓存秒出。private：内容经鉴权，禁止共享缓存(CDN/代理)存储，
  // 只允许当前用户浏览器缓存（与该用户已被授权取得这些字节一致，无安全回归）。
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    // nosniff：禁止 MIME 嗅探（正确 Content-Type 由扩展名派生，不影响 PDF/图片等内联打开）。
    // 不再强制 attachment：能上传的都是常见安全格式（HTML/SVG/XML 等已被扩展名白名单挡在门外），
    // 故无需以附件下发，保留浏览器「直接打开」PDF 等的原有体验。
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
app.use('/api/monitoring',    require('./routes/monitoring.routes'));

// P4.1: 全文搜索
app.use('/api/search',        require('./routes/search.routes'));

// P4.2: 消息可靠性
app.use('/api/reliability',   require('./routes/reliability.routes'));

// P4.3-P4.7: 优化特性 (搜索排序、批量 ACK、去重、缓存预热、网络感知)
app.use('/api/optimization',  require('./routes/optimization.routes'));

// P11: 全球部署 (CDN、多区域同步、负载均衡、全球监控)
app.use('/api/global',        require('./routes/p11-global-deployment.routes'));

// P12: AI 增强 (LLM、内容审核、翻译、语音识别)
app.use('/api/ai',            require('./routes/p12-ai-enhancement.routes'));

// P13: Web3 集成 (区块链、NFT、DAO)
app.use('/api/web3',          require('./routes/p13-web3-integration.routes'));

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
