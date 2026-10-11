'use strict';
/**
 * Socket.io 装配：
 *   - io.use 鉴权：仅从 Cookie 提取 JWT（不接受 handshake.auth.token，S1 修复）
 *   - connection：入 user 房间、延迟入会话房间、上线广播、注册各域 handler
 *   - disconnect：清理 typing、下线广播
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { readDb } = require('../db/connection');
const { write } = require('../db/writer');
const { isBlacklisted } = require('../utils/tokenBlacklist');
const { hasActiveSession, passwordRevoked, tokenRoom } = require('../utils/sessionAuthorization');
const presence = require('./presence');
const broadcaster = require('./broadcaster');
const prodMetrics = require('../utils/prodMetrics');
const { isIP } = require('net');

const registerMessage = require('./handlers/message');
const registerFile    = require('./handlers/file');
const registerTyping  = require('./handlers/typing');
const registerNudge   = require('./handlers/nudge');
const registerCall    = require('./handlers/call');
const registerGroupCall = require('./handlers/groupCall');
const createCallSessionRegistry = require('./callSessionRegistry');

// P1-07 SOCKET-004：每用户并发 socket 上限，防连接洪泛 DoS。
// 正常多端 ≤ 3~4 台，留余量到 5。超额连接在握手阶段直接拒绝（不进入 DB 查询链）。
const MAX_SOCKETS_PER_USER = 5;

// Q12 全修：会话数超过 AUTO_JOIN_MAX_ROOMS 时，自动订阅哪 500 个必须跟会话列表
// listConversations 展示的前 N 个口径一致（置顶优先、最近活跃优先），否则超限用户
// 列表里最新的会话可能不在自动订阅集合里——正文/sync_available 广播发到会话房间，
// 该用户收不到，预览延迟到手动打开会话才补订阅（typing.js 的 join_conversation）。
// 抽成具名导出函数，便于直接单测排序/截断行为，不用为此起真实 socket 连接跑 500+ 房间。
const AUTO_JOIN_MAX_ROOMS = 500;
// 2026-10-11 性能：旧实现 LEFT JOIN 派生表 `SELECT conversation_id, MAX(created_at) FROM messages
// WHERE deleted=0 GROUP BY conversation_id`，ON 条件引用 cm，SQLite 无法把它下推进聚合，
// 每次 socket 连接都 MATERIALIZE 全站所有会话的 MAX（全量 SCAN messages 索引），成本随全站
// 历史消息线性增长，重启后的重连潮会背靠背跑这条全表聚合。改为 ORDER BY 里的相关标量子查询：
// 只对该用户自己的会话逐个取 MAX，走 idx_messages_conv_del_time 的 min/max 单次索引查找
// （mx.deleted = 0 必须保持等值条件才能命中）。语义不变：会话无未删消息时 MAX 为 NULL，
// 与旧 LEFT JOIN 未命中一致，照旧回落 c.created_at；置顶优先 + c.id DESC 兜底保持跟列表口径一致。
// 函数以 db 为参数（单测传自己的连接），不能在模块顶层 prepare，按连接缓存语句免每次连接重编译。
const autoJoinStmts = new WeakMap(); // db → Statement
function autoJoinConversationIds(db, userId, limit = AUTO_JOIN_MAX_ROOMS) {
  let stmt = autoJoinStmts.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      SELECT cm.conversation_id AS conversation_id
      FROM conversation_members cm
      LEFT JOIN conversation_settings cs ON cs.conversation_id = cm.conversation_id AND cs.user_id = cm.user_id
      LEFT JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.user_id = ?
      ORDER BY COALESCE(cs.pinned, 0) DESC,
        COALESCE((SELECT MAX(mx.created_at) FROM messages mx WHERE mx.conversation_id = cm.conversation_id AND mx.deleted = 0), c.created_at) DESC,
        c.id DESC
      LIMIT ?
    `);
    autoJoinStmts.set(db, stmt);
  }
  return stmt.all(userId, limit).map(c => c.conversation_id);
}

// P1-07 增强：per-IP 握手频率限制（防单 IP 换多个账号批量建连耗尽握手/DB 查询）。
// 60s 窗口内同一 IP 最多 30 次握手尝试，超限拒绝。条目带过期清理防 Map 增长。
const IP_HANDSHAKE_WINDOW_MS = 60 * 1000;
const IP_HANDSHAKE_MAX = 30;
// Independent process-wide protection; never use the proxy's IP as the site quota.
const GLOBAL_HANDSHAKE_MAX = 6000;
let globalHandshake = { count: 0, resetAt: 0 };
function normalizeIp(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}
// 2026-10-11：拆出 (address, headers) 版本，engine.io allowRequest（只有原始 req）与 io.use
// （socket.handshake）共用同一套归一化 + 回环信任规则，两条路径算出的限流 key 必须一致。
function clientIp(address, headers) {
  const peer = normalizeIp(address);
  // Deployed nginx connects over loopback and overwrites X-Real-IP with $remote_addr.
  // Do not trust XFF, arbitrary LAN peers, or client-supplied lists of addresses.
  if (peer === '127.0.0.1' || peer === '::1') {
    return normalizeIp(headers?.['x-real-ip']) || peer;
  }
  return peer || 'unknown';
}
function handshakeIp(socket) {
  return clientIp(socket.handshake.address, socket.handshake.headers);
}
function checkGlobalHandshake() {
  const now = Date.now();
  if (now >= globalHandshake.resetAt) globalHandshake = { count: 0, resetAt: now + IP_HANDSHAKE_WINDOW_MS };
  return ++globalHandshake.count <= GLOBAL_HANDSHAKE_MAX;
}
const ipHandshake = new Map(); // ip → { count, resetAt }
function checkIpHandshake(ip) {
  const now = Date.now();
  const r = ipHandshake.get(ip);
  if (!r || now >= r.resetAt) {
    ipHandshake.set(ip, { count: 1, resetAt: now + IP_HANDSHAKE_WINDOW_MS });
    return true;
  }
  if (r.count >= IP_HANDSHAKE_MAX) return false;
  r.count += 1;
  return true;
}
// 惰性清理：每 1000 次拒绝检查时清一次过期条目，避免 Map 无限增长
let ipHandshakeChecks = 0;
function pruneIpHandshake() {
  ipHandshakeChecks += 1;
  if (ipHandshakeChecks % 1000 !== 0) return;
  const now = Date.now();
  for (const [k, v] of ipHandshake) {
    if (now >= v.resetAt) ipHandshake.delete(k);
  }
}

// 2026-10-11：限流判定收成一处，engine.io allowRequest 与 io.use 兜底共用同一套计数与顺序。
// 先 per-IP 再全局（短路）：被单 IP 限流拒掉的请求不消耗全局预算（原 io.use 内的既有约定）。
// 返回 null 表示放行，否则返回拒绝原因文案。
function throttleHandshake(ip) {
  if (!checkIpHandshake(ip)) return '连接过于频繁，请稍后再试';
  pruneIpHandshake();
  if (!checkGlobalHandshake()) return '服务繁忙，请稍后再试';
  return null;
}

// 2026-10-11：限流拒绝此前不留任何痕迹（prodMetrics 只有 connFail 总数），线上无法判断是否触发过。
// 限频日志：每 60s 至多一行，带自上次记录以来的累计次数；重连潮 / CGNAT 下被拒客户端会按退避
// 反复重试，逐条打会刷屏。
let throttleLogAt = 0;
let throttleRejects = 0;
function logHandshakeThrottled(reason, ip) {
  throttleRejects += 1;
  const now = Date.now();
  if (now - throttleLogAt < IP_HANDSHAKE_WINDOW_MS) return;
  console.warn(`[realtime] 握手限流拒绝 ${throttleRejects} 次（最近一次：${reason} ip=${ip}）`);
  throttleLogAt = now;
  throttleRejects = 0;
}

// 2026-10-11：握手限流前移到 engine.io 的 allowRequest。
// 旧实现在 io.use 里 next(new Error('…请稍后再试')) 拒绝——那是命名空间级 CONNECT_ERROR，
// socket.io-client v4 收到后直接 socket.destroy()（清掉 Manager 订阅，不再自动重连），
// 而 Web/桌面/Android/iOS 的 connect_error 处理只对鉴权类文案重连；结果限流一旦命中，
// 前台常驻的窗口就一直离线（收不到消息/来电），直到切 tab、网络变化或重启 App。
// allowRequest 拒绝发生在 HTTP 层（websocket upgrade 直接回 4xx 并断开；polling 回 403），
// 客户端视为 transport error，Manager 按既有退避（1~10s、无限次）自动重试；被拒的请求不计
// per-IP 次数，窗口滚动后自然放行。限额与计数逻辑不变（同一个 throttleHandshake）。
// allowRequest 只在新握手（无 sid）时调用，一个 engine 连接计一次——本项目只用默认命名空间，
// 与原「每次命名空间握手计一次」等价。放行的 req 打上一次性标记，io.use 里首个 CONNECT 抵扣、
// 避免同一握手被计两次（同连接上后续 CONNECT 照旧计数）；
// 拿不到 io.engine 的测试桩（假 io 对象）不打标记，照旧在 io.use 里限流（兜底路径）。
const ENGINE_THROTTLE_MARK = Symbol('touliao.engineHandshakeThrottle');
function installEngineHandshakeThrottle(io) {
  const engine = io && io.engine;
  if (!engine || !engine.opts) return false;
  const prior = engine.opts.allowRequest;
  if (prior && prior[ENGINE_THROTTLE_MARK]) return true; // 同一 io 重复 setup 不重复包装（否则一次握手计两次）
  const allowRequest = (req, callback) => {
    const throttle = () => {
      const ip = clientIp(req.socket?.remoteAddress, req.headers);
      const reason = throttleHandshake(ip);
      if (reason) {
        // 与 io.use 路径口径一致：被限流的握手同样计一次尝试 + 一次失败
        prodMetrics.recordConnAttempt();
        prodMetrics.recordConnResult(false);
        logHandshakeThrottled(reason, ip);
        return callback(reason, false);
      }
      req[ENGINE_THROTTLE_MARK] = true;
      callback(null, true);
    };
    // 已有的 allowRequest（如有）先跑：被它拒掉的请求不该消耗限流预算，与旧顺序（engine 放行后才进 io.use）一致
    if (typeof prior !== 'function') return throttle();
    prior(req, (message, success) => (success ? throttle() : callback(message, false)));
  };
  allowRequest[ENGINE_THROTTLE_MARK] = true;
  engine.opts.allowRequest = allowRequest;
  return true;
}

module.exports = function setupRealtime(io, app) {
  broadcaster.setIo(io); // 广播调度器绑定 io 实例（分片削峰派发）
  const callRegistry = createCallSessionRegistry({
    graceMs: config.calls.reconnectGraceMs,
    onGraceExpired: info => {
      if (info.kind === 'group') registerGroupCall.handleGraceExpired(io, callRegistry, info);
      else registerCall.handleGraceExpired(io, callRegistry, info);
    },
  });

  // 握手限流挂到 engine.io allowRequest（拒绝可被客户端自动重试，见 installEngineHandshakeThrottle）
  installEngineHandshakeThrottle(io);

  // ── 握手鉴权（Cookie 优先，Electron 降级到 auth.token）──────
  io.use(async (socket, next) => {
    prodMetrics.recordConnAttempt(); // 监控：连接/重连成功率（每次握手即一次尝试）
    // P1-07 增强：per-IP 握手频率限制（先于 JWT 验证，挡住廉价批量握手风暴）
    // 2026-10-11：engine.io allowRequest 已对本次握手计数放行时跳过（不重复计数）；
    // 没挂上 engine 层（假 io 测试桩）时仍在此限流兜底。标记只抵扣一次：同一条 engine 连接上
    // 可以反复发 CONNECT 包（每次都跑一遍 JWT/黑名单/DB 校验），从第二次起照旧在这里计数限流，
    // 不能让一次 allowRequest 放行变成无限次免检握手。
    // Rejected single-IP traffic must not drain the independent global budget（顺序见 throttleHandshake）。
    if (socket.request?.[ENGINE_THROTTLE_MARK]) {
      socket.request[ENGINE_THROTTLE_MARK] = false;
    } else {
      const ip = handshakeIp(socket);
      const reason = throttleHandshake(ip);
      if (reason) {
        prodMetrics.recordConnResult(false);
        logHandshakeThrottled(reason, ip);
        return next(new Error(reason));
      }
    }
    try {
      const cookieHeader = socket.handshake.headers.cookie || '';
      const match = cookieHeader.match(new RegExp(`${config.cookieName}=([^;]+)`));
      const cookieToken = match ? decodeURIComponent(match[1]) : null;
      const bearerToken = socket.handshake.auth?.token || null;
      const token = socket.handshake.auth?.isolated === true ? bearerToken : cookieToken || bearerToken;
      if (!token) { prodMetrics.recordConnResult(false); return next(new Error('未授权')); }
      socket.user = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      socket.authToken = token;
      // 黑名单（logout / 强制下线的 token 不得接入）
      if (await isBlacklisted(token)) {
        prodMetrics.recordConnResult(false);
        return next(new Error('Token已失效，请重新登录'));
      }
      // A004 复审 FAIL-2：被删会话的 JWT（payload.jti）已加入 jti 黑名单，
      // 握手必须一并校验，否则旧 JWT 可新建 socket 连接并发消息。
      if (socket.user.jti && ((await isBlacklisted(`jti:${socket.user.jti}`)) || !hasActiveSession(socket.user))) {
        prodMetrics.recordConnResult(false);
        return next(new Error('会话已失效，请重新登录'));
      }
      // 检查封禁状态 + password_changed_at（与 HTTP auth 中间件等价）
      const user = readDb.prepare('SELECT banned, password_changed_at FROM users WHERE id=?').get(socket.user.id);
      // A004 复审 FAIL-3：admin 硬删除用户后用户行不存在，旧 JWT 不得再接入。
      if (!user) {
        prodMetrics.recordConnResult(false);
        return next(new Error('用户不存在，请重新登录'));
      }
      if (user?.banned) { prodMetrics.recordConnResult(false); return next(new Error('账号已被封禁')); }
      if (passwordRevoked(socket.user, user.password_changed_at)) {
        prodMetrics.recordConnResult(false);
        return next(new Error('密码已修改，请重新登录'));
      }
      prodMetrics.recordConnResult(true);
      next();
    } catch {
      prodMetrics.recordConnResult(false);
      next(new Error('Token无效'));
    }
  });

  // P1-07 SOCKET-004：每用户并发连接数上限，防连接洪泛 DoS。
  // 插在鉴权中间件之后（按注册顺序执行，此时 socket.user 已填充）。
  // 正常多端 ≤ 4 台，留余量到 5；超额连接在握手阶段直接拒绝，
  // 不进入 connection 事件（避免后续房间/联系人 DB 查询链放大）。
  // 注：JWT verify + isBlacklisted + 用户状态查询在计数检查前已执行（鉴权必需），
  // 连接洪泛的剩余放大由 per-IP 握手限流（60s/30 次）兜底。
  io.use((socket, next) => {
    if (!socket.user) return next(new Error('未授权'));
    const n = presence.onlineUsers.get(socket.user.id)?.size || 0;
    if (n >= MAX_SOCKETS_PER_USER) {
      prodMetrics.recordConnResult(false);
      return next(new Error('连接数超限，请关闭其他设备'));
    }
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const isFirstDevice = !presence.isOnline(userId);

    // Passive clients never enter socket.use: expire their receive access too.
    // Node timers overflow above ~24.8 days, so re-arm long-lived credentials.
    let expiryTimer;
    socket.once('disconnect', () => clearTimeout(expiryTimer));
    function scheduleExpiry() {
      const remaining = socket.user.exp * 1000 - Date.now();
      if (remaining <= 0) {
        socket.emit('session_expired', { reason: 'Token已过期，请重新登录' });
        socket.disconnect(true);
        return;
      }
      expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, 2 ** 31 - 1));
      expiryTimer.unref();
    }
    if (Number.isFinite(socket.user.exp)) scheduleExpiry();
    if (!socket.connected) return;

    // A004 复审 FAIL-1：会话被删除/失效后，已建立的 socket 不得继续发消息。
    // 逐事件复检（socket.use 在每事件 handler 前执行）：
    //  - jti 黑名单（logout 删会话 → 立即失效，不等断开重连）
    //  - 用户存在性 / banned（admin 硬删用户 → 立即失效）
    //  - password_changed_at / exp（改密码 / token 自然过期 → 立即失效，与握手鉴权 :95-98
    //    和 HTTP 中间件 middleware/auth.js 的检查对齐，见 AUDIT.md 七节两条🟡）
    socket.use(async ([event, ...args], next) => {
      try {
        if ((await isBlacklisted(socket.authToken)) ||
            (socket.user?.jti && (await isBlacklisted(`jti:${socket.user.jti}`))) || !hasActiveSession(socket.user)) {
          prodMetrics.recordConnResult(false);
          socket.emit('session_expired', { reason: '会话已失效，请重新登录' });
          socket.disconnect(true);
          return next(new Error('会话已失效'));
        }
        if (socket.user?.exp && Math.floor(Date.now() / 1000) >= socket.user.exp) {
          prodMetrics.recordConnResult(false);
          socket.emit('session_expired', { reason: 'Token已过期，请重新登录' });
          socket.disconnect(true);
          return next(new Error('Token已过期'));
        }
        const u = readDb.prepare('SELECT banned, password_changed_at FROM users WHERE id=?').get(socket.user.id);
        if (!u || u.banned) {
          prodMetrics.recordConnResult(false);
          socket.disconnect(true);
          return next(new Error('账号不可用'));
        }
        if (passwordRevoked(socket.user, u.password_changed_at)) {
          prodMetrics.recordConnResult(false);
          socket.emit('session_expired', { reason: '密码已修改，请重新登录' });
          socket.disconnect(true);
          return next(new Error('密码已修改'));
        }
        next();
      } catch {
        // 鉴权检查自身异常（如写库繁忙导致查询抛错）时 fail-closed：拒绝本次事件（安全优先），
        // 但不断开连接——服务端主动断开后 iOS 客户端不会自动重连，会一直停在「断开」直到重启 App。
        // 凭据真失效的情况在上面各分支已明确断开；这里只是暂时查不了，下个事件会重新检查。
        next(new Error('鉴权检查失败'));
      }
    });

    // 客户端握手 auth.platform 上报设备类型（'web'|'desktop'|'android'|'ios'），
    // 用于来电推送兜底按平台维度判定在线（见 presence.onlinePlatforms + call.js）。
    // 旧客户端未上报时归为 'unknown'，不影响既有账号级 isOnline 语义。
    const platform = typeof socket.handshake?.auth?.platform === 'string'
      ? socket.handshake.auth.platform.slice(0, 20)
      : 'unknown';
    presence.addSocket(userId, socket.id, platform);
    if (app) app.set('onlineUsers', presence.onlineUserIdSet());

    // 立即入 user 房间，会话房间延迟到下一 tick
    socket.join(`user_${userId}`);
    socket.join(socket.user.jti ? `session_${socket.user.jti}` : `legacy_user_${userId}`);
    socket.join(tokenRoom(socket.authToken));
    setImmediate(() => {
      if (!socket.connected) return;
      try {
        // 限制加入房间数上限：极端情况下（用户在数千个群）无上限 join 会阻塞事件循环。
        // 500 与 maxGroupMembers 配置一致，覆盖绝大多数正常使用场景。
        const convIds = autoJoinConversationIds(readDb, userId);
        if (convIds.length) socket.join(convIds);
      } catch (err) {
        console.error('[realtime] join rooms error:', err);
      }
    });

    presence.cacheProfile(userId);

    // 上线广播 / 多端同步
    if (isFirstDevice) {
      // 走 worker 写连接（fire-and-forget），避免跟主线程 db 争抢 WAL 写锁——
      // 上线/下线状态更新是全站最高频的写操作之一，之前跟主线程 db 用同一把锁，
      // 是 2026-08-24 dbWriter 队列堆到 5万+深度那次事故的根因之一。
      write('UPDATE users SET status=?, last_online_at=? WHERE id=?', ['online', Math.floor(Date.now()/1000), userId]);
      const contacts = readDb.prepare('SELECT contact_id FROM contacts WHERE user_id=?').all(userId);
      if (contacts.length) io.to(contacts.map(c => `user_${c.contact_id}`)).emit('user_online', { userId });
    } else {
      socket.to(`user_${userId}`).emit('sync:device_connected', { socketId: socket.id });
    }

    // 注册各域 handler
    registerMessage(io, socket);
    registerFile(io, socket);
    const typing = registerTyping(io, socket);
    registerCall(io, socket, callRegistry);
    registerGroupCall(io, socket, callRegistry);
    registerNudge(io, socket);

    // ── 断线 ──────────────────────────────────────────────────
    socket.on('disconnect', () => {
      typing.cleanup();
      const isLastDevice = presence.removeSocket(userId, socket.id);
      if (app) app.set('onlineUsers', presence.onlineUserIdSet());
      if (isLastDevice) {
        write('UPDATE users SET status=?, last_online_at=? WHERE id=?', ['offline', Math.floor(Date.now()/1000), userId]);
        presence.cleanupUser(userId);
        const contacts = readDb.prepare('SELECT contact_id FROM contacts WHERE user_id=?').all(userId);
        if (contacts.length) io.to(contacts.map(c => `user_${c.contact_id}`)).emit('user_offline', { userId });
      }
    });
  });
};

// ── P1-07 测试钩子（生产无副作用，仅断言限流内部状态）──────────
module.exports.MAX_SOCKETS_PER_USER = MAX_SOCKETS_PER_USER;
module.exports.autoJoinConversationIds = autoJoinConversationIds;
module.exports.AUTO_JOIN_MAX_ROOMS = AUTO_JOIN_MAX_ROOMS;
module.exports.checkIpHandshake = checkIpHandshake;
module.exports.ipHandshakeSize = () => ipHandshake.size;
module.exports.GLOBAL_HANDSHAKE_MAX = GLOBAL_HANDSHAKE_MAX;
module.exports._resetIpHandshake = () => { ipHandshake.clear(); globalHandshake = { count: 0, resetAt: 0 }; };
