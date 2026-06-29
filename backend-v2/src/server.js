'use strict';
/**
 * 启动入口：HTTP server + Socket.io + 实时层装配 + 监听。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const config = require('./config');
const app = require('./app');
const setupRealtime = require('./realtime');
const { shutdown: shutdownWriter } = require('./db/writer');
const { db } = require('./db/connection');

// 确保上传目录存在
['avatars', 'files', 'stickers', 'moments'].forEach(d => fs.mkdirSync(path.join(config.uploadsRoot, d), { recursive: true }));

const server = http.createServer(app);

const io = new Server(server, {
  transports: ['websocket'], // 仅 websocket 防集群握手死锁
  pingInterval: 25000,  // 25s 心跳间隔
  pingTimeout: 20000,   // 20s 无响应视为断线
  cors: {
    origin: config.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

// 让 HTTP 路由层能拿到 io 与在线用户集合
app.set('io', io);
app.set('onlineUsers', new Set());

setupRealtime(io, app);

// 生产监控：启动周期采样器（ELD>500ms / Worker队列>3000 / 内存>80% 自动告警）
require('./utils/prodMetrics').startSampler();

// ── 定时维护（每10分钟）─────────────────────────────────────────
//   1) 红包过期回收：24h 未领完的标记 expired，剩余金额退回发送者钱包（reclaimExpired）
//   2) 清理过期群邀请令牌
//   启动时立即跑一次回收（startExpiryReclaim 内含首扫 + 自身10分钟定时）。
const MAINT_INTERVAL = 10 * 60 * 1000;
const { startExpiryReclaim } = require('./modules/redpackets/redpackets.service');
startExpiryReclaim();
setInterval(() => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const tok = db.prepare('DELETE FROM group_invite_tokens WHERE expires_at < ?').run(now);
    if (tok.changes) console.log(`[maintenance] 清理过期群邀请 ${tok.changes}`);
  } catch (e) {
    console.warn('[maintenance] 失败:', e.message);
  }
}, MAINT_INTERVAL).unref();

server.listen(config.port, '127.0.0.1', () => {
  console.log(`v信后端 v2 已启动: http://127.0.0.1:${config.port}  (env=${config.env})`);
});

// 优雅退出：通知 worker flush 落盘后再退出（pm2 restart / 停服时不丢写）
let _closing = false;
function graceful(sig) {
  if (_closing) return;
  _closing = true;
  console.log(`[server] 收到 ${sig}，优雅退出中…`);
  try { shutdownWriter(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => graceful('SIGTERM'));
process.on('SIGINT',  () => graceful('SIGINT'));

// ── 进程级兜底：绝不因单个请求/socket 的异步异常拖垮整个进程 ──────────
// Node 20 默认会因未处理的 Promise rejection 直接退出进程——对一台扛着上千
// WebSocket 长连接的聊天服务器，这意味着一条坏消息就能让所有人掉线。
// 这里记录日志并继续运行（rejection 不会破坏全局状态）。
process.on('unhandledRejection', (reason) => {
  console.error('[server] 未处理的 Promise rejection（已兜底，进程继续）:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] 未捕获异常（已兜底，进程继续）:', err);
});

module.exports = { server, io };
