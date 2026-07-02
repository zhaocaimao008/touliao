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

module.exports = function setupRealtime(io, app) {
  broadcaster.setIo(io); // 广播调度器绑定 io 实例（分片削峰派发）

  // ── 握手鉴权（Cookie 优先，Electron 降级到 auth.token）──────
  io.use(async (socket, next) => {
    prodMetrics.recordConnAttempt(); // 监控：连接/重连成功率（每次握手即一次尝试）
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
      const user = db.prepare('SELECT banned, password_changed_at FROM users WHERE id=?').get(socket.user.id);
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

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const isFirstDevice = !presence.isOnline(userId);

    presence.addSocket(userId, socket.id);
    if (app) app.set('onlineUsers', presence.onlineUserIdSet());

    // 立即入 user 房间，会话房间延迟到下一 tick
    socket.join(`user_${userId}`);
    setImmediate(() => {
      try {
        const convIds = readDb.prepare('SELECT conversation_id FROM conversation_members WHERE user_id=?')
          .all(userId).map(c => c.conversation_id);
        if (convIds.length) socket.join(convIds);
      } catch (err) {
        console.error('[realtime] join rooms error:', err);
      }
    });

    presence.cacheProfile(userId);

    // 上线广播 / 多端同步
    if (isFirstDevice) {
      db.prepare('UPDATE users SET status=? WHERE id=?').run('online', userId);
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
        db.prepare('UPDATE users SET status=? WHERE id=?').run('offline', userId);
        presence.cleanupUser(userId);
        const contacts = readDb.prepare('SELECT contact_id FROM contacts WHERE user_id=?').all(userId);
        if (contacts.length) io.to(contacts.map(c => `user_${c.contact_id}`)).emit('user_offline', { userId });
      }
    });
  });
};
