'use strict';
/**
 * WebRTC 1对1 通话信令转发（纯转发，服务端不参与媒体）。
 * 额外：把每通电话落库到 call_logs，生成通话历史 / 未接来电。
 *
 * 状态机（零前端改动，服务端用内存 Map 按 caller>callee 关联）：
 *   call:request           → 建记录 status=missed，记 started_at
 *   call:response accepted → status=ongoing（answered=true）
 *   call:response rejected → status=rejected, ended
 *   call:end (已接通)       → status=completed, duration=结束-接通
 *   call:end (未接通)       → status=canceled（主叫挂断/被叫未接）
 *
 * 安全兜底：
 *   - CALL_TIMEOUT_MS=120s：未被应答的通话自动清理 activeCalls & 落库（fix: 防 map 泄漏）
 *   - socket.on('disconnect')：断线时彻底清理该用户涉及的全部通话（fix: 防网络闪断泄漏）
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');

// 通话超时：120s 未应答则自动取消（防 activeCalls Map 无限增长 + call_logs 悬空记录）
const CALL_TIMEOUT_MS = 120_000;

// 模块级共享（单进程 fork 实例）：key = `${callerId}>${calleeId}`
const activeCalls = new Map();

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * 创建通话超时定时器：未被应答的通话在 CALL_TIMEOUT_MS 后自动清除
 */
function scheduleCallTimeout(key) {
  return setTimeout(() => {
    const c = activeCalls.get(key);
    if (c && !c.answeredAt) {
      try {
        db.prepare("UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?")
          .run(nowSec(), c.id);
      } catch (e) { console.warn('[call] timeout 落库失败:', e.message); }
      activeCalls.delete(key);
    }
  }, CALL_TIMEOUT_MS);
}

/**
 * 清理指定用户涉及的全部通话记录（disconnect / 异常时调用）
 */
function cleanupUserCalls(userId) {
  for (const [k, c] of activeCalls) {
    const [a, b] = k.split('>');
    if (a === userId || b === userId) {
      if (c.timer) clearTimeout(c.timer);
      try {
        const end = nowSec();
        if (c.answeredAt) {
          // 已接通的通话 → completed（断线视为通话结束）
          db.prepare("UPDATE call_logs SET status='completed', ended_at=?, duration=? WHERE id=?")
            .run(end, Math.max(0, end - c.answeredAt), c.id);
        }
        // 未接通的通话 DB 已有 missed 记录，无需额外写
      } catch (e) { console.warn('[call] disconnect 落库失败:', e.message); }
      activeCalls.delete(k);
    }
  }
}

module.exports = function registerCallHandler(io, socket) {
  const userId = socket.user.id;

  socket.on('call:request', ({ to, type, caller }) => {
    if (!to || to === userId) return;
    // 防骚扰 / 防绕过拉黑：被叫已拉黑主叫，或双方无私聊会话(非任意ID都能拨)，则拒接。
    const blocked = db.prepare('SELECT 1 FROM blocked_users WHERE user_id=? AND blocked_id=?').get(to, userId);
    const shareConv = db.prepare(`
      SELECT 1 FROM conversation_members cm1
      JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
      JOIN conversations c ON c.id = cm1.conversation_id AND c.type='private'
      WHERE cm1.user_id=? AND cm2.user_id=? LIMIT 1`).get(userId, to);
    if (blocked || !shareConv) {
      socket.emit('call:response', { from: to, accepted: false }); // 给主叫一个"被拒"信号，避免界面一直转
      return;
    }
    const id = uuidv4();
    const t = type === 'video' ? 'video' : 'audio';
    const key = `${userId}>${to}`;
    // 创建定时器：如果 120s 未被应答，自动清理
    const timer = scheduleCallTimeout(key);
    activeCalls.set(key, { id, answeredAt: null, timer });
    try {
      db.prepare('INSERT INTO call_logs (id,caller_id,callee_id,type,status,started_at) VALUES (?,?,?,?,?,?)')
        .run(id, userId, to, t, 'missed', nowSec());
    } catch (e) { console.warn('[call] log insert 失败:', e.message); }
    io.to(`user_${to}`).emit('call:incoming', { from: userId, type, caller });
  });

  socket.on('call:response', ({ to, accepted }) => {
    // 被叫(userId)回应主叫(to)：key 方向为 主叫>被叫 = to>userId
    const key = `${to}>${userId}`;
    const c = activeCalls.get(key);
    if (c) {
      if (c.timer) clearTimeout(c.timer); // 取消超时定时器（fix: 已应答不再超时清理）
      try {
        if (accepted) {
          c.answeredAt = nowSec();
          db.prepare("UPDATE call_logs SET status='ongoing' WHERE id=?").run(c.id);
        } else {
          db.prepare("UPDATE call_logs SET status='rejected', ended_at=? WHERE id=?").run(nowSec(), c.id);
          activeCalls.delete(key);
        }
      } catch (e) { console.warn('[call] response 落库失败:', e.message); }
    }
    io.to(`user_${to}`).emit('call:response', { from: userId, accepted });
  });

  socket.on('call:offer',  ({ to, offer })     => { if (!to) return; io.to(`user_${to}`).emit('call:offer',  { from: userId, offer }); });
  socket.on('call:answer', ({ to, answer })    => { if (!to) return; io.to(`user_${to}`).emit('call:answer', { from: userId, answer }); });
  socket.on('call:ice',    ({ to, candidate }) => { if (!to) return; io.to(`user_${to}`).emit('call:ice',    { from: userId, candidate }); });

  socket.on('call:end', ({ to }) => {
    // 挂断可能来自任一方，两个方向都查
    const k1 = `${userId}>${to}`;
    const k2 = `${to}>${userId}`;
    const c = activeCalls.get(k1) || activeCalls.get(k2);
    if (c) {
      if (c.timer) clearTimeout(c.timer); // 取消超时定时器（fix: 主动挂断不再等待超时）
      try {
        const end = nowSec();
        if (c.answeredAt) {
          db.prepare("UPDATE call_logs SET status='completed', ended_at=?, duration=? WHERE id=?")
            .run(end, Math.max(0, end - c.answeredAt), c.id);
        } else {
          db.prepare("UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?").run(end, c.id);
        }
      } catch (e) { console.warn('[call] end 落库失败:', e.message); }
      activeCalls.delete(k1);
      activeCalls.delete(k2);
    }
    io.to(`user_${to}`).emit('call:end', { from: userId });
  });

  // ── 断线清理（fix: 网络闪断时不走 call:end，需主动释放所有资源）──
  socket.on('disconnect', () => {
    cleanupUserCalls(userId);
  });
};
