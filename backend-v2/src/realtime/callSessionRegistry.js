'use strict';

const crypto = require('crypto');

const CALL_BUSY = 'CALL_BUSY';
const CALL_NOT_FOUND = 'CALL_NOT_FOUND';
const CALL_ID_MISMATCH = 'CALL_ID_MISMATCH';

// Q06 全修（2026-09-08）：resume 身份代际协议。userId 单独不足以证明"这就是原参与
// 设备"——jti 可被同账号多个标签/设备共享，同账号旁观 Socket 光凭 userId 就能对一个
// 已断开(在宽限期内)的参与者调用 resume 顶替上去，窃听/劫持通话（Q06 audit 设计审查
// ownership-design-review.md 阻断项 #1/#3）。方案：每个参与者第一次真正绑定 Socket 时
// 签发一个不透明 resumeToken，只经由直连 ack 回给那一条 Socket（绝不进房间广播）；
// 之后任何"换一个新 Socket"的绑定都必须证明持有这个 token。同一账号多端并发加入
// （已有产品行为，如 A 手机在通话中，A 又开一个 Web 标签页）继续走 bindSocket 的
// 免 token 路径——那不是"恢复丢失的连接"，是"追加一条活跃连接"，ordinary
// occupy/create/accept 路径不因此收紧。只有 resume() 明确声称"我在恢复"才强制要求
// token，且不管原 Socket 是否仍存活都要求（不然旁观者可以趁参与者还在线时抢注）。
function generateResumeToken() {
  return crypto.randomUUID();
}

/**
 * Stores process-local call ownership. Socket and persistence effects belong in
 * realtime handlers; this module only enforces membership and busy state.
 */
function createRegistry({
  graceMs = 15_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onGraceExpired = () => {},
} = {}) {
  const sessions = new Map();
  const userSessions = new Map();

  function ok(values = {}) {
    return { ok: true, ...values };
  }

  function failure(code, values = {}) {
    return { ok: false, code, ...values };
  }

  function addSocket(participant, socketId) {
    if (socketId) participant.socketIds.add(socketId);
  }

  function cancelGrace(participant) {
    if (!participant.graceTimer) return;
    clearTimer(participant.graceTimer.handle);
    participant.graceTimer = null;
  }

  function participantFor(session, userId) {
    return session && session.participants.get(userId);
  }

  function clearSession(callId) {
    const session = sessions.get(callId);
    if (!session) return false;

    for (const [userId, participant] of session.participants) {
      cancelGrace(participant);
      if (userSessions.get(userId) === callId) userSessions.delete(userId);
    }
    sessions.delete(callId);
    return true;
  }

  function scheduleGrace(session, userId, participant) {
    const timer = { handle: null };
    participant.graceTimer = timer;
    timer.handle = setTimer(() => {
      const activeSession = sessions.get(session.callId);
      const activeParticipant = participantFor(activeSession, userId);
      if (!activeParticipant || activeParticipant.graceTimer !== timer || activeParticipant.socketIds.size > 0) return;

      activeParticipant.graceTimer = null;
      onGraceExpired({ callId: session.callId, userId, kind: session.kind });
    }, graceMs);
  }

  function createSession({ callId, kind, participantIds, socketId, ...metadata }) {
    const existing = sessions.get(callId);
    if (existing) return existing;

    const session = {
      callId,
      kind,
      type: metadata.type || 'audio',
      conversationId: metadata.conversationId,
      participants: new Map(),
      startedBy: metadata.startedBy,
      createdAt: Date.now(),
      answeredAt: null,
      status: 'active',
    };

    for (const userId of participantIds) {
      session.participants.set(userId, { socketIds: new Set(), joinedAt: Date.now(), graceTimer: null, resumeToken: null });
      userSessions.set(userId, callId);
    }
    const owner = session.participants.get(metadata.socketOwnerId);
    if (owner) {
      owner.resumeToken = generateResumeToken();
      addSocket(owner, socketId);
    }
    sessions.set(callId, session);
    return session;
  }

  function createPrivate({ callId, callerId, calleeId, socketId, type, conversationId } = {}) {
    // 纵深防御：现有 call.js handler 已经在上游拦了"呼叫自己"（to === userId 直接
    // return），这里理论上不可达；但这个模块自称是忙线状态的原子边界，不应该完全
    // 依赖调用方纪律——万一未来接入点忘了做这层检查，不能让"参与者只有一个人"的
    // 私聊 session 被创建出来。
    if (!callerId || !calleeId || callerId === calleeId) {
      return failure(CALL_ID_MISMATCH, { callId });
    }
    const existing = sessions.get(callId);
    if (existing) {
      if (existing.kind !== 'private' || !existing.participants.has(callerId) || !existing.participants.has(calleeId)) {
        return failure(CALL_ID_MISMATCH, { callId });
      }
      const bound = bindSocket(callId, callerId, socketId);
      return bound.ok ? ok({ callId, alreadyExists: true, session: existing }) : bound;
    }

    const participantIds = [...new Set([callerId, calleeId])];
    for (const userId of participantIds) {
      const occupiedCallId = userSessions.get(userId);
      if (occupiedCallId) return failure(CALL_BUSY, { userId, callId: occupiedCallId });
    }

    const session = createSession({
      callId,
      kind: 'private',
      participantIds,
      socketId,
      socketOwnerId: callerId,
      type,
      conversationId,
      startedBy: callerId,
    });
    return ok({ callId, session, resumeToken: session.participants.get(callerId).resumeToken });
  }

  function createGroup({ callId, conversationId, startedBy, socketId, type } = {}) {
    const existing = sessions.get(callId);
    if (existing) {
      if (existing.kind !== 'group' || existing.conversationId !== conversationId || !existing.participants.has(startedBy)) {
        return failure(CALL_ID_MISMATCH, { callId });
      }
      const bound = bindSocket(callId, startedBy, socketId);
      return bound.ok ? ok({ callId, alreadyExists: true, session: existing }) : bound;
    }

    const occupiedCallId = userSessions.get(startedBy);
    if (occupiedCallId) return failure(CALL_BUSY, { userId: startedBy, callId: occupiedCallId });

    const session = createSession({
      callId,
      kind: 'group',
      participantIds: [startedBy],
      socketId,
      socketOwnerId: startedBy,
      type,
      conversationId,
      startedBy,
    });
    return ok({ callId, session, resumeToken: session.participants.get(startedBy).resumeToken });
  }

  function occupy(callId, userId, socketId) {
    const session = sessions.get(callId);
    if (!session) return failure(CALL_NOT_FOUND, { callId });
    if (session.kind !== 'group') return failure(CALL_ID_MISMATCH, { callId });

    const participant = participantFor(session, userId);
    if (participant) {
      const alreadyMember = true;
      const bound = bindSocket(callId, userId, socketId);
      return bound.ok ? ok({ callId, alreadyMember, session }) : bound;
    }

    const occupiedCallId = userSessions.get(userId);
    if (occupiedCallId) return failure(CALL_BUSY, { userId, callId: occupiedCallId });

    const newParticipant = {
      socketIds: new Set(), joinedAt: Date.now(), graceTimer: null,
      resumeToken: generateResumeToken(),
    };
    addSocket(newParticipant, socketId);
    session.participants.set(userId, newParticipant);
    userSessions.set(userId, callId);
    return ok({ callId, session, resumeToken: newParticipant.resumeToken });
  }

  // 一般绑定入口：create 的 owner 自绑、occupy 已是成员的重绑、call.js accept 时的
  // 被叫首绑均走这里。同账号多端并发追加连接（对方还活着）继续免 token——那是既有
  // 产品行为（如群通话同账号手机+Web 同时在线），不是"恢复丢失连接"的安全边界。
  // 只有参与者当前【没有任何存活连接】时才进入需要凭据的分支：
  //   - resumeToken 已签发过 → 必须是 isInitialBind 且此前从未绑定过(resumeToken
  //     仍为 null)才放行——这条路径只有 call.js 被叫首次 accept 会传 isInitialBind，
  //     ordinary occupy(group_call:join) 不传，因此在宽限期内的"另一台设备假装
  //     ordinary join"会在这里被挡（Q06 review 阻断项 #1）。
  //   - 已有 resumeToken 时不接受 isInitialBind 重新签发（防止已建立身份的参与者
  //     被人从头抢注一个新 token）。
  function bindSocket(callId, userId, socketId, { isInitialBind = false } = {}) {
    const session = sessions.get(callId);
    if (!session) return failure(CALL_NOT_FOUND, { callId });
    const participant = participantFor(session, userId);
    if (!participant || userSessions.get(userId) !== callId) return failure(CALL_ID_MISMATCH, { callId });

    if (participant.socketIds.has(socketId)) {
      cancelGrace(participant);
      return ok({ callId, userId, session, resumeToken: participant.resumeToken });
    }
    if (participant.socketIds.size > 0) {
      cancelGrace(participant);
      addSocket(participant, socketId);
      return ok({ callId, userId, session, resumeToken: participant.resumeToken });
    }
    if (participant.resumeToken != null || !isInitialBind) {
      return failure(CALL_ID_MISMATCH, { callId });
    }
    participant.resumeToken = generateResumeToken();
    cancelGrace(participant);
    addSocket(participant, socketId);
    return ok({ callId, userId, session, resumeToken: participant.resumeToken });
  }

  function unbindSocket(userId, socketId) {
    const callId = userSessions.get(userId);
    const session = sessions.get(callId);
    const participant = participantFor(session, userId);
    if (!participant || !participant.socketIds.has(socketId)) return { affected: false };

    participant.socketIds.delete(socketId);
    if (participant.socketIds.size > 0) return { affected: true, graceStarted: false, callId };
    if (!participant.graceTimer) scheduleGrace(session, userId, participant);
    return { affected: true, graceStarted: true, callId };
  }

  // resume 是"我在恢复一条丢失的连接"这个明确声明，必须始终验证 resumeToken——
  // 即使参与者眼下还有其它存活连接（Q06 review 要求的 required case：旁观者不能趁
  // 参与者仍在线时抢先 resume 占一个位置）。跟 bindSocket 的免 token 多端追加路径
  // 分开是有意的，不能合并成同一个"size>0 就放行"分支。
  function resume(callId, userId, socketId, resumeToken) {
    const session = sessions.get(callId);
    if (!session) return failure(CALL_NOT_FOUND, { callId });
    const participant = participantFor(session, userId);
    if (!participant || userSessions.get(userId) !== callId) return failure(CALL_ID_MISMATCH, { callId });

    if (participant.socketIds.has(socketId)) {
      cancelGrace(participant);
      return ok({ callId, userId, session });
    }
    if (!participant.resumeToken || resumeToken !== participant.resumeToken) {
      return failure(CALL_ID_MISMATCH, { callId });
    }
    cancelGrace(participant);
    addSocket(participant, socketId);
    return ok({ callId, userId, session });
  }

  function releaseUser(callId, userId) {
    const session = sessions.get(callId);
    if (!session) return failure(CALL_NOT_FOUND, { callId });
    const participant = participantFor(session, userId);
    if (!participant || userSessions.get(userId) !== callId) return failure(CALL_ID_MISMATCH, { callId });

    // 私聊只有两个参与者，"移除其中一个"在语义上就等于整通结束——不能像群聊那样只
    // 释放这一个人、让另一方继续占用着一个再也不会有对端的 session。这里必须整段
    // clearSession，否则调用方（未来 Task 2 的 handler）如果对私聊场景误用了这个函数
    // （比如宽限到期时调 releaseUser 而不是 end），另一方会永久卡在"占用中"——跟
    // 2026-08-30 修的"call:request 重拨覆盖未接听旧通话时漏发通知"是同一类孤儿状态
    // bug。把这条正确性焊死在这个模块内部，不依赖调用方记住"私聊要用 end、群聊才用
    // releaseUser"这条约定。
    if (session.kind === 'private') {
      clearSession(callId);
      return ok({ callId, userId, released: true, ended: true });
    }

    cancelGrace(participant);
    session.participants.delete(userId);
    userSessions.delete(userId);
    if (session.participants.size === 0) clearSession(callId);
    return ok({ callId, userId, released: true });
  }

  function end(callId) {
    if (!sessions.has(callId)) return failure(CALL_NOT_FOUND, { callId });
    clearSession(callId);
    return ok({ callId, ended: true });
  }

  function get(callId) {
    return sessions.get(callId);
  }

  function callForUser(userId) {
    return userSessions.get(userId);
  }

  function validatePrivate(callId, userId, peerId) {
    const session = sessions.get(callId);
    if (!session) return failure(CALL_NOT_FOUND, { callId });
    if (
      session.kind !== 'private' ||
      !participantFor(session, userId) ||
      !participantFor(session, peerId) ||
      userSessions.get(userId) !== callId ||
      userSessions.get(peerId) !== callId
    ) {
      return failure(CALL_ID_MISMATCH, { callId });
    }
    return ok({ callId, session });
  }

  function resolvePrivateCall(userId, peerId) {
    const callId = userSessions.get(userId);
    if (!callId) return failure(CALL_NOT_FOUND);
    return validatePrivate(callId, userId, peerId);
  }

  function reset() {
    for (const callId of [...sessions.keys()]) clearSession(callId);
    return ok({ reset: true });
  }

  return {
    createPrivate,
    createGroup,
    occupy,
    bindSocket,
    unbindSocket,
    resume,
    releaseUser,
    end,
    get,
    callForUser,
    validatePrivate,
    resolvePrivateCall,
    reset,
    _state: { sessions, userSessions },
  };
}

module.exports = createRegistry;
