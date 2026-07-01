'use strict';
/**
 * 主线程侧写入接口
 *   write()      —— fire-and-forget，不等确认，吞吐最高
 *   writeAsync() —— 等 worker commit 后 resolve（读后写一致性场景）
 *   writeBatch() —— 多条 SQL 原子批次
 *
 * 容错：worker 非零退出自动重启（500ms），重启窗口内写操作缓存 retryQueue；
 * writeAsync 未决操作记录 _pendingOps，崩溃后加入 retryQueue 重放，
 * 保证 Promise 最终 resolve（已入库的 INSERT 由 UNIQUE 冲突静默忽略）。
 */
const { Worker } = require('worker_threads');
const { performance } = require('perf_hooks');
const path = require('path');
const config = require('../config');
const prodMetrics = require('../utils/prodMetrics');

const WORKER_SCRIPT = path.join(__dirname, 'worker.js');
// maxBatch 提到 500：单事务合并更多写，减少 transaction 次数，加快积压排空（#3）
const WORKER_DATA   = { dbPath: config.dbPath, flushMs: 8, maxBatch: 500 };
const RESTART_DELAY = 500;

// ── 背压参数（#2）：禁止未决写 Promise 无限堆积 ──────────────────
const MAX_QUEUE_SIZE   = 20000;  // 未决写超过此值：writeAsync/writeBatch 立即快速失败
const HIGH_WATER_MARK  = 15000;  // 进入过载（拒绝 fire-and-forget write，避免雪上加霜）
const LOW_WATER_MARK   = 5000;   // 退出过载（迟滞，避免抖动）
let _overloaded = false;
const backpressure = { rejected: 0, droppedWrites: 0, overloadedEnters: 0, get queueDepth() { return _pending.size; }, get overloaded() { return _overloaded; } };
function updateOverload() {
  if (!_overloaded && _pending.size >= HIGH_WATER_MARK) { _overloaded = true; backpressure.overloadedEnters++; }
  else if (_overloaded && _pending.size <= LOW_WATER_MARK) { _overloaded = false; }
}

let worker        = null;
let _reqId        = 0;
const _pending    = new Map();   // reqId → handler(err)
const _pendingOps = new Map();   // reqId → 原始外发消息对象（write 或 writeBatch），崩溃重启时原样重放
const retryQueue  = [];
let isRestarting  = false;

function createWorker() {
  const w = new Worker(WORKER_SCRIPT, { workerData: WORKER_DATA });

  w.on('message', msg => {
    if (msg.type === 'ack') {
      const err = msg.error ? new Error(msg.error) : null;
      for (const id of msg.ids) {
        _pendingOps.delete(id);
        const handler = _pending.get(id);
        if (handler) { _pending.delete(id); handler(err); }
      }
    } else if (msg.type === 'overload') {
      // Worker 端队列已饱和，标记过载状态以触发主线程背压
      if (!_overloaded) { _overloaded = true; backpressure.overloadedEnters++; }
      console.warn('[dbWriter] Worker queue overloaded, depth=%d', msg.depth);
    }
  });

  w.on('error', e => console.error('[dbWriter] Worker error:', e.message));

  w.on('exit', code => {
    if (code === 0) return;
    console.error('[dbWriter] Worker crashed (code %d), restarting in %dms …', code, RESTART_DELAY);
    isRestarting = true;
    // 未决操作（write / writeBatch）原样重新入队，待新 worker 起来后重放
    for (const [, msg] of _pendingOps) {
      retryQueue.unshift(msg);
    }
    _pendingOps.clear();
    setTimeout(() => {
      worker = createWorker();
      isRestarting = false;
      const backlog = retryQueue.splice(0);
      for (const msg of backlog) {
        // 重新注册到 _pendingOps，防止二次崩溃时 Promise 永久悬挂
        if (msg.reqId != null) _pendingOps.set(msg.reqId, msg);
        try { worker.postMessage(msg); } catch {}
      }
      console.info('[dbWriter] Worker restarted, flushed %d buffered ops', backlog.length);
    }, RESTART_DELAY);
  });

  return w;
}

worker = createWorker();

function postMsg(msg) {
  if (isRestarting) retryQueue.push(msg);
  else worker.postMessage(msg);
}

function write(sql, params = []) {
  // fire-and-forget：过载时丢弃（非关键写，如送达记录），避免加剧堆积
  if (_overloaded) { backpressure.droppedWrites++; return; }
  postMsg({ type: 'write', sql, params });
}

function writeAsync(sql, params = []) {
  updateOverload();
  // 背压：未决写达到上限即快速失败，禁止 Promise 无限堆积
  if (_pending.size >= MAX_QUEUE_SIZE) {
    backpressure.rejected++;
    return Promise.reject(new Error('WRITE_QUEUE_OVERLOAD'));
  }
  const id = ++_reqId;
  const msg = { type: 'write', sql, params, reqId: id };
  _pendingOps.set(id, msg);
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    _pending.set(id, (err) => { prodMetrics.recordSqliteWrite(performance.now() - t0); if (err) reject(err); else resolve(); });
    postMsg(msg);
  });
}

/**
 * 原子批次写入：ops = [{ sql, params }, …]，worker 在同一事务内顺序执行，
 * 全部提交后 Promise resolve。用于"多条写必须原子"的场景（转发、发红包消息+记录）。
 */
function writeBatch(ops) {
  updateOverload();
  if (_pending.size >= MAX_QUEUE_SIZE) {
    backpressure.rejected++;
    return Promise.reject(new Error('WRITE_QUEUE_OVERLOAD'));
  }
  const id = ++_reqId;
  const msg = { type: 'writeBatch', ops, reqId: id };
  _pendingOps.set(id, msg);
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    _pending.set(id, (err) => { prodMetrics.recordSqliteWrite(performance.now() - t0); if (err) reject(err); else resolve(); });
    postMsg(msg);
  });
}

function shutdown() {
  postMsg({ type: 'shutdown' });
}

// 监控：未决写数量（writeAsync/writeBatch 尚未收到 worker ack）作为 Worker 队列深度代理
prodMetrics.setQueueDepthGetter(() => _pending.size);

module.exports = { write, writeAsync, writeBatch, shutdown, backpressure };
