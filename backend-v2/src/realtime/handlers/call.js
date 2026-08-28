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
const { readDb } = require('../../db/connection');
const { write } = require('../../db/writer');
const presence = require('../presence');
const { pushCallInvite } = require('../../utils/push');
const { guardPayload, guardId } = require('../guard');

// 通话超时：120s 未应答则自动取消（防 activeCalls Map 无限增长 + call_logs 悬空记录）
const CALL_TIMEOUT_MS = 120_000;

// 防骚扰：同一主叫每 5s 只能发起一次通话（不影响 activeCalls 逻辑，仅拦截高频重拨）
const CALL_COOLDOWN_MS = 5_000;
const callRateMap = new Map();

// 模块级共享（单进程 fork 实例）：key = `${callerId}>${calleeId}`
const activeCalls = new Map();

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * 创建通话超时定时器：未被应答的通话在 CALL_TIMEOUT_MS 后自动清除
 */
function scheduleCallTimeout(key, io) {
  return setTimeout(() => {
    const c = activeCalls.get(key);
    if (c && !c.answeredAt) {
      write("UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?", [nowSec(), c.id]);
      activeCalls.delete(key);
      // 通话已结束 → 清除冷却，允许立即重拨（P1-1）
      const [callerId] = key.split('>');
      callRateMap.delete(callerId);
      // 未接听超时也要补发 call:end，否则被叫端 UI/本地通知（未收到任何结束信号）会永久悬挂（NOTIFY-002 E3）
      // 带 callId：客户端 callEndEvents 按 callId 匹配，防跨事件流乱序误杀新来电（P1-3）
      const [cId2, calleeId] = key.split('>');
      io.to(`user_${calleeId}`).emit('call:end', { from: cId2, reason: 'timeout', callId: c.id });
    }
  }, CALL_TIMEOUT_MS);
}

/**
 * 清理指定用户涉及的全部通话记录（disconnect / 异常时调用）
 */
function cleanupUserCalls(io, userId) {
  for (const [k, c] of activeCalls) {
    const [a, b] = k.split('>');
    if (a === userId || b === userId) {
      if (c.timer) clearTimeout(c.timer);
      const otherId = a === userId ? b : a;
      try {
        const end = nowSec();
        if (c.answeredAt) {
          // 已接通的通话 → completed（断线视为通话结束）
          write("UPDATE call_logs SET status='completed', ended_at=?, duration=? WHERE id=?",
            [end, Math.max(0, end - c.answeredAt), c.id]);
        } else if (a === userId) {
          // 主叫断线且未接通 → canceled（而非 missed，missed 是被叫未接的语义）
          write("UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?", [end, c.id]);
        }
        // 被叫断线且未接通 → 保留 missed 状态
        // 通知对方通话已因断线结束（带 callId，P1-3）+ 清除冷却允许秒重拨（P1-1）
        io.to(`user_${otherId}`).emit('call:end', { from: userId, reason: 'disconnected', callId: c.id });
        callRateMap.delete(a);
      } catch (e) { console.warn('[call] disconnect 落库失败:', e.message); }
      activeCalls.delete(k);
    }
  }
}

module.exports = function registerCallHandler(io, socket) {
  const userId = socket.user.id;

  socket.on('call:request', (payload, ack) => {
    // P0-002 强校验：负载必须是对象，to 必须是合法字符串 ID，type 必须是枚举
    const p = guardPayload(socket, 'call:request', payload);
    if (!p) return;
    const to = guardId(socket, 'call:request', 'to', p.to);
    if (!to) return;
    const rawType = p.type;
    // callType 枚举校验：缺省(null/undefined)默认 audio；其余必须为字符串且∈{audio,video}，否则拒绝
    if (rawType != null && (typeof rawType !== 'string' || (rawType !== 'audio' && rawType !== 'video'))) {
      console.warn(`[realtime] 非法 callType 被拒绝 event=call:request type=${typeof rawType === 'string' ? rawType : typeof rawType} from=${userId}`);
      socket.emit('call:error', { code: 'INVALID_CALL_REQUEST', event: 'call:request', field: 'type' });
      return;
    }
    const type = rawType == null ? 'audio' : rawType;
    if (to === userId) return;
    // 频率限制：5s 内同一主叫只能发起一次（防呼叫骚扰）
    const now = Date.now();
    if (now - (callRateMap.get(userId) || 0) < CALL_COOLDOWN_MS) return;
    callRateMap.set(userId, now);
    setTimeout(() => callRateMap.delete(userId), CALL_COOLDOWN_MS);
    // 防骚扰 / 防绕过拉黑：被叫已拉黑主叫，或双方无私聊会话(非任意ID都能拨)，则拒接。
    const blocked = readDb.prepare('SELECT 1 FROM blocked_users WHERE user_id=? AND blocked_id=?').get(to, userId);
    const shareConv = readDb.prepare(`
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
    // 重复拨号时更新旧记录状态，防止留下永久 missed 孤儿行
    const old = activeCalls.get(key);
    if (old) {
      if (old.timer) clearTimeout(old.timer);
      try {
        const endNow = nowSec();
        if (old.answeredAt) {
          // 已接通的通话被新呼叫覆盖 → 标记 completed 并通知被叫结束（带 callId，P1-3）
          write("UPDATE call_logs SET status='completed', ended_at=?, duration=? WHERE id=?",
            [endNow, Math.max(0, endNow - old.answeredAt), old.id]);
          io.to(`user_${to}`).emit('call:end', { from: userId, reason: 'replaced', callId: old.id });
        } else {
          write("UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?", [endNow, old.id]);
        }
        // 旧通话被覆盖 → 清除冷却，允许立即重拨（P1-1）
        callRateMap.delete(userId);
      } catch {}
    }
    const timer = scheduleCallTimeout(key, io);
    activeCalls.set(key, { id, answeredAt: null, timer });
    write('INSERT INTO call_logs (id,caller_id,callee_id,type,status,started_at) VALUES (?,?,?,?,?,?)',
      [id, userId, to, t, 'missed', nowSec()]);
    // 服务端从 DB 取真实用户信息，不透传客户端 caller 字段（防视觉身份冒充）
    const callerInfo = readDb.prepare('SELECT username, avatar FROM users WHERE id=?').get(userId);
    io.to(`user_${to}`).emit('call:incoming', { from: userId, type: t, callId: id, caller: { id: userId, name: callerInfo?.username, avatar: callerInfo?.avatar } });
    // 被叫不在线（App 未连 socket，如后台/熄屏）→ 发 data-only FCM 唤起来电界面；在线则 socket 已推 call:incoming
    if (!presence.isOnline(to)) {
      pushCallInvite({ toUserId: to, fromUserId: userId, callerName: callerInfo?.username || '', callType: t, callId: id })
        .catch(e => console.warn('[call] 来电推送失败:', e.message));
    }
    // 主叫侧回执携带 callId：随后随 accept/reject/hangup 回传做过期应答校验（对齐被叫侧）。
    // 旧客户端不传 ack 回调则跳过，无兼容风险。
    if (typeof ack === 'function') ack({ callId: id });
  });

  socket.on('call:response', (payload) => {
    // P0-002 强校验：负载必须是对象，to 必须是合法字符串 ID
    const p = guardPayload(socket, 'call:response', payload);
    if (!p) return;
    const to = guardId(socket, 'call:response', 'to', p.to);
    if (!to) return;
    const accepted = !!p.accepted, busy = !!p.busy, reason = p.reason;
    const callId = typeof p.callId === 'string' && p.callId ? p.callId : null;
    // 被叫(userId)回应主叫(to)：key 方向为 主叫>被叫 = to>userId
    const key = `${to}>${userId}`;
    const c = activeCalls.get(key);
    // callId 不匹配当前活跃通话（如：来电通知已过期/被同一对用户的新来电覆盖后才被点击）→
    // 忽略，防止过期应答误伤新通话（NOTIFY-002 F3）。旧客户端不传 callId 时不做该校验，保持兼容。
    if (c && callId && c.id !== callId) {
      // 过期应答回执 call:end(stale)，否则被叫端 accept() 后无 offer 可等、永久卡 CONNECTING（P1-5）
      io.to(`user_${userId}`).emit('call:end', { from: to, reason: 'stale', callId });
      return;
    }
    if (!c && callId) {
      // 活跃通话已不存在（120s 超时清除/断线清理后迟到的应答）→ 同样回 stale，防客户端卡死（P1-5）
      io.to(`user_${userId}`).emit('call:end', { from: to, reason: 'stale', callId });
      return;
    }
    if (c) {
      if (c.timer) clearTimeout(c.timer); // 取消超时定时器（fix: 已应答不再超时清理）
      if (accepted) {
        // 重复 accepted 守卫（P2-4）：同账号双端先后接听同一通，第二次不得回拨 answeredAt
        // （否则 duration 变短 + 向主叫二次转发 accepted → 重复 setRemoteDescription）
        if (c.answeredAt) return;
        c.answeredAt = nowSec();
        write("UPDATE call_logs SET status='ongoing' WHERE id=?", [c.id]);
      } else {
        write("UPDATE call_logs SET status='rejected', ended_at=? WHERE id=?", [nowSec(), c.id]);
        activeCalls.delete(key);
      }
    }
    // 只有活跃通话存在时才转发：防止任意用户伪造拒接信号
    if (c) io.to(`user_${to}`).emit('call:response', { from: userId, accepted, busy, reason });
  });

  // call:offer/answer/ice：校验双方确实存在活跃通话，防止信令注入攻击
  function inActiveCall(toId) {
    return activeCalls.has(`${userId}>${toId}`) || activeCalls.has(`${toId}>${userId}`);
  }
  socket.on('call:offer',  (payload) => { const p = guardPayload(socket, 'call:offer', payload); if (!p) return; const to = guardId(socket, 'call:offer', 'to', p.to); if (!to || !inActiveCall(to)) { console.log(`[call:offer] DROP from=${userId} to=${to} noActiveCall`); return; } console.log(`[call:offer] fwd ${userId}→${to} sdpLen=${(p.offer?.sdp || '').length}`); io.to(`user_${to}`).emit('call:offer',  { from: userId, offer: p.offer }); });
  socket.on('call:answer', (payload) => { const p = guardPayload(socket, 'call:answer', payload); if (!p) return; const to = guardId(socket, 'call:answer', 'to', p.to); if (!to || !inActiveCall(to)) { console.log(`[call:answer] DROP from=${userId} to=${to} noActiveCall`); return; } console.log(`[call:answer] fwd ${userId}→${to} sdpLen=${(p.answer?.sdp || '').length}`); io.to(`user_${to}`).emit('call:answer', { from: userId, answer: p.answer }); });
  socket.on('call:ice',    (payload) => { const p = guardPayload(socket, 'call:ice', payload); if (!p) return; const to = guardId(socket, 'call:ice', 'to', p.to); if (!to || !inActiveCall(to)) { console.log(`[call:ice] DROP from=${userId} to=${to} noActiveCall`); return; } console.log(`[call:ice] fwd ${userId}→${to} cand=${(p.candidate?.candidate || '').slice(0, 60)}`); io.to(`user_${to}`).emit('call:ice',    { from: userId, candidate: p.candidate }); });

  socket.on('call:end', (payload) => {
    // P0-002 强校验：负载必须是对象，to 必须是合法字符串 ID
    const p = guardPayload(socket, 'call:end', payload);
    if (!p) return;
    const to = guardId(socket, 'call:end', 'to', p.to);
    if (!to) return;
    const reason = typeof p.reason === 'string' ? p.reason : undefined;
    const callId = typeof p.callId === 'string' && p.callId ? p.callId : null;
    // 挂断可能来自任一方，两个方向都查
    const k1 = `${userId}>${to}`;
    const k2 = `${to}>${userId}`;
    const c = activeCalls.get(k1) || activeCalls.get(k2);
    // 同上：callId 不匹配当前活跃通话则忽略（过期挂断/拒绝不应打断同一对用户的新通话）
    if (c && callId && c.id !== callId) return;
    if (c) {
      if (c.timer) clearTimeout(c.timer); // 取消超时定时器（fix: 主动挂断不再等待超时）
      const end = nowSec();
      if (c.answeredAt) {
        write("UPDATE call_logs SET status='completed', ended_at=?, duration=? WHERE id=?",
          [end, Math.max(0, end - c.answeredAt), c.id]);
      } else {
        write("UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?", [end, c.id]);
      }
      activeCalls.delete(k1);
      activeCalls.delete(k2);
      // 只有活跃通话存在时才转发：防止任意用户强制关闭他人通话界面（带 callId，P1-3）
      io.to(`user_${to}`).emit('call:end', { from: userId, reason, callId: c.id });
      // 通话已结束 → 清除冷却，允许立即重拨（P1-1）
      callRateMap.delete(userId);
    }
  });

  // ── 断线清理（fix: 网络闪断时不走 call:end，需主动释放所有资源）──
  socket.on('disconnect', () => {
    cleanupUserCalls(io, userId);
  });
};
