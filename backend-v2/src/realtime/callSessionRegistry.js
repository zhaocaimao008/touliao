'use strict';

const CALL_BUSY = 'CALL_BUSY';
const CALL_NOT_FOUND = 'CALL_NOT_FOUND';
const CALL_ID_MISMATCH = 'CALL_ID_MISMATCH';

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
      session.participants.set(userId, { socketIds: new Set(), joinedAt: Date.now(), graceTimer: null });
      userSessions.set(userId, callId);
    }
    addSocket(session.participants.get(metadata.socketOwnerId), socketId);
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
    return ok({ callId, session });
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
    return ok({ callId, session });
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

    const newParticipant = { socketIds: new Set(), joinedAt: Date.now(), graceTimer: null };
    addSocket(newParticipant, socketId);
    session.participants.set(userId, newParticipant);
    userSessions.set(userId, callId);
    return ok({ callId, session });
  }

  function bindSocket(callId, userId, socketId) {
    const session = sessions.get(callId);
    if (!session) return failure(CALL_NOT_FOUND, { callId });
    const participant = participantFor(session, userId);
    if (!participant || userSessions.get(userId) !== callId) return failure(CALL_ID_MISMATCH, { callId });

    cancelGrace(participant);
    addSocket(participant, socketId);
    return ok({ callId, userId, session });
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

  function resume(callId, userId, socketId) {
    return bindSocket(callId, userId, socketId);
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
