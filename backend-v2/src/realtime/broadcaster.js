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

const BATCH_WINDOW_MS = 5;    // 5ms 合并窗口（降低延迟，保持高合并率）
const MAX_BATCH       = 200;  // 单房间最多合并 200 条，提升批次效率
const SHARD_ROOMS     = 96;   // 单 tick 最多冲刷 96 个房间（提升吞吐）
const CHUNK_SOCKETS   = 300;  // 单 tick 最多同步写多少个 socket；超大房间分片广播，防止事件循环阻塞（压测: 2000连接大群曾致 ELD>2s）
const NOTIFY_THRESHOLD = 500; // 房间在线 socket 超过此数 → 降级为轻量通知(new_message_notify)+客户端拉取，
                              // 不再推全量消息体。微信/Telegram 对超大户群的同款策略，彻底避免广播风暴。

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
  // 超大户群降级：在线 socket 超过 NOTIFY_THRESHOLD 时，不推全量消息体，
  // 只推轻量通知（conversationId + 最新一条概要），客户端收到后调 GET /api/messages/:id 拉取。
  // 服务端只做 1 次轻量 emit，广播成本 O(1)（socket.io 内部对同一 room 的 emit 仍会复制到各连接，
  // 但 payload 极小，且省略了全量消息的 JSON 序列化/压缩开销，ELD 压力下降一个量级）。
  const roomSockets = _io.sockets.adapter.rooms.get(room);
  if (roomSockets && roomSockets.size > NOTIFY_THRESHOLD) {
    const latest = msgs[msgs.length - 1];
    const preview = latest?.type === 'image' ? '[图片]'
      : latest?.type === 'voice' ? '[语音]'
      : latest?.type === 'file' ? '[文件]'
      : latest?.type === 'video' ? '[视频]'
      : String(latest?.content || '').slice(0, 60);
    emitToRoom(room, 'new_message_notify', {
      conversationId: room,
      lastMsgId: latest?.id || null,
      senderName: latest?.senderName || '',
      preview,
      count: msgs.length,
      ts: latest?.created_at || Math.floor(Date.now() / 1000),
    });
    stats.totalEmits++;
    if (msgs.length > 1) stats.batchedEmits++;
    return;
  }
  const event = msgs.length === 1 ? 'new_message' : 'new_message_batch';
  const payload = msgs.length === 1 ? msgs[0] : msgs;
  if (msgs.length > 1) {
    stats.batchedEmits++;
    if (msgs.length > stats.maxBatchSize) stats.maxBatchSize = msgs.length;
  }
  stats.totalEmits++;
  emitToRoom(room, event, payload);
}

/**
 * 房间广播，超大房间（在线 socket 数 > CHUNK_SOCKETS）分片派发：
 * 每片同步 emit 至多 CHUNK_SOCKETS 个连接后 setImmediate 让出事件循环，
 * 避免单 tick 对数千连接同步编码/写入导致事件循环阻塞（心跳超时、ping timeout）。
 * 小房间走原 io.to(room).emit 路径（零额外开销）。
 */
function emitToRoom(room, event, payload) {
  const adapterRooms = _io.sockets.adapter.rooms;
  const roomSockets = adapterRooms?.get(room);
  const count = roomSockets ? roomSockets.size : 0;
  if (!roomSockets || count <= CHUNK_SOCKETS) {
    _io.to(room).emit(event, payload);
    return;
  }
  const allSockets = _io.sockets.sockets;
  const ids = [...roomSockets];
  let i = 0;
  const sendNext = () => {
    const end = Math.min(i + CHUNK_SOCKETS, ids.length);
    for (; i < end; i++) {
      const s = allSockets.get(ids[i]);
      if (s && s.connected) s.emit(event, payload);
    }
    if (i < ids.length) setImmediate(sendNext); // 让出事件循环，心跳/其它连接可及时处理
  };
  sendNext();
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
  if (_io) { stats.totalEmits++; emitToRoom(room, event, payload); }
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
