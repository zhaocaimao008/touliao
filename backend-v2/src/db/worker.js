'use strict';
/**
 * SQLite 写入 Worker Thread
 *   - 独占写连接，主线程永不等写锁
 *   - 批量事务：每 FLUSH_MS 或积满 MAX_BATCH 条一次 COMMIT
 *   - uncaughtException 时先 flush 再非零退出，由主线程负责重启
 */
const { workerData, parentPort } = require('worker_threads');
const Database = require('better-sqlite3');

const FLUSH_MS  = workerData.flushMs  || 8;
const MAX_BATCH = workerData.maxBatch || 200;
const MAX_QUEUE = 50000; // 保护：队列积压超过此值丢弃非关键写入

const db = new Database(workerData.dbPath, { timeout: 10000 });
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -32000');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');
db.pragma('foreign_keys = ON');

const stmtCache = new Map();
const stmt = sql => {
  if (!stmtCache.has(sql)) stmtCache.set(sql, db.prepare(sql));
  return stmtCache.get(sql);
};

let queue = [];
let timer = null;

function runItem(item) {
  if (item.ops) { for (const op of item.ops) stmt(op.sql).run(...op.params); }
  else stmt(item.sql).run(...item.params);
}

function flushBatch(batch) {
  try {
    db.transaction(() => {
      for (const item of batch) runItem(item);
    })();
    const acks = batch.filter(b => b.reqId != null);
    if (acks.length) parentPort.postMessage({ type: 'ack', ids: acks.map(b => b.reqId) });
  } catch (e) {
    // 逐条重试：一条坏数据不阻塞整批（批次项各自包一层事务，保持原子性）
    for (const item of batch) {
      try {
        if (item.ops) db.transaction(() => runItem(item))();
        else runItem(item);
        if (item.reqId != null) parentPort.postMessage({ type: 'ack', ids: [item.reqId] });
      } catch (itemErr) {
        console.error('[dbWorker] SQL 执行失败:', item.sql || '(batch)', itemErr.message);
        if (item.reqId != null) parentPort.postMessage({ type: 'ack', ids: [item.reqId], error: itemErr.message });
      }
    }
  }
}

function flush() {
  timer = null;
  if (!queue.length) return;
  flushBatch(queue.splice(0, MAX_BATCH));
  if (queue.length > 0) setImmediate(flush);
}

function schedule() {
  if (queue.length >= MAX_BATCH) {
    if (timer) { clearTimeout(timer); timer = null; }
    setImmediate(flush);
  } else if (!timer) {
    timer = setTimeout(flush, FLUSH_MS);
  }
}

parentPort.on('message', msg => {
  switch (msg.type) {
    case 'write':
    case 'writeBatch':
      if (queue.length >= MAX_QUEUE) {
        // 队列积压保护：丢弃非关键写入
        if (msg.type === 'write' && msg.fireAndForget) return;
        // 关键写入（writeAsync/writeBatch）仍然入队，但通知主线程过载
        parentPort.postMessage({ type: 'overload', depth: queue.length });
      }
      queue.push(msg);
      schedule();
      break;
    case 'shutdown':
      if (timer) { clearTimeout(timer); timer = null; }
      while (queue.length > 0) flushBatch(queue.splice(0, MAX_BATCH));
      db.close();
      process.exit(0);
      break;
  }
});

let _terminating = false;
process.on('uncaughtException', e => {
  console.error('[dbWorker] uncaughtException:', e.message, e.stack);
  if (_terminating) return;
  _terminating = true;
  // 用 while 循环直接 flushBatch，而非 flush()（flush 通过 setImmediate 递归，
  // 在 process.exit 之前不会再执行事件循环）
  try { while (queue.length > 0) flushBatch(queue.splice(0, MAX_BATCH)); } catch {}
  process.exit(1);
});
