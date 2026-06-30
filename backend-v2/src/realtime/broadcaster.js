'use strict';
/**
 * 房间广播调度器（批量合并 + 分片削峰）。
 *
 * 优化点：
 *   1) 批量合并——同一 conversationId 在一个批窗口(BATCH_WINDOW_MS)内的多条 new_message
 *      合并为单个 'new_message_batch'(数组)事件，把 N 次 socket.io 编码/派发降为 1 次。
 *   2) 批窗口 + 上限——窗口 BATCH_WINDOW_MS(默认10ms)，单房间积满 MAX_BATCH(默认128)立即冲刷。
 *   3) 分片——一次 flush 涉及多房间时，每 tick 最多冲刷 SHARD_ROOMS 个房间，tick 间让出事件循环。
 *   4) 不再 except 发送者：客户端按 msgId 去重(confirmedMsgIds + find)，
 *      发送者收到自己的消息会被安全忽略，从而允许跨发送者合并到同一批次。
 *
 * 语义保持：ack 仍由 handler 同步回执；广播延迟 ≤ BATCH_WINDOW_MS。FIFO 保序（数组内有序）。
 */
const { info } = require('../utils/logger');

const BATCH_WINDOW_MS = 10;   // 5~20：合并窗口
const MAX_BATCH       = 128;  // 50~200：单房间一批最多合并条数，达到即提前冲刷
const SHARD_ROOMS     = 64;   // 单 tick 最多冲刷的房间数（多房间时分片）

let _io = null;
// room → { event, msgs: [] }   仅合并 new_message；其它事件直接单发
const pending = new Map();
let timer = null;

const stats = {
  totalMessages: 0,    // 入队的消息总数
  totalEmits: 0,       // 实际 socket.io emit 次数（合并后）
  batchedEmits: 0,     // 其中以数组批次形式发出的次数
  maxBatchSize: 0,
  flushes: 0,
  lastFlushMs: 0,
  maxFlushMs: 0,
};

function setIo(io) { _io = io; }

/**
 * 入队一条会话广播（会被合并）。仅用于 new_message 类按会话广播。
 * @param {string} room  conversationId
 * @param {object} msg   消息体
 */
function broadcastMessage(room, msg) {
  stats.totalMessages++;
  // 压测对照开关：BCAST_IMMEDIATE=1 时退回逐条立即派发（不合并），用于 A/B
  if (process.env.BCAST_IMMEDIATE === '1') { if (_io) { _io.to(room).emit('new_message', msg); stats.totalEmits++; } return; }
  let slot = pending.get(room);
  if (!slot) { slot = { msgs: [] }; pending.set(room, slot); }
  slot.msgs.push(msg);
  if (slot.msgs.length >= MAX_BATCH) { flushRoom(room, slot); pending.delete(room); return; }
  if (!timer) timer = setTimeout(flushAll, BATCH_WINDOW_MS);
}

function flushRoom(room, slot) {
  if (!_io) return;
  const msgs = slot.msgs;
  if (msgs.length === 1) {
    _io.to(room).emit('new_message', msgs[0]);
  } else {
    _io.to(room).emit('new_message_batch', msgs);
    stats.batchedEmits++;
    if (msgs.length > stats.maxBatchSize) stats.maxBatchSize = msgs.length;
  }
  stats.totalEmits++;
}

function flushAll() {
  timer = null;
  if (!pending.size) return;
  const t0 = process.hrtime.bigint();
  const rooms = [...pending.keys()];
  let n = 0;
  for (const room of rooms) {
    if (n >= SHARD_ROOMS) break;          // 分片：本 tick 只处理 SHARD_ROOMS 个房间
    const slot = pending.get(room);
    pending.delete(room);
    flushRoom(room, slot);
    n++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  stats.flushes++;
  stats.lastFlushMs = +ms.toFixed(3);
  if (ms > stats.maxFlushMs) stats.maxFlushMs = +ms.toFixed(3);
  if (stats.flushes % 500 === 0) {
    info('[broadcast] 合并派发', { msgs: stats.totalMessages, emits: stats.totalEmits, batched: stats.batchedEmits, maxBatch: stats.maxBatchSize, lastFlushMs: stats.lastFlushMs });
  }
  // 还有积压房间：让出事件循环后继续（用 timer 守卫，防止 broadcastMessage 同时设 setTimeout 产生双重唤醒）
  if (pending.size && !timer) timer = setTimeout(flushAll, 0);
}

/**
 * 通用单发（不合并），用于非 new_message 的房间事件（如需要时）。
 */
function emit(room, event, payload) {
  if (_io) { _io.to(room).emit(event, payload); stats.totalEmits++; }
}

// 进程退出时同步清空 pending，防止 SIGTERM 时积压消息丢失
function flushAllSync() {
  if (timer) { clearTimeout(timer); timer = null; }
  for (const [room, slot] of pending) flushRoom(room, slot);
  pending.clear();
}
process.on('SIGTERM', flushAllSync);
process.on('SIGINT',  flushAllSync);

module.exports = { setIo, broadcastMessage, emit, flushAllSync, stats };
