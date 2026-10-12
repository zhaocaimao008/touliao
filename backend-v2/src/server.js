'use strict';
/**
 * 启动入口：HTTP server + Socket.io + 实时层装配 + 监听。
 */

// ⚠️ 必须最先加载 .env，否则 TRACING_ENABLED 等环境变量在追踪初始化时尚未注入
// 2026-10-12：按 backend-v2 根目录绝对路径加载，不依赖 cwd（cwd 不同时某些进程读不到 .env，REDIS_URL 等出现「已配置却未生效」）
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
// console.debug 在 Node 里等同 console.log 会直接进 pm2 out.log；代码里写 console.debug 的本意都是「调试级」，
// 默认（LOG_LEVEL 非 debug）静默，与 winston logger 的级别保持一致。
if ((process.env.LOG_LEVEL || 'info') !== 'debug') console.debug = () => {};

// ⚠️ 追踪插桩必须在所有 require 之前（auto-instrumentations 依赖此时序）
const { tracing } = require('./integrations/tracing');

async function startServer() {
  // 初始化分布式追踪（必须同步等待完成）
  await tracing.initialize({ enabled: process.env.TRACING_ENABLED !== 'false' }).catch(err => {
    console.warn('[Tracing] 初始化失败，将降级运行:', err.message);
  });

  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const { Server } = require('socket.io');
  const config = require('./config');
  const app = require('./app');
  const setupRealtime = require('./realtime');
  const { shutdown: shutdownWriter } = require('./db/writer');
  const { db } = require('./db/connection');
  const { reconcileInterruptedCalls } = require('./realtime/callReconciler');

  // 初始化 Redis 缓存
  const { redisCache } = require('./integrations/redisCache');
  await redisCache.connect().catch(err => {
    console.warn('[Redis] 连接失败，将降级运行:', err.message);
  });

  // P4.1: 初始化 FTS5 全文搜索索引
  const { initFTS5 } = require('./utils/ftsSearch');
  try {
    initFTS5();
    console.log('[FTS5] 全文搜索引擎已初始化');
  } catch (err) {
    console.warn('[FTS5] 初始化失败，将降级运行:', err.message);
  }

  // P4.2: 初始化消息队列
  const MessageQueue = require('./utils/messageQueue');
  const AckManager = require('./utils/ackManager');
  const msgQueue = new MessageQueue({ maxRetries: 3, retryDelayMs: 5000 });
  const ackManager = new AckManager({ ackTtl: 86400 });

  // P4.3: 初始化搜索排序引擎
  const SearchRanking = require('./utils/searchRanking');
  const searchRanking = new SearchRanking({
    relevanceWeight: 0.4,
    recencyWeight: 0.3,
    popularityWeight: 0.3,
  });
  console.log('[P4.3] 搜索排序引擎已初始化');

  // P4.4: 初始化消息去重管理
  const MessageDeduplicator = require('./utils/deduplicator');
  const deduplicator = new MessageDeduplicator({ dedupTTL: 86400 });
  console.log('[P4.4] 消息去重管理已初始化');

  // P4.5: 初始化批量 ACK 管理
  const BatchAckManager = require('./utils/batchAckManager');
  const batchAckManager = new BatchAckManager({
    batchSize: 50,
    batchTimeout: 1000,
  });
  console.log('[P4.5] 批量 ACK 管理已初始化');

  // P4.6: 初始化缓存预热
  const CacheWarmer = require('./utils/cacheWarmer');
  const cacheWarmer = new CacheWarmer({
    maxActiveUsers: 1000,
    maxHotMessages: 10000,
    hotDays: 7,
  });
  // 异步执行缓存预热，不阻塞启动。2026-10-12：未配置 REDIS_URL（redisCache 没有 client）时不预热——
  // 原来照样每小时 SELECT 上千用户/上万消息写进 no-op 对象，纯浪费。
  if (redisCache.client) {
    cacheWarmer.warmAll().then(results => {
      console.log('[P4.6] 缓存预热完成:', results.duration, 'ms');
      cacheWarmer.startPeriodicWarming(60 * 60 * 1000); // 每小时更新一次
    }).catch(err => {
      console.warn('[P4.6] 缓存预热失败:', err.message);
    });
  } else {
    console.log('[P4.6] Redis 未配置，跳过缓存预热');
  }

  // P4.7: 初始化网络感知重试
  const NetworkAwareRetry = require('./utils/networkAwareRetry');
  const networkAware = new NetworkAwareRetry();
  networkAware.detectNetworkQuality().then(quality => {
    console.log('[P4.7] 网络质量检测完成:', quality);
    networkAware.startMonitoring(30000); // 每 30 秒检测一次
  });

  // P4.8: 初始化通知队列系统
  const NotificationQueue = require('./modules/notifications/notificationQueue');
  const notificationQueue = new NotificationQueue({ maxRetries: 3, retryDelayMs: 5000 });
  notificationQueue.startProcessing();
  console.log('[P4.8] 通知异步队列已初始化，开始后台处理');

  // 初始化用户相关字段（SQLite 兼容性处理）
  try {
    db.prepare('ALTER TABLE users ADD COLUMN phone TEXT').run();
  } catch (e) {
    // 列已存在，忽略错误
  }
  try {
    db.prepare('ALTER TABLE users ADD COLUMN dingtalk_id TEXT').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE users ADD COLUMN wechat_work_id TEXT').run();
  } catch (e) {}
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)').run();
  } catch (e) {}

  // 挂到 app 全局访问
  app.set('msgQueue', msgQueue);
  app.set('ackManager', ackManager);
  app.set('searchRanking', searchRanking);
  app.set('deduplicator', deduplicator);
  app.set('batchAckManager', batchAckManager);
  app.set('cacheWarmer', cacheWarmer);
  app.set('networkAware', networkAware);
  app.set('notificationQueue', notificationQueue);
  console.log('[P4.2-P4.8] 所有 P4 优化模块已初始化');

  // 确保上传目录存在
  ['avatars', 'files', 'stickers', 'moments'].forEach(d => fs.mkdirSync(path.join(config.uploadsRoot, d), { recursive: true }));

  const server = http.createServer(app);

  const io = new Server(server, {
    transports: ['websocket'], // 仅 websocket 防集群握手死锁
    pingInterval: 25000,  // 25s 心跳间隔（保持 NAT 活跃）
    pingTimeout: 20000,   // 20s 无响应视为断线
    // 单帧负载上限 512KB（默认 1MB）：文本消息有 maxMsgLength 限制（~2KB），
    // 512KB 足够承载最大文件消息元数据与信令，同时防超大 payload 触发
    // 「1MB × 多房间广播放大」的内存/带宽滥用（socket 广播是扇出到所有成员）。
    maxHttpBufferSize: 512 * 1024,
    // 2026-10-11：显式关闭 WebSocket 逐帧压缩（permessage-deflate，也是 Socket.IO/ws 的默认值）。
    // 旧配置注释「serverNoContextTakeover 节省内存」不成立：ws 8.x 下 no_context_takeover 只是每帧后
    // reset() 同一个 zlib 流，并不释放——每条连接首次收/发 ≥threshold 的帧后，就常驻一套 deflate
    // （windowBits15/memLevel8 ≈256KB）+ inflate（≈40KB）原生内存直到断线；按 ecosystem.config.js
    // 的设计目标（单进程 1000 条长连接）约 200~300MB 原生内存，全部计入 pm2 max_memory_restart
    // 盯的 RSS（稳态约 200MB），外加大量 zlib 流的 RSS 碎片。另外：
    //   · engine.io 只要开着 perMessageDeflate 就不走 wsPreEncodedFrame——房间广播本可「成帧一次、
    //     各连接直接写」，开压缩后每个收件 socket 都单独成帧、单独排进 libuv 线程池压缩
    //     （与 sharp 缩略图、fs 共用默认 4 线程）。
    //   · 换来的带宽很少：聊天事件帧多在 0.3~1.5KB，压缩前后都装得下一个 TCP 段/TLS 记录，移动端
    //     包数与射频唤醒次数不变；历史消息/会话列表/搜索等大块数据走 REST，已由 app.js 的
    //     compression() gzip。只有少量多 KB 帧（超长文本、new_message_batch 突发、通话 SDP）会变大。
    // 没选「调小 serverMaxWindowBits/memLevel 保留压缩」：仍逐 socket 压缩、预编码广播仍被禁用；
    // 且 ws 在 clientMaxWindowBits 设为数字时，会对不带 client_max_window_bits 参数的报价（例如
    // OkHttp 只发 "permessage-deflate"）直接以 400 拒绝握手。
    // 关闭对所有客户端安全：扩展本就是可选协商，服务端不在 101 应答里回该扩展，客户端就按未压缩帧收发。
    perMessageDeflate: false,
    cors: {
      origin: config.allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  // 让 HTTP 路由层能拿到 io 与在线用户集合
  app.set('io', io);
  app.set('onlineUsers', new Set());

  // 重启收尾：数据库已初始化、Socket.IO 还没开始接受连接，此时把上次进程留下的
  // 悬挂 'ongoing' 通话记录收尾成明确终态（见 callReconciler.js 顶部注释）。
  await reconcileInterruptedCalls(Math.floor(Date.now() / 1000)).catch(err => {
    console.warn('[callReconciler] 重启收尾失败，将降级运行（悬挂记录可能仍显示"通话中"）:', err.message);
  });

  setupRealtime(io, app);

  // 生产监控：启动周期采样器（ELD>500ms / Worker队列>3000 / 内存>80% 自动告警）
  require('./utils/prodMetrics').startSampler();

  // ── 定时维护（每10分钟）─────────────────────────────────────────
  //   1) 红包过期回收：24h 未领完的标记 expired，剩余金额退回发送者钱包（reclaimExpired）
  //   2) 清理过期群邀请令牌
  //   启动时立即跑一次回收（startExpiryReclaim 内含首扫 + 自身10分钟定时）。
  const MAINT_INTERVAL = 10 * 60 * 1000;
  const { startExpiryReclaim } = require('./modules/redpackets/redpackets.service');
  // 2026-10-11：保留各定时器句柄，graceful() 停服第一步清掉，避免 writer 关闭后它们仍在发写入
  const reclaimTimer = startExpiryReclaim();

  // ── 定时消息调度器（每 30s 扫一次到期 pending 消息发出）─────────────
  //   启动即扫一次，实现服务重启后 pending 未到期消息的定时器自动恢复。
  const { startScheduler } = require('./modules/messages/scheduled.service');
  const schedulerTimer = startScheduler(io);
  const burnTimer = require('./modules/messages/burn.service').startBurnExpiry(io);
  const maintTimer = setInterval(() => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const tok = db.prepare('DELETE FROM group_invite_tokens WHERE expires_at < ?').run(now);
      if (tok.changes) console.log(`[maintenance] 清理过期群邀请 ${tok.changes}`);
    } catch (e) {
      console.warn('[maintenance] 失败:', e.message);
    }
  }, MAINT_INTERVAL).unref();

  server.listen(config.port, '127.0.0.1', () => {
    console.log(`投聊后端 v2 已启动: http://127.0.0.1:${config.port}  (env=${config.env})`);
  });

  // 优雅退出：通知 worker flush 落盘后再退出（pm2 restart / 停服时不丢写）
  // 2026-10-11 重排：旧流程先停 writer 且从不关 Socket.IO——已升级的 WebSocket 让
  // server.close() 回调永不触发，只剩 3s 兜底，而生产 pm2 并非从 ecosystem.config.js
  // 启动、用的是默认 kill_timeout 1600ms，于是每次重启都以 SIGKILL 收场；writer 停掉后
  // 进程还在收流量，期间 write() 被静默丢弃、writeAsync 全部 "Writer is stopped"。现顺序：
  //   1) 停入口：清本文件起的定时器 + io.close()（断开全部 socket 并关闭 http server，
  //      客户端得到 'transport close' 会自动重连）。注意不要换成 io.disconnectSockets(true)：
  //      它发 DISCONNECT 包，客户端得到 'io server disconnect'，按设计不会自动重连。
  //   2) await shutdownWriter()：io.close() 同步触发的 disconnect handler 已把下线写入入队，
  //      worker 按 FIFO 一并落盘后退出。
  //   3) Redis / 限流存储 / 追踪：best-effort 并行收尾，短超时，不让某个 quit 卡住退出。
  //   4) 显式 process.exit(0)：若干未 unref 的 interval 会让进程赖着不走。
  // 整体硬上限 1200ms，保证在 pm2 默认 kill_timeout(1600ms) 之前自行退出。
  // 主线程 db/readDb 不显式 close：WAL 下崩溃安全，且同步 close 的检查点无法被超时打断。
  const SHUTDOWN_DEADLINE_MS = 1200;
  const SHUTDOWN_STEP_TIMEOUT_MS = 300;
  // 单步限时：超时或失败都视为该步结束，继续往下走
  const withTimeout = (p, ms) => Promise.race([
    Promise.resolve(p).catch(() => {}),
    new Promise(resolve => setTimeout(resolve, ms)),
  ]);
  let _closing = false;
  async function graceful(sig) {
    if (_closing) return;
    _closing = true;
    console.log(`[server] 收到 ${sig}，优雅退出中…`);
    setTimeout(() => {
      console.warn(`[server] 优雅退出超过 ${SHUTDOWN_DEADLINE_MS}ms，强制退出`);
      process.exit(0);
    }, SHUTDOWN_DEADLINE_MS).unref();
    try {
      [reclaimTimer, schedulerTimer, burnTimer, maintTimer].forEach(t => clearInterval(t));
      // 包一层 then：某个 disconnect handler 同步抛错时（旧版 io.close 是同步的）也不跳过下面的 writer flush
      await withTimeout(Promise.resolve().then(() => io.close()), SHUTDOWN_STEP_TIMEOUT_MS);
      await shutdownWriter();
      // 必须在 redisCache.disconnect() **之前**停掉队列轮询：否则轮询会对着一个
      // 已 quit 的客户端继续 rpop，每 5 秒抛一次 "Connection is closed." 并以 error
      // 级别写进日志/Sentry（生产实测 57 条全产生在这个关停窗口里）。
      notificationQueue.stop();
      await withTimeout(Promise.allSettled([
        () => redisCache.disconnect(),
        () => require('./utils/tokenBlacklist').close(),
        () => require('./utils/cache').close(),
        () => require('./middleware/rateLimiters').close(),
        () => tracing.shutdown(),
      ].map(fn => Promise.resolve().then(fn))), SHUTDOWN_STEP_TIMEOUT_MS);
    } catch (e) {
      console.warn('[server] 优雅退出收尾异常:', e && e.message);
    }
    process.exit(0);
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
}

// 启动服务器
startServer().catch(err => {
  console.error('服务器启动失败:', err);
  process.exit(1);
});
