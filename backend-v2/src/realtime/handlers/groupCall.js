'use strict';
/**
 * 群音视频通话信令（mesh 网状，纯转发，服务端不参与媒体）。
 *
 * mesh 拓扑：N 个参与者两两建立 PeerConnection，无媒体服务器，零额外基建。
 * 适合小群（上限 MAX_PARTICIPANTS=9，再多带宽吃不消，需上 SFU 另议）。
 *
 * 防 glare（双方同时 offer）约定：
 *   新加入者 N 作为 answerer；房间内每个既有成员各自向 N 发 offer，N 逐个 answer。
 *   既有成员之间的连接在各自加入时已建好，无需重连。
 *
 * 事件（client → server → 定向 client）：
 *   group_call:start  {conversationId, type}        发起 → 服务端建 callId，向群成员广播 group_call:invite
 *   group_call:join   {callId}                       加入 → 回 group_call:peers(既有成员)，并通知既有成员 group_call:peer_joined
 *   group_call:offer  {callId, to, offer}            既有成员 → 新成员
 *   group_call:answer {callId, to, answer}           新成员 → 既有成员
 *   group_call:ice    {callId, to, candidate}        双向 ICE
 *   group_call:leave  {callId}                        主动离开 → 立即释放，通知其余成员 group_call:peer_left；空了则结束
 *   group_call:resume {callId}                        断线重连宽限期内恢复 → 取消宽限计时器；
 *                                                      session 已不存在则回 group_call:ended{reason:'server_restarted'}
 *
 * 2026-08-31（Task 3）：全局忙线占用（含跟 1对1 通话互斥）交给 callSessionRegistry 统一管理
 * （见 realtime/callSessionRegistry.js、realtime/index.js 的接线）。断线不再"仅当该账号所有
 * socket 都断开才移除"这种立即判断，改成 registry 的重连宽限（默认15秒，CALL_RECONNECT_GRACE_MS
 * 配置），到期后由 registry 回调本文件导出的 handleGraceExpired 才真正移除该成员——短暂断线
 * 重连不会被踢出通话。
 */
const { v4: uuidv4 } = require('uuid');
const { readDb } = require('../../db/connection');
const { write } = require('../../db/writer');
const { isMember } = require('../../modules/messages/shared');
const { guardPayload, guardId } = require('../guard');

const MAX_PARTICIPANTS = 9;
const MAX_CALL_DURATION_MS = 4 * 60 * 60 * 1000; // 4小时强制结束，防单用户永久独占
const nowSec = () => Math.floor(Date.now() / 1000);

// 后台功能开关：群语音 / 群视频是否允许发起（默认开启，缺省或非 'off' 即开）。
// 直接读 admin_settings 表，避免引入 admin.service 造成循环依赖；每次发起时读，实时生效。
function groupCallAllowed(type) {
  const key = type === 'video' ? 'feature_group_video_call' : 'feature_group_voice_call';
  const v = readDb.prepare('SELECT value FROM admin_settings WHERE key=?').get(key)?.value;
  return v !== 'off';
}

// 模块级共享（单进程 fork）：callId -> { conversationId, type, startedBy, members:Set, peak, startedAt }
// mesh 成员/峰值/落库这些"通话本体"元数据仍留在这里；全局忙线占用（谁在哪通电话里，
// 私聊/群聊互斥）已经交给 callSessionRegistry 统一管理（2026-08-31 Task 3），
// 原来这里自己维护的 userId -> callId 的 userCall Map 已移除，改用
// registry.callForUser(userId)。
const groupCalls = new Map();

function endCall(io, registry, callId) {
  const call = groupCalls.get(callId);
  if (!call) return;
  if (call.timer) clearTimeout(call.timer);
  groupCalls.delete(callId);
  registry.end(callId);
  write("UPDATE group_call_logs SET status='ended', ended_at=?, participant_count=? WHERE id=?",
    [nowSec(), call.peak, callId]);
}

function removeMember(io, registry, callId, userId) {
  const call = groupCalls.get(callId);
  if (!call || !call.members.has(userId)) return;
  call.members.delete(userId);
  registry.releaseUser(callId, userId);
  // 通知其余成员该 peer 离开（关闭对应 PeerConnection / 移除画面）
  for (const uid of call.members) io.to(`user_${uid}`).emit('group_call:peer_left', { callId, userId });
  if (call.members.size === 0) endCall(io, registry, callId);
}

// 重连宽限到期后清理指定的群通话成员（registry 只触发回调，DB 与事件副作用仍归 handler）。
// 跟 1对1 不同：宽限到期只移除这一个成员，不结束整通通话（除非移除后成员数归零，
// removeMember 内部已有这条逻辑，复用不用重复）。
function handleGraceExpired(io, registry, { callId, userId, kind }) {
  if (kind !== 'group') return;
  removeMember(io, registry, callId, userId);
}

// registry 返回的机器可读 code 映射成这个模块历来的 group_call:error { reason } 词汇表，
// 不引入新的 payload 形状——四端目前只认 reason 字段，等 Task 6/7 做完客户端契约升级
// 前不能悄悄换掉。
function reasonForCode(code) {
  if (code === 'CALL_BUSY') return 'busy';
  if (code === 'CALL_NOT_FOUND') return 'not_found';
  return 'not_found'; // CALL_ID_MISMATCH 等：从客户端视角等价于"这通电话对它已经不存在"
}

module.exports = function registerGroupCallHandler(io, socket, registry) {
  const userId = socket.user.id;

  socket.on('group_call:start', (payload) => {
    // P0-002 强校验：负载必须是对象，conversationId 必须是合法字符串 ID
    const p = guardPayload(socket, 'group_call:start', payload);
    if (!p) return;
    const conversationId = guardId(socket, 'group_call:start', 'conversationId', p.conversationId);
    if (!conversationId) return;
    const rawType = p.type;
    // callType 枚举校验：缺省默认 audio；其余必须为字符串且∈{audio,video}，否则拒绝（与 call.js 口径一致）
    if (rawType != null && (typeof rawType !== 'string' || (rawType !== 'audio' && rawType !== 'video'))) {
      console.warn(`[realtime] 非法 callType 被拒绝 event=group_call:start type=${typeof rawType === 'string' ? rawType : typeof rawType} from=${userId}`);
      socket.emit('group_call:error', { reason: 'invalid_type' });
      return;
    }
    const type = rawType == null ? 'audio' : rawType;
    if (!isMember(conversationId, userId)) return;
    // 提前用 registry 查一次忙线（含私聊，跟群聊共用同一份 userSessions），省一次无谓的DB查询；
    // 真正原子的忙线判定在下面 registry.createGroup() 内部，这里只是快速失败路径。
    if (registry.callForUser(userId)) { socket.emit('group_call:error', { reason: 'busy' }); return; }
    const activeInConv = [...groupCalls.values()].find(c => c.conversationId === conversationId);
    if (activeInConv) { socket.emit('group_call:error', { reason: 'active_call' }); return; }
    const conv = readDb.prepare("SELECT type FROM conversations WHERE id=?").get(conversationId);
    if (!conv || conv.type !== 'group') { socket.emit('group_call:error', { reason: 'not_group' }); return; }

    const t = type === 'video' ? 'video' : 'audio';
    // 后台开关拦截：被关闭的通话类型直接拒绝发起（实时生效，无需重启/重连）
    if (!groupCallAllowed(t)) {
      socket.emit('group_call:error', { reason: t === 'video' ? 'video_disabled' : 'voice_disabled' });
      return;
    }

    const callId = uuidv4();
    const created = registry.createGroup({ callId, conversationId, startedBy: userId, socketId: socket.id, type: t });
    if (!created.ok) { socket.emit('group_call:error', { reason: reasonForCode(created.code) }); return; }
    const call = { conversationId, type: t, startedBy: userId, members: new Set([userId]), peak: 1, startedAt: nowSec(), timer: null };
    call.timer = setTimeout(() => {
      const c = groupCalls.get(callId);
      if (!c) return;
      console.warn(`[groupCall] 通话 ${callId} 超过4小时，强制结束`);
      for (const uid of [...c.members]) io.to(`user_${uid}`).emit('group_call:ended', { callId, reason: 'timeout' });
      endCall(io, registry, callId);
    }, MAX_CALL_DURATION_MS);
    groupCalls.set(callId, call);
    write('INSERT INTO group_call_logs (id,conversation_id,started_by,type,participant_count) VALUES (?,?,?,?,1)',
      [callId, conversationId, userId, t]);

    const starter = readDb.prepare('SELECT username, avatar FROM users WHERE id=?').get(userId);
    // 通知会话内其他成员有群通话邀请（conversationId 房间已在连接时 join）
    socket.to(conversationId).emit('group_call:invite', {
      callId, conversationId, type: t, from: userId,
      fromName: starter?.username, fromAvatar: starter?.avatar,
    });
    socket.emit('group_call:started', { callId, conversationId, type: t });
  });

  socket.on('group_call:join', (payload) => {
    const p = guardPayload(socket, 'group_call:join', payload);
    if (!p) return;
    const callId = guardId(socket, 'group_call:join', 'callId', p.callId);
    if (!callId) return;
    const call = groupCalls.get(callId);
    if (!call) { socket.emit('group_call:error', { reason: 'not_found', callId }); return; }
    if (!isMember(call.conversationId, userId)) return;
    const alreadyLocalMember = call.members.has(userId);
    // full 只拦截真正的新加入者；已经是成员的重复 join（比如换了个设备）不该被人数上限挡住。
    if (!alreadyLocalMember && call.members.size >= MAX_PARTICIPANTS) {
      socket.emit('group_call:error', { reason: 'full', callId }); return;
    }
    // registry.occupy 内部已经处理了"已是成员→幂等绑定新 socket"和"忙线（含私聊）"两种情况，
    // 不需要再单独查 userCall。
    const joined = registry.occupy(callId, userId, socket.id);
    if (!joined.ok) { socket.emit('group_call:error', { reason: reasonForCode(joined.code), callId }); return; }
    if (joined.alreadyMember) return; // 幂等：不重复广播 peers/peer_joined

    const peers = [...call.members];                            // 既有成员（加入前）
    call.members.add(userId);
    call.peak = Math.max(call.peak, call.members.size);

    // 回给加入者：当前已有成员列表（它将作为 answerer 等待这些人的 offer）
    socket.emit('group_call:peers', { callId, conversationId: call.conversationId, type: call.type, peers });
    // 通知既有成员：新 peer 加入 → 各自向其发起 offer（mesh，避免 glare）
    for (const uid of peers) io.to(`user_${uid}`).emit('group_call:peer_joined', { callId, userId });
  });

  // 纯定向转发：附带 from，让接收端知道是哪条连接
  socket.on('group_call:offer',  (payload) => { const p = guardPayload(socket, 'group_call:offer', payload); if (!p) return; const { callId, to, offer } = p; fwd('group_call:offer',  { callId, from: userId, offer }, to, callId); });
  socket.on('group_call:answer', (payload) => { const p = guardPayload(socket, 'group_call:answer', payload); if (!p) return; const { callId, to, answer } = p; fwd('group_call:answer', { callId, from: userId, answer }, to, callId); });
  socket.on('group_call:ice',    (payload) => { const p = guardPayload(socket, 'group_call:ice', payload); if (!p) return; const { callId, to, candidate } = p; fwd('group_call:ice',    { callId, from: userId, candidate }, to, callId); });

  function fwd(event, payload, to, callId) {
    if (typeof to !== 'string' || !to || to.length > 64) return;
    if (typeof callId !== 'string' || !callId || callId.length > 64) return;
    const call = groupCalls.get(callId);
    if (!call || !call.members.has(userId) || !call.members.has(to)) return; // 只在同一通话成员间转发
    io.to(`user_${to}`).emit(event, payload);
  }

  socket.on('group_call:leave', (payload) => {
    const p = guardPayload(socket, 'group_call:leave', payload);
    if (!p) return;
    const callId = guardId(socket, 'group_call:leave', 'callId', p.callId);
    if (!callId) return;
    removeMember(io, registry, callId, userId); // 主动 leave：立即释放，不走宽限
  });

  socket.on('group_call:resume', (payload) => {
    const p = guardPayload(socket, 'group_call:resume', payload);
    if (!p) return;
    const callId = guardId(socket, 'group_call:resume', 'callId', p.callId);
    if (!callId) return;
    const session = registry.get(callId);
    if (!session) {
      socket.emit('group_call:ended', { callId, reason: 'server_restarted' });
      return;
    }
    if (session.kind !== 'group') {
      socket.emit('group_call:error', { reason: 'not_found', callId });
      return;
    }
    const resumed = registry.resume(callId, userId, socket.id);
    if (!resumed.ok) socket.emit('group_call:error', { reason: reasonForCode(resumed.code), callId });
  });

  // 断线：只解绑当前这一条 Socket；该用户在这通群通话里的最后一条参与 Socket 断开后，
  // registry 会启动重连宽限（跟 1对1 用同一份 CALL_RECONNECT_GRACE_MS 配置），到期后
  // 由下方导出的 handleGraceExpired 调用 removeMember 真正移除该成员——不再是"断线立即踢出"。
  socket.on('disconnect', () => {
    registry.unbindSocket(userId, socket.id);
  });
};

module.exports.handleGraceExpired = handleGraceExpired;
module.exports._state = { groupCalls, MAX_PARTICIPANTS }; // 供测试/监控（userCall 已移除，改用 registry.callForUser）
