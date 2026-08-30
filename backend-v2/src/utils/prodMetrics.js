'use strict';
/**
 * 生产监控指标采集（独立于 monitoring.js 的请求/DB/缓存指标）。
 *
 * 采集 11 项：
 *   1 在线人数  2 消息发送成功率  3 消息延迟  4 图片上传成功率  5 连接/重连成功率
 *   6 CPU  7 内存  8 事件循环延迟(ELD)  9 Worker 队列长度  10 SQLite 写入耗时  11 磁盘剩余空间
 *
 * 告警：周期采样，ELD>500ms / Worker队列>3000 / 内存>80% / 磁盘剩余<500MB 时记录告警日志 +
 * 环形缓冲 + 推送 Telegram（同一类型 15 分钟内只推一次，防止持续越限时刷屏，见 pushAlert）。
 *
 * 除 alerts.js（可选的 Telegram 推送，未配置 token 时静默跳过）外无其它外部依赖，
 * 避免与 writer/connection 形成 require 循环。
 */
const os = require('os');
const fs = require('fs');
const { monitorEventLoopDelay } = require('perf_hooks');
const { logger } = require('./logger');
const { sendTelegramAlert } = require('./alerts');

// ── 阈值 ───────────────────────────────────────────────────────
// diskFreeBytes 与 utils/upload.js 的 MIN_DISK_FREE_BYTES 同口径（500MB）——
// 磁盘剩余低于这个值时，新上传本来就已经会被 uploadGuard 拒绝，告警应该在同一条线上。
const TH = { eldMs: 500, workerQueue: 3000, memPercent: 80, diskFreeBytes: 500 * 1024 * 1024 };
const SAMPLE_INTERVAL_MS = 5000;
const HIST_CAP = 1000;       // 延迟样本滚动容量
const ALERT_CAP = 200;       // 告警环形缓冲容量
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 同一类型告警 15 分钟内只推送一次

// ── 计数器 ─────────────────────────────────────────────────────
const counters = {
  msgSent: 0, msgSuccess: 0, msgFail: 0,
  imgUploaded: 0, imgSuccess: 0, imgFail: 0,
  connAttempt: 0, connSuccess: 0, connFail: 0,   // 连接/重连（含 socket.io 自动重连）
};

// ── 直方图（滚动数组）──────────────────────────────────────────
const msgLatency = [];   // 消息服务端处理耗时(ms)
const sqliteWrite = [];  // worker 写入往返耗时(ms)
function pushHist(arr, v) { arr.push(v); if (arr.length > HIST_CAP) arr.shift(); }

// ── 即时量 ─────────────────────────────────────────────────────
let workerQueueDepth = 0;
let workerQueuePeak = 0;
let _queueDepthGetter = null;          // writer 注入：() => 当前未决写数
function setQueueDepthGetter(fn) { _queueDepthGetter = fn; }

// ── ELD 监视（窗口内 reset，反映近期状况）──────────────────────
const eld = monitorEventLoopDelay({ resolution: 10 });
eld.enable();

// ── CPU 采样状态 ───────────────────────────────────────────────
let _lastCpu = process.cpuUsage();
let _lastCpuAt = Date.now();
const NUM_CPUS = os.cpus().length || 1;

// ── 告警环形缓冲 + 主动推送 ────────────────────────────────────
const alerts = [];
const lastPushedAt = {}; // type -> 上次成功推送 Telegram 的时间戳，做冷却
function pushAlert(type, value, threshold, extra) {
  const a = { time: new Date().toISOString(), type, value, threshold, ...extra };
  alerts.push(a);
  if (alerts.length > ALERT_CAP) alerts.shift();
  logger.error('[ALERT] 生产指标越限', a);

  const now = Date.now();
  if (!lastPushedAt[type] || now - lastPushedAt[type] >= ALERT_COOLDOWN_MS) {
    lastPushedAt[type] = now;
    const unit = extra?.unit || '';
    sendTelegramAlert(
      `🔴 投聊生产告警 [${type}]\n当前值: ${value}${unit}\n阈值: ${threshold}${unit}\n时间: ${a.time}`
    ).catch(() => {}); // sendTelegramAlert 内部已经兜底，这里只是防御万一
  }
}

// ── 记录接口（埋点处调用）──────────────────────────────────────
function recordMsg(ok, latencyMs) {
  counters.msgSent++;
  if (ok) counters.msgSuccess++; else counters.msgFail++;
  if (typeof latencyMs === 'number' && latencyMs >= 0) pushHist(msgLatency, latencyMs);
}
function recordImageUpload(ok) {
  counters.imgUploaded++;
  if (ok) counters.imgSuccess++; else counters.imgFail++;
}
function recordConnAttempt() { counters.connAttempt++; }
function recordConnResult(ok) { if (ok) counters.connSuccess++; else counters.connFail++; }
function recordSqliteWrite(ms) { if (typeof ms === 'number' && ms >= 0) pushHist(sqliteWrite, ms); }

// ── 工具 ───────────────────────────────────────────────────────
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
}
function rate(ok, total) { return total > 0 ? +((ok / total) * 100).toFixed(2) : 100; }

function cpuPercent() {
  const now = Date.now();
  const cur = process.cpuUsage();
  const dtMs = now - _lastCpuAt;
  if (dtMs <= 0) return 0;
  const usedMicros = (cur.user - _lastCpu.user) + (cur.system - _lastCpu.system);
  _lastCpu = cur; _lastCpuAt = now;
  // 进程占用（单核口径，可 >100）与归一化到全部核数两种口径
  const single = (usedMicros / 1000 / dtMs) * 100;
  return { process: +single.toFixed(1), normalized: +(single / NUM_CPUS).toFixed(1) };
}

function memorySnapshot() {
  const mu = process.memoryUsage();
  const total = os.totalmem(), free = os.freemem();
  return {
    rssMB: +(mu.rss / 1048576).toFixed(1),
    heapUsedMB: +(mu.heapUsed / 1048576).toFixed(1),
    heapTotalMB: +(mu.heapTotal / 1048576).toFixed(1),
    systemUsedPercent: +(((total - free) / total) * 100).toFixed(1),
    systemTotalMB: +(total / 1048576).toFixed(0),
  };
}

function diskSnapshot() {
  try {
    const s = fs.statfsSync(process.cwd());
    const freeBytes = s.bavail * s.bsize;
    const totalBytes = s.blocks * s.bsize;
    return {
      freeMB: +(freeBytes / 1048576).toFixed(0),
      totalMB: +(totalBytes / 1048576).toFixed(0),
      usedPercent: totalBytes > 0 ? +(((totalBytes - freeBytes) / totalBytes) * 100).toFixed(1) : 0,
    };
  } catch {
    return null; // statfsSync 在部分平台不可用
  }
}

function eldSnapshot() {
  return {
    meanMs: +(eld.mean / 1e6).toFixed(2),
    p99Ms: +(eld.percentile(99) / 1e6).toFixed(2),
    maxMs: +(eld.max / 1e6).toFixed(2),
  };
}

function readQueueDepth() {
  if (_queueDepthGetter) {
    try { workerQueueDepth = _queueDepthGetter(); } catch { /* ignore */ }
  }
  if (workerQueueDepth > workerQueuePeak) workerQueuePeak = workerQueueDepth;
  return workerQueueDepth;
}

// ── 完整快照（/admin/metrics 返回）─────────────────────────────
function snapshot(onlineUsersCount, onlineSocketsCount) {
  const q = readQueueDepth();
  const mem = memorySnapshot();
  const eldS = eldSnapshot();
  return {
    timestamp: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    online: { users: onlineUsersCount ?? 0, sockets: onlineSocketsCount ?? 0 },
    message: {
      sent: counters.msgSent, success: counters.msgSuccess, failed: counters.msgFail,
      successRate: rate(counters.msgSuccess, counters.msgSent),
      latencyMs: { p50: pct(msgLatency, .5), p95: pct(msgLatency, .95), p99: pct(msgLatency, .99), samples: msgLatency.length },
    },
    imageUpload: {
      total: counters.imgUploaded, success: counters.imgSuccess, failed: counters.imgFail,
      successRate: rate(counters.imgSuccess, counters.imgUploaded),
    },
    connection: {
      attempt: counters.connAttempt, success: counters.connSuccess, failed: counters.connFail,
      successRate: rate(counters.connSuccess, counters.connAttempt),
    },
    cpu: cpuPercent(),
    memory: mem,
    disk: diskSnapshot(),
    eventLoopDelay: eldS,
    worker: { queueDepth: q, queuePeak: workerQueuePeak },
    sqliteWriteMs: { p50: pct(sqliteWrite, .5), p95: pct(sqliteWrite, .95), p99: pct(sqliteWrite, .99), samples: sqliteWrite.length },
    thresholds: TH,
    alerts: { count: alerts.length, recent: alerts.slice(-20).reverse() },
  };
}

// ── 周期采样 + 告警 ────────────────────────────────────────────
let _timer = null;
function startSampler(getOnline) {
  if (_timer) return;
  _lastCpu = process.cpuUsage(); _lastCpuAt = Date.now();
  _timer = setInterval(() => {
    try {
      const eldMax = eld.max / 1e6;          // 本窗口最大 ELD
      const q = readQueueDepth();
      const memPct = memorySnapshot().systemUsedPercent;

      if (eldMax > TH.eldMs)      pushAlert('EVENT_LOOP_DELAY', +eldMax.toFixed(1), TH.eldMs, { unit: 'ms' });
      if (q > TH.workerQueue)     pushAlert('WORKER_QUEUE', q, TH.workerQueue, { unit: 'pending' });
      if (memPct > TH.memPercent) pushAlert('MEMORY', memPct, TH.memPercent, { unit: '%' });

      // 磁盘剩余空间：此前全代码库没有任何检测逻辑（AUDIT.md 十七节"磁盘占用监控缺失"）。
      // 查 process.cwd()（backend-v2/）所在分区——wechat.db/uploads 都在同一分区，单机部署下够用。
      try {
        const s = fs.statfsSync(process.cwd());
        const freeBytes = s.bavail * s.bsize;
        if (freeBytes < TH.diskFreeBytes) {
          pushAlert('DISK_FREE', +(freeBytes / 1048576).toFixed(0), Math.floor(TH.diskFreeBytes / 1048576), { unit: 'MB' });
        }
      } catch { /* statfsSync 在部分平台不可用时静默跳过，不影响其它指标采样 */ }

      eld.reset(); // 重置窗口，下个周期反映近 5s 状况
    } catch (e) {
      logger.warn('[prodMetrics] 采样失败', { error: e.message });
    }
  }, SAMPLE_INTERVAL_MS);
  _timer.unref();
}
function stopSampler() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = {
  recordMsg, recordImageUpload, recordConnAttempt, recordConnResult, recordSqliteWrite,
  setQueueDepthGetter, snapshot, startSampler, stopSampler, pushAlert, _alerts: alerts, TH,
};
