'use strict';
/**
 * Socket.io 装配：
 *   - io.use 鉴权：仅从 Cookie 提取 JWT（不接受 handshake.auth.token，S1 修复）
 *   - connection：入 user 房间、延迟入会话房间、上线广播、注册各域 handler
 *   - disconnect：清理 typing、下线广播
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { db, readDb } = require('../db/connection');
const { isBlacklisted } = require('../utils/tokenBlacklist');
const presence = require('./presence');
const broadcaster = require('./broadcaster');
const prodMetrics = require('../utils/prodMetrics');

const registerMessage = require('./handlers/message');
const registerFile    = require('./handlers/file');
const registerTyping  = require('./handlers/typing');
const registerNudge   = require('./handlers/nudge');
const registerCall    = require('./handlers/call');
const registerGroupCall = require('./handlers/groupCall');

// P1-07 SOCKET-004：每用户并发 socket 上限，防连接洪泛 DoS。
// 正常多端 ≤ 3~4 台，留余量到 5。超额连接在握手阶段直接拒绝（不进入 DB 查询链）。
const MAX_SOCKETS_PER_USER = 5;

// P1-07 增强：per-IP 握手频率限制（防单 IP 换多个账号批量建连耗尽握手/DB 查询）。
// 60s 窗口内同一 IP 最多 30 次握手尝试，超限拒绝。条目带过期清理防 Map 增长。
const IP_HANDSHAKE_WINDOW_MS = 60 * 1000;
const IP_HANDSHAKE_MAX = 30;
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

module.exports = function setupRealtime(io, app) {
  broadcaster.setIo(io); // 广播调度器绑定 io 实例（分片削峰派发）

  // ── 握手鉴权（Cookie 优先，Electron 降级到 auth.token）──────
  io.use(async (socket, next) => {
    prodMetrics.recordConnAttempt(); // 监控：连接/重连成功率（每次握手即一次尝试）
    // P1-07 增强：per-IP 握手频率限制（先于 JWT 验证，挡住廉价批量握手风暴）
    const ip = socket.handshake.address || 'unknown';
    if (!checkIpHandshake(ip)) {
      prodMetrics.recordConnResult(false);
      return next(new Error('连接过于频繁，请稍后再试'));
    }
    pruneIpHandshake();
    const cookieHeader = socket.handshake.headers.cookie || '';
    const match = cookieHeader.match(new RegExp(`${config.cookieName}=([^;]+)`));
    const cookieToken = match ? decodeURIComponent(match[1]) : null;
    const bearerToken = socket.handshake.auth?.token || null;
    const token = cookieToken || bearerToken;
    if (!token) { prodMetrics.recordConnResult(false); return next(new Error('未授权')); }
    try {
      socket.user = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      // 黑名单（logout / 强制下线的 token 不得接入）
      if (await isBlacklisted(token)) {
        prodMetrics.recordConnResult(false);
        return next(new Error('Token已失效，请重新登录'));
      }
      // 检查封禁状态 + password_changed_at（与 HTTP auth 中间件等价）
      const user = readDb.prepare('SELECT banned, password_changed_at FROM users WHERE id=?').get(socket.user.id);
      if (user?.banned) { prodMetrics.recordConnResult(false); return next(new Error('账号已被封禁')); }
      if (user?.password_changed_at && socket.user.iat < user.password_changed_at) {
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

    presence.addSocket(userId, socket.id);
    if (app) app.set('onlineUsers', presence.onlineUserIdSet());

    // 立即入 user 房间，会话房间延迟到下一 tick
    socket.join(`user_${userId}`);
    setImmediate(() => {
      try {
        // 限制加入房间数上限：极端情况下（用户在数千个群）无上限 join 会阻塞事件循环。
        // 500 与 maxGroupMembers 配置一致，覆盖绝大多数正常使用场景。
        const MAX_ROOMS = 500;
        const convIds = readDb.prepare(
          'SELECT conversation_id FROM conversation_members WHERE user_id=? LIMIT ?'
        ).all(userId, MAX_ROOMS).map(c => c.conversation_id);
        if (convIds.length) socket.join(convIds);
      } catch (err) {
        console.error('[realtime] join rooms error:', err);
      }
    });

    presence.cacheProfile(userId);

    // 上线广播 / 多端同步
    if (isFirstDevice) {
      db.prepare('UPDATE users SET status=?, last_online_at=? WHERE id=?').run('online', Math.floor(Date.now()/1000), userId);
      const contacts = readDb.prepare('SELECT contact_id FROM contacts WHERE user_id=?').all(userId);
      if (contacts.length) io.to(contacts.map(c => `user_${c.contact_id}`)).emit('user_online', { userId });
    } else {
      socket.to(`user_${userId}`).emit('sync:device_connected', { socketId: socket.id });
    }

    // 注册各域 handler
    registerMessage(io, socket);
    registerFile(io, socket);
    const typing = registerTyping(io, socket);
    registerCall(io, socket);
    registerGroupCall(io, socket);
    registerNudge(io, socket);

    // ── 断线 ──────────────────────────────────────────────────
    socket.on('disconnect', () => {
      typing.cleanup();
      const isLastDevice = presence.removeSocket(userId, socket.id);
      if (app) app.set('onlineUsers', presence.onlineUserIdSet());
      if (isLastDevice) {
        db.prepare('UPDATE users SET status=?, last_online_at=? WHERE id=?').run('offline', Math.floor(Date.now()/1000), userId);
        presence.cleanupUser(userId);
        const contacts = readDb.prepare('SELECT contact_id FROM contacts WHERE user_id=?').all(userId);
        if (contacts.length) io.to(contacts.map(c => `user_${c.contact_id}`)).emit('user_offline', { userId });
      }
    });
  });
};

// ── P1-07 测试钩子（生产无副作用，仅断言限流内部状态）──────────
module.exports.MAX_SOCKETS_PER_USER = MAX_SOCKETS_PER_USER;
module.exports.checkIpHandshake = checkIpHandshake;
module.exports.ipHandshakeSize = () => ipHandshake.size;
module.exports._resetIpHandshake = () => ipHandshake.clear();
