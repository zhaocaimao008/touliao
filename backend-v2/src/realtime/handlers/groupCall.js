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
 *   group_call:leave  {callId}                        离开 → 通知其余成员 group_call:peer_left；空了则结束
 *   （断线自动按 leave 处理）
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { isMember } = require('../../modules/messages/shared');
const presence = require('../presence');

const MAX_PARTICIPANTS = 9;
const nowSec = () => Math.floor(Date.now() / 1000);

// 模块级共享（单进程 fork）：callId -> { conversationId, type, startedBy, members:Set, peak, startedAt }
const groupCalls = new Map();
// userId -> callId：一个用户同一时刻只在一个群通话内，便于断线清理与忙线判断
const userCall = new Map();

function endCall(io, callId) {
  const call = groupCalls.get(callId);
  if (!call) return;
  for (const uid of call.members) if (userCall.get(uid) === callId) userCall.delete(uid);
  groupCalls.delete(callId);
  try {
    db.prepare("UPDATE group_call_logs SET status='ended', ended_at=?, participant_count=? WHERE id=?")
      .run(nowSec(), call.peak, callId);
  } catch (e) { console.warn('[groupCall] end 落库失败:', e.message); }
}

function removeMember(io, callId, userId) {
  const call = groupCalls.get(callId);
  if (!call || !call.members.has(userId)) return;
  call.members.delete(userId);
  if (userCall.get(userId) === callId) userCall.delete(userId);
  // 通知其余成员该 peer 离开（关闭对应 PeerConnection / 移除画面）
  for (const uid of call.members) io.to(`user_${uid}`).emit('group_call:peer_left', { callId, userId });
  if (call.members.size === 0) endCall(io, callId);
}

module.exports = function registerGroupCallHandler(io, socket) {
  const userId = socket.user.id;

  socket.on('group_call:start', ({ conversationId, type }) => {
    if (!conversationId || !isMember(conversationId, userId)) return;
    if (userCall.has(userId)) { socket.emit('group_call:error', { reason: 'busy' }); return; }
    const conv = db.prepare("SELECT type FROM conversations WHERE id=?").get(conversationId);
    if (!conv || conv.type !== 'group') { socket.emit('group_call:error', { reason: 'not_group' }); return; }

    const callId = uuidv4();
    const t = type === 'video' ? 'video' : 'audio';
    const call = { conversationId, type: t, startedBy: userId, members: new Set([userId]), peak: 1, startedAt: nowSec() };
    groupCalls.set(callId, call);
    userCall.set(userId, callId);
    try {
      db.prepare('INSERT INTO group_call_logs (id,conversation_id,started_by,type,participant_count) VALUES (?,?,?,?,1)')
        .run(callId, conversationId, userId, t);
    } catch (e) { console.warn('[groupCall] start 落库失败:', e.message); }

    const starter = db.prepare('SELECT username, avatar FROM users WHERE id=?').get(userId);
    // 通知会话内其他成员有群通话邀请（conversationId 房间已在连接时 join）
    socket.to(conversationId).emit('group_call:invite', {
      callId, conversationId, type: t, from: userId,
      fromName: starter?.username, fromAvatar: starter?.avatar,
    });
    socket.emit('group_call:started', { callId, conversationId, type: t });
  });

  socket.on('group_call:join', ({ callId }) => {
    const call = groupCalls.get(callId);
    if (!call) { socket.emit('group_call:error', { reason: 'not_found', callId }); return; }
    if (!isMember(call.conversationId, userId)) return;
    if (call.members.has(userId)) return;                       // 幂等
    if (call.members.size >= MAX_PARTICIPANTS) { socket.emit('group_call:error', { reason: 'full', callId }); return; }
    if (userCall.has(userId)) { socket.emit('group_call:error', { reason: 'busy' }); return; }

    const peers = [...call.members];                            // 既有成员（加入前）
    call.members.add(userId);
    call.peak = Math.max(call.peak, call.members.size);
    userCall.set(userId, callId);

    // 回给加入者：当前已有成员列表（它将作为 answerer 等待这些人的 offer）
    socket.emit('group_call:peers', { callId, conversationId: call.conversationId, type: call.type, peers });
    // 通知既有成员：新 peer 加入 → 各自向其发起 offer（mesh，避免 glare）
    for (const uid of peers) io.to(`user_${uid}`).emit('group_call:peer_joined', { callId, userId });
  });

  // 纯定向转发：附带 from，让接收端知道是哪条连接
  socket.on('group_call:offer',  ({ callId, to, offer })     => fwd('group_call:offer',  { callId, from: userId, offer }, to, callId));
  socket.on('group_call:answer', ({ callId, to, answer })    => fwd('group_call:answer', { callId, from: userId, answer }, to, callId));
  socket.on('group_call:ice',    ({ callId, to, candidate }) => fwd('group_call:ice',    { callId, from: userId, candidate }, to, callId));

  function fwd(event, payload, to, callId) {
    if (!to) return;
    const call = groupCalls.get(callId);
    if (!call || !call.members.has(userId) || !call.members.has(to)) return; // 只在同一通话成员间转发
    io.to(`user_${to}`).emit(event, payload);
  }

  socket.on('group_call:leave', ({ callId }) => removeMember(io, callId, userId));

  // 断线：仅当该账号所有 socket 都断开时才移除通话（多端场景：一端断线不应踢出通话）
  socket.on('disconnect', () => {
    const callId = userCall.get(userId);
    if (!callId) return;
    // disconnect 触发时 presence 尚未调用 removeSocket，size 仍含本 socket，减 1 得剩余数
    const remaining = (presence.onlineUsers.get(userId)?.size || 0) - 1;
    if (remaining <= 0) removeMember(io, callId, userId);
  });
};

module.exports._state = { groupCalls, userCall, MAX_PARTICIPANTS }; // 供测试/监控
