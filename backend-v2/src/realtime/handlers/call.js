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
 *   - socket.on('disconnect')：只解绑当前参与 Socket，重连宽限到期后再结束通话
 */
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');
const { readDb } = require('../../db/connection');
const { write } = require('../../db/writer');
const presence = require('../presence');
const { pushCallInvite } = require('../../utils/push');
const { guardPayload, guardId } = require('../guard');
const { writeCallMessage } = require('../callMessage');

// 通话超时：120s 未应答则自动取消（防 activeCalls Map 无限增长 + call_logs 悬空记录）。
// 可经环境变量注入(仅测试用短值;生产不设则保持 120s,行为不变)
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS) || 120_000;

// 防骚扰：同一主叫每 5s 只能发起一次通话（不影响 activeCalls 逻辑，仅拦截高频重拨）。
// 可经环境变量注入(测试设 0 关闭;生产不设则保持 5s,行为不变)
const CALL_COOLDOWN_MS = process.env.CALL_COOLDOWN_MS !== undefined ? Number(process.env.CALL_COOLDOWN_MS) : 5_000;
const callRateMap = new Map();

// 模块级共享（单进程 fork 实例）：key = `${callerId}>${calleeId}`
// ⚠️ 纯内存 Map，没有 Redis/DB 镜像，进程重启会丢失全部进行中通话的状态——这次
// （2026-08-30 多端广播修复）不处理，已记入 AUDIT.md 待办。
const activeCalls = new Map();

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * 创建通话超时定时器：未被应答的通话在 CALL_TIMEOUT_MS 后自动清除
 */
function scheduleCallTimeout(key, io, registry) {
  return setTimeout(() => {
    const c = activeCalls.get(key);
    if (c && !c.answeredAt) {
      write("UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?", [nowSec(), c.id]);
      // 120s 未接超时 → 聊天窗口系统消息:主叫看「对方无应答」/ 被叫看「未接来电」(status=missed)
      const [callerId, calleeId] = key.split('>');
      writeCallMessage({
        callId: c.id, status: 'missed', duration: 0, callType: c.type,
        callerId, calleeId,
      }, io);
      activeCalls.delete(key);
      registry.end(c.id);
      // 通话已结束 → 清除冷却，允许立即重拨（P1-1）
      callRateMap.delete(callerId);
      // 未接听超时也要补发 call:end，否则被叫端 UI/本地通知（未收到任何结束信号）会永久悬挂（NOTIFY-002 E3）
      // 带 callId：客户端 callEndEvents 按 callId 匹配，防跨事件流乱序误杀新来电（P1-3）
      io.to(`user_${calleeId}`).emit('call:end', { from: callerId, reason: 'timeout', callId: c.id });
    }
  }, CALL_TIMEOUT_MS);
}

/**
 * 重连宽限到期后清理指定的 1 对 1 通话。registry 只触发回调，DB 与事件副作用仍归 handler。
 */
function cleanupExpiredPrivateCall(io, registry, { callId, userId, kind }) {
  if (kind !== 'private') return;
  const entry = [...activeCalls].find(([, call]) => call.id === callId);
  if (!entry) {
    registry.end(callId);
    return;
  }

  const [key, call] = entry;
  const [callerId, calleeId] = key.split('>');
  const otherId = callerId === userId ? calleeId : callerId;
  if (call.timer) clearTimeout(call.timer);
  try {
    const end = nowSec();
    if (call.answeredAt) {
      write("UPDATE call_logs SET status='completed', ended_at=?, duration=? WHERE id=?",
        [end, Math.max(0, end - call.answeredAt), call.id]);
      // 断线收尾:已接通 → 聊天窗口系统消息「通话时长 X」(双方同文案)
      writeCallMessage({
        callId: call.id, status: 'completed', duration: Math.max(0, end - call.answeredAt),
        callType: call.type, callerId, calleeId,
      }, io);
    } else if (callerId === userId) {
      write("UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?", [end, call.id]);
      // 主叫挂断未接 → 主叫「已取消」/ 被叫「未接来电」
      writeCallMessage({
        callId: call.id, status: 'canceled', duration: 0, callType: call.type,
        callerId, calleeId,
      }, io);
    }
    io.to(`user_${otherId}`).emit('call:end', { from: userId, reason: 'disconnected', callId: call.id });
  } catch (e) {
    console.warn('[call] disconnect 落库失败:', e.message);
  } finally {
    activeCalls.delete(key);
    registry.end(callId);
    callRateMap.delete(callerId);
  }
}

function registerCallHandler(io, socket, registry) {
  const userId = socket.user.id;

  function resolveCall(payload, to, eventName) {
    if (payload.callId != null && payload.callId !== '') {
      const callId = guardId(socket, eventName, 'callId', payload.callId);
      if (!callId) return null;
      return registry.validatePrivate(callId, userId, to);
    }
    if (config.calls.requireId) {
      socket.emit('call:error', { code: 'CALL_ID_REQUIRED', event: eventName });
      return null;
    }
    return registry.resolvePrivateCall(userId, to);
  }

  function reportResolutionError(eventName, result) {
    socket.emit('call:error', { code: result.code, event: eventName, callId: result.callId });
  }

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
          // 重拨覆盖旧通话 → 聊天窗口系统消息(与挂断同语义)
          writeCallMessage({
            callId: old.id, status: 'completed', duration: Math.max(0, endNow - old.answeredAt),
            callType: old.type, callerId: userId, calleeId: to,
          }, io);
        } else {
          write("UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?", [endNow, old.id]);
          writeCallMessage({
            callId: old.id, status: 'canceled', duration: 0, callType: old.type,
            callerId: userId, calleeId: to,
          }, io);
        }
        // 2026-08-30 修复：未接听就被新呼叫覆盖时，此前只落库、没有通知被叫——被叫本地
        // 还缓存着旧 callId，之后不管接听还是拒绝，服务端一看 callId 对不上就判定"过期操作"，
        // 只回执操作者自己"你这个操作过期了"，呼叫方完全收不到任何消息，永久卡在"呼叫中"
        // （复现：真实 socket 测试，A 重拨后 B 用旧 callId 拒绝，A 0 次收到通知，B 收到
        // reason:'stale'）。改成两个分支都通知被叫，复用已有的 'replaced' 语义（客户端已经
        // 需要处理这个 reason，不需要新增分支），不再区分"已接通/未接听"两种覆盖情况。
        io.to(`user_${to}`).emit('call:end', { from: userId, reason: 'replaced', callId: old.id });
        // 旧通话被覆盖 → 清除冷却，允许立即重拨（P1-1）
        callRateMap.delete(userId);
      } catch {}
      activeCalls.delete(key);
      registry.end(old.id);
    }
    const created = registry.createPrivate({
      callId: id,
      callerId: userId,
      calleeId: to,
      socketId: socket.id,
      type: t,
    });
    if (!created.ok) {
      socket.emit('call:error', { code: created.code, callId: created.callId });
      return;
    }
    const timer = scheduleCallTimeout(key, io, registry);
    activeCalls.set(key, { id, answeredAt: null, timer, type: t });
    write('INSERT INTO call_logs (id,caller_id,callee_id,type,status,started_at) VALUES (?,?,?,?,?,?)',
      [id, userId, to, t, 'missed', nowSec()]);
    // 服务端从 DB 取真实用户信息，不透传客户端 caller 字段（防视觉身份冒充）
    const callerInfo = readDb.prepare('SELECT username, avatar FROM users WHERE id=?').get(userId);
    io.to(`user_${to}`).emit('call:incoming', { from: userId, type: t, callId: id, caller: { id: userId, name: callerInfo?.username, avatar: callerInfo?.avatar } });
    // 2026-08-30 新增：呼叫方(userId)自己的其他在线设备此前完全不知道"我"正在用另一台
    // 设备发起呼叫——比如用 Web 端拨号，手机端毫无感知。新增事件 call:outgoing（不复用
    // call:incoming：那个语义是"有人叫我"，这个是"我的另一台设备正在叫别人"，四端目前都
    // 没有对应监听，需要客户端新增处理，详见 AUDIT.md 改动清单）。用 socket.to()（不含
    // 当前发起呼叫的这台设备自己）只通知同一用户的其他设备。
    socket.to(`user_${userId}`).emit('call:outgoing', { to, type: t, callId: id });
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
    const resolved = resolveCall(p, to, 'call:response');
    if (!resolved) return;
    if (!resolved.ok) {
      // 过期应答回执 call:end(stale)，否则被叫端 accept() 后无 offer 可等、永久卡 CONNECTING（P1-5）
      const staleCallId = typeof p.callId === 'string' ? p.callId : undefined;
      if (staleCallId) io.to(`user_${userId}`).emit('call:end', { from: to, reason: 'stale', callId: staleCallId });
      else reportResolutionError('call:response', resolved);
      return;
    }
    const callId = resolved.callId;
    // 被叫(userId)回应主叫(to)：key 方向为 主叫>被叫 = to>userId
    const key = `${to}>${userId}`;
    const c = activeCalls.get(key);
    if (!c || c.id !== callId) {
      io.to(`user_${userId}`).emit('call:end', { from: to, reason: 'stale', callId });
      return;
    }
    if (c.timer) clearTimeout(c.timer); // 取消超时定时器（fix: 已应答不再超时清理）
    if (accepted) {
      // 重复 accepted 守卫（P2-4）：同账号双端先后接听同一通，第二次不得回拨 answeredAt
      if (c.answeredAt) return;
      const bound = registry.bindSocket(callId, userId, socket.id);
      if (!bound.ok) { reportResolutionError('call:response', bound); return; }
      c.answeredAt = nowSec();
      resolved.session.answeredAt = c.answeredAt;
      write("UPDATE call_logs SET status='ongoing' WHERE id=?", [c.id]);
    } else {
      write("UPDATE call_logs SET status='rejected', ended_at=? WHERE id=?", [nowSec(), c.id]);
      // 被叫拒绝 → 主叫「对方已拒绝」/ 被叫「已拒绝」
      const [callerId2, calleeId2] = key.split('>');
      writeCallMessage({
        callId: c.id, status: 'rejected', duration: 0, callType: c.type,
        callerId: callerId2, calleeId: calleeId2,
      }, io);
      activeCalls.delete(key);
      registry.end(callId);
    }
    // 只有活跃通话存在时才转发：防止任意用户伪造拒接信号
    io.to(`user_${to}`).emit('call:response', { from: userId, accepted, busy, reason, callId });
    // 2026-08-30 修复（多端不同步）：接听/拒绝这个动作此前只广播给了对方(to)，操作者
    // (userId)自己的其他在线设备完全不知道已经在别的设备上处理过——B在Web端拒绝，B的
    // 手机端仍显示"通话中"的根因就是这里。复用已有的 call:end 事件而不是新增事件类型：
    // 客户端处理"来电/通话中界面"的收起逻辑天然挂在 call:end 上（收到就收起，不区分是
    // 谁发起的），四端理论上不需要新增监听，只需要确认 reason 文案覆盖了这两个新值
    // （answered_elsewhere / rejected_elsewhere），详见 AUDIT.md 改动清单。用 socket.to()
    // （不含当前操作的这台设备自己）只通知同一用户的其他设备，避免操作设备收到自己发出
    // 的动作对应的回声通知后又重复处理一遍（比如拒绝后又触发一次拒绝逻辑）。
    socket.to(`user_${userId}`).emit('call:end', {
      from: userId,
      reason: accepted ? 'answered_elsewhere' : 'rejected_elsewhere',
      callId: c.id,
    });
  });

  // call:offer/answer/ice：校验双方确实存在活跃通话，防止信令注入攻击
  function forwardSignal(eventName, fieldName, payload) {
    const p = guardPayload(socket, eventName, payload);
    if (!p) return;
    const to = guardId(socket, eventName, 'to', p.to);
    if (!to) return;
    const resolved = resolveCall(p, to, eventName);
    if (!resolved) return;
    if (!resolved.ok) {
      reportResolutionError(eventName, resolved);
      console.log(`[${eventName}] DROP from=${userId} to=${to} code=${resolved.code}`);
      return;
    }
    const detail = fieldName === 'candidate'
      ? (p.candidate?.candidate || '').slice(0, 60)
      : (p[fieldName]?.sdp || '').length;
    console.log(`[${eventName}] fwd ${userId}→${to} detail=${detail}`);
    io.to(`user_${to}`).emit(eventName, { from: userId, [fieldName]: p[fieldName], callId: resolved.callId });
  }
  socket.on('call:offer', payload => forwardSignal('call:offer', 'offer', payload));
  socket.on('call:answer', payload => forwardSignal('call:answer', 'answer', payload));
  socket.on('call:ice', payload => forwardSignal('call:ice', 'candidate', payload));

  socket.on('call:end', (payload) => {
    // P0-002 强校验：负载必须是对象，to 必须是合法字符串 ID
    const p = guardPayload(socket, 'call:end', payload);
    if (!p) return;
    const to = guardId(socket, 'call:end', 'to', p.to);
    if (!to) return;
    const reason = typeof p.reason === 'string' ? p.reason : undefined;
    const resolved = resolveCall(p, to, 'call:end');
    if (!resolved) return;
    if (!resolved.ok) { reportResolutionError('call:end', resolved); return; }
    const callId = resolved.callId;
    // 挂断可能来自任一方，两个方向都查
    const k1 = `${userId}>${to}`;
    const k2 = `${to}>${userId}`;
    const c = activeCalls.get(k1) || activeCalls.get(k2);
    if (c && c.id === callId) {
      if (c.timer) clearTimeout(c.timer); // 取消超时定时器（fix: 主动挂断不再等待超时）
      const end = nowSec();
      // 主动挂断(任一方) → 聊天窗口系统消息:接通过=「通话时长 X」;未接通=主叫「已取消」/被叫「未接来电」
      // 真实主叫方向取 activeCalls 的 key（挂断发起者可能正是被叫，k1 方向不可靠）
      const realKey = [...activeCalls].find(([, call]) => call.id === callId)?.[0] || k1;
      const [callerId2, calleeId2] = realKey.split('>');
      writeCallMessage({
        callId: c.id,
        status: c.answeredAt ? 'completed' : 'canceled',
        duration: c.answeredAt ? Math.max(0, end - c.answeredAt) : 0,
        callType: c.type, callerId: callerId2, calleeId: calleeId2,
      }, io);
      if (c.answeredAt) {
        write("UPDATE call_logs SET status='completed', ended_at=?, duration=? WHERE id=?",
          [end, Math.max(0, end - c.answeredAt), c.id]);
      } else {
        write("UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?", [end, c.id]);
      }
      activeCalls.delete(k1);
      activeCalls.delete(k2);
      registry.end(callId);
      // 只有活跃通话存在时才转发：防止任意用户强制关闭他人通话界面（带 callId，P1-3）
      io.to(`user_${to}`).emit('call:end', { from: userId, reason, callId: c.id });
      // 2026-08-30 修复（多端不同步，同一类问题）：挂断动作此前只广播给了对方(to)，挂断
      // 发起者(userId)自己的其他在线设备完全不知道已经在别的设备上挂断了。事件/payload
      // 跟发给对方那份完全一致，直接复用，不需要客户端新增监听。用 socket.to()（不含当前
      // 挂断的这台设备自己）避免操作设备收到自己挂断动作的回声后又重复处理一遍。
      socket.to(`user_${userId}`).emit('call:end', { from: userId, reason, callId: c.id });
      // 通话已结束 → 清除冷却，允许立即重拨（P1-1）
      callRateMap.delete(userId);
    }
  });

  socket.on('call:resume', (payload) => {
    const p = guardPayload(socket, 'call:resume', payload);
    if (!p) return;
    const callId = guardId(socket, 'call:resume', 'callId', p.callId);
    if (!callId) return;
    const session = registry.get(callId);
    if (!session) {
      socket.emit('call:end', { reason: 'server_restarted', callId });
      return;
    }
    if (session.kind !== 'private') {
      socket.emit('call:error', { code: 'CALL_ID_MISMATCH', event: 'call:resume', callId });
      return;
    }
    const resumed = registry.resume(callId, userId, socket.id);
    if (!resumed.ok) reportResolutionError('call:resume', resumed);
  });

  // 只解绑当前参与 Socket；最后一条参与连接断开后由 registry 启动重连宽限。
  socket.on('disconnect', () => {
    registry.unbindSocket(userId, socket.id);
  });
}

registerCallHandler.handleGraceExpired = cleanupExpiredPrivateCall;

module.exports = registerCallHandler;
