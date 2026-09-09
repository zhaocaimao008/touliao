'use strict';

jest.mock('../src/db/connection', () => ({
  readDb: {
    prepare: jest.fn(sql => ({
      get: jest.fn(() => {
        if (sql.includes('admin_settings')) return undefined; // 未关闭 => groupCallAllowed() 返回 true
        if (sql.includes('FROM conversations')) return { type: 'group' };
        // call.js 的 call:request 也会在这个文件的测试里被调用（跨通话忙线互斥），
        // 需要 blocked_users/conversation_members 两条查询都过：blocked 查不到即
        // 未拉黑（undefined 已经是期望值）；conversation_members 必须给个真值，
        // 否则会被 !shareConv 那条分支拦在 registry 忙线检查之前，永远走不到。
        if (sql.includes('conversation_members')) return { allowed: 1 };
        return undefined;
      }),
      all: jest.fn(() => []),
    })),
  },
}));
jest.mock('../src/db/writer', () => ({ write: jest.fn() }));
jest.mock('../src/modules/messages/shared', () => ({ isMember: jest.fn(() => true) }));

const createRegistryFactory = require('../src/realtime/callSessionRegistry');
const registerGroupCallHandler = require('../src/realtime/handlers/groupCall');
const registerCallHandler = require('../src/realtime/handlers/call');
const { write } = require('../src/db/writer');

const registries = [];
function createRegistry(options) {
  const registry = createRegistryFactory(options);
  registries.push(registry);
  return registry;
}

function createIoHarness() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
        },
      };
    },
    events(event) {
      return emitted.filter(item => item.event === event);
    },
    last(event) {
      return this.events(event).at(-1);
    },
  };
}

function createSocket(userId, socketId, io) {
  const handlers = {};
  const emitted = [];
  return {
    id: socketId,
    authToken: 'synthetic-auth-token',
    user: { id: userId },
    handlers,
    emitted,
    on(event, handler) { handlers[event] = handler; return this; },
    emit(event, payload) { emitted.push({ event, payload }); return this; },
    to(room) { return io.to(room); },
    last(event) { return emitted.filter(item => item.event === event).at(-1); },
  };
}

describe('group call occupancy contract', () => {
  beforeAll(() => jest.useFakeTimers());
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    for (const registry of registries.splice(0)) registry.reset();
    jest.clearAllTimers();
  });
  afterAll(() => jest.useRealTimers());

  test('user in private call cannot start a group call', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    registry.createPrivate({ callId: 'private-1', callerId: 'alice', calleeId: 'bob', socketId: 'alice-web' });

    const alice = createSocket('alice', 'alice-group-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({
      conversationId: 'conv-start-busy',
      type: 'audio',
      requestId: 'attempt-start-busy',
    });

    expect(alice.last('group_call:error').payload).toEqual({
      reason: 'busy',
      requestId: 'attempt-start-busy',
    });
  });

  test('private call cannot be started while occupying a group call', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    registry.createGroup({ callId: 'group-1', conversationId: 'conv-private-busy', startedBy: 'alice', socketId: 'alice-group-web', type: 'audio' });

    const alice = createSocket('alice', 'alice-web', io);
    registerCallHandler(io, alice, registry);
    alice.handlers['call:request']({ to: 'bob', type: 'audio' }, jest.fn());

    expect(alice.last('call:error').payload.code).toBe('CALL_BUSY');
  });

  test('start creates a registry session and broadcasts invite', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);

    alice.handlers['group_call:start']({ conversationId: 'conv-start-ok', type: 'audio' });

    const started = alice.last('group_call:started');
    expect(started).toBeDefined();
    const callId = started.payload.callId;
    expect(registry.callForUser('alice')).toBe(callId);
    expect(registry.get(callId)).toMatchObject({ kind: 'group', conversationId: 'conv-start-ok' });
    expect(io.last('group_call:invite').payload.callId).toBe(callId);
    expect(started.payload).not.toHaveProperty('requestId'); // legacy request stays compatible
  });

  test('start echoes its requestId only to the initiating socket', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice-attempt', 'alice-attempt-web', io);
    registerGroupCallHandler(io, alice, registry);

    alice.handlers['group_call:start']({
      conversationId: 'conv-start-attempt',
      type: 'audio',
      requestId: 'attempt-current',
    });

    expect(alice.last('group_call:started').payload).toMatchObject({
      callId: expect.any(String),
      requestId: 'attempt-current',
    });
    expect(io.last('group_call:invite').payload).not.toHaveProperty('requestId');
  });

  test('join adds a registry occupant and broadcasts to existing members', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-join', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    const bob = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:join']({ callId });

    expect(registry.callForUser('bob')).toBe(callId);
    expect(bob.last('group_call:peers').payload.peers).toEqual(['alice']);
    expect(io.last('group_call:peer_joined').payload).toEqual({ callId, userId: 'bob' });
  });

  test('rejoining with the exact same socket is idempotent and does not re-broadcast', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-idempotent-join', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    const bob = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:join']({ callId });
    io.emitted.length = 0; // 只关心第二次 join 的行为

    bob.handlers['group_call:join']({ callId }); // 同一条 Socket 重复 join：保持幂等

    expect(io.events('group_call:peer_joined')).toHaveLength(0); // 幂等：不重复广播
    expect(registry.get(callId).participants.get('bob').socketIds).toEqual(new Set(['bob-web']));
  });

  test('Q11 保留第一台拒绝第二台：同账号第二台设备 join 被明确拒绝，不静默并入、不影响第一台', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-second-device-join', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    const bobWeb = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bobWeb, registry);
    bobWeb.handlers['group_call:join']({ callId });
    io.emitted.length = 0; // 只关心第二台设备 join 的行为

    const bobPhone = createSocket('bob', 'bob-phone', io);
    registerGroupCallHandler(io, bobPhone, registry);
    bobPhone.handlers['group_call:join']({ callId });

    // 审计报告原文复现的正是"第二次 join 后绑定 Socket 数 2、给 B2 回包 0"——
    // 这里改成 B2 拿到明确的 group_call:error(busy)，不再是沉默的 0 回包。
    expect(bobPhone.last('group_call:error').payload.reason).toBe('busy');
    expect(io.events('group_call:peer_joined')).toHaveLength(0);
    expect(registry.get(callId).participants.get('bob').socketIds).toEqual(new Set(['bob-web'])); // 第一台不受影响
  });

  test('a user already busy in another private call cannot join a group call', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-join-busy', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    registry.createPrivate({ callId: 'private-1', callerId: 'bob', calleeId: 'carol', socketId: 'bob-other' });
    const bob = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:join']({ callId });

    expect(bob.last('group_call:error').payload.reason).toBe('busy');
    expect(registry.callForUser('bob')).toBe('private-1'); // 没被顶掉
  });

  test('leave releases the registry occupancy immediately and notifies remaining members', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-leave', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    const bob = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:join']({ callId });

    bob.handlers['group_call:leave']({ callId });

    expect(registry.callForUser('bob')).toBeUndefined();
    expect(io.last('group_call:peer_left').payload).toEqual({ callId, userId: 'bob' });
    expect(registry.get(callId)).toBeDefined(); // alice 还在，通话没结束
  });

  test('Q11 保留第一台拒绝第二台：一个从未真正加入的同账号旁观 Socket 不能靠 leave 把真正在场的那台踢出去', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-q11-leave', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    const bob = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:join']({ callId });
    io.emitted.length = 0;

    // bob 的第二台设备从未真正 join 成功（比如恰好撞上宽限期被 Q06 拒绝，或者单纯
    // 就是知道 callId 但没走过 occupy）——它对同一个 callId 发 leave，不该影响
    // bob-web 这台真正在场的连接。
    const bobBystander = createSocket('bob', 'bob-bystander', io);
    registerGroupCallHandler(io, bobBystander, registry);
    bobBystander.handlers['group_call:leave']({ callId });

    expect(io.events('group_call:peer_left')).toHaveLength(0); // 没有被误移除
    expect(registry.callForUser('bob')).toBe(callId);
    expect(registry.get(callId).participants.get('bob').socketIds).toEqual(new Set(['bob-web']));
  });

  test('Q11：未真正绑定的旁观 Socket 不能冒充成员转发 offer/answer/ice', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-q11-fwd', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    const bob = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:join']({ callId });
    io.emitted.length = 0;

    const bobBystander = createSocket('bob', 'bob-bystander', io);
    registerGroupCallHandler(io, bobBystander, registry);
    bobBystander.handlers['group_call:offer']({ callId, to: 'alice', offer: { sdp: 'x', type: 'offer' } });

    expect(io.events('group_call:offer')).toHaveLength(0);

    // 对照：真正绑定的 bob-web 能正常转发
    bob.handlers['group_call:offer']({ callId, to: 'alice', offer: { sdp: 'x', type: 'offer' } });
    expect(io.last('group_call:offer').payload).toEqual({ callId, from: 'bob', offer: { sdp: 'x', type: 'offer' } });
  });

  test('last member leaving ends the call in both groupCalls bookkeeping and the registry', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-last-leave', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    alice.handlers['group_call:leave']({ callId });

    expect(registry.get(callId)).toBeUndefined();
    expect(registry.callForUser('alice')).toBeUndefined();
    expect(write).toHaveBeenCalledWith(
      "UPDATE group_call_logs SET status='ended', ended_at=?, participant_count=? WHERE id=?",
      [expect.any(Number), 1, callId]
    );
  });

  test('disconnecting an unrelated socket does not start a grace timer or remove the member', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const aliceGroupSocket = createSocket('alice', 'alice-group-web', io);
    registerGroupCallHandler(io, aliceGroupSocket, registry);
    aliceGroupSocket.handlers['group_call:start']({ conversationId: 'conv-unrelated-disconnect', type: 'audio' });
    const callId = aliceGroupSocket.last('group_call:started').payload.callId;

    // alice 的另一台设备，从没加入过任何通话，跟这通群通话无关
    const aliceOtherSocket = createSocket('alice', 'alice-unrelated-phone', io);
    registerGroupCallHandler(io, aliceOtherSocket, registry);
    aliceOtherSocket.handlers.disconnect();

    expect(io.events('group_call:peer_left')).toHaveLength(0);
    expect(registry.callForUser('alice')).toBe(callId);
  });

  test('disconnect starts reconnect grace; resume within grace cancels member removal', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-resume-grace', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    const bob = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:join']({ callId });
    const resumeToken = bob.last('group_call:peers').payload.resumeToken;
    io.emitted.length = 0;

    bob.handlers.disconnect();
    const bobReconnected = createSocket('bob', 'bob-web-2', io);
    registerGroupCallHandler(io, bobReconnected, registry);
    // Q06 全修：resume 必须带上加入时签发的 resumeToken，光凭 callId+userId 不再够。
    bobReconnected.handlers['group_call:resume']({ callId, resumeToken });

    jest.advanceTimersByTime(15_000);

    expect(io.events('group_call:peer_left')).toHaveLength(0);
    expect(registry.get(callId).participants.get('bob').socketIds).toEqual(new Set(['bob-web-2']));
  });

  test('resume without the resumeToken issued at join cannot reclaim a disconnected member\'s slot (Q06 ownership bypass)', () => {
    const io = createIoHarness();
    let registry;
    registry = createRegistry({
      onGraceExpired: info => registerGroupCallHandler.handleGraceExpired(io, registry, info),
    });
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-resume-no-token', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    const bob = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:join']({ callId });

    bob.handlers.disconnect(); // bob 进入宽限期，socketIds 归零

    // 一个不知道 resumeToken 的旁观 Socket（同账号 bob 的另一台设备，或者只是知道
    // callId 的人）不能靠普通 group_call:join（落到 occupy 的"已是成员"分支）
    // 或没带 token 的 group_call:resume 顶替进去。
    const bystanderJoin = createSocket('bob', 'bob-bystander-join', io);
    registerGroupCallHandler(io, bystanderJoin, registry);
    bystanderJoin.handlers['group_call:join']({ callId });
    // occupy() 落到 bindSocket 的"已断线、无凭据"分支被拒绝，group_call:join 按既有
    // CALL_ID_MISMATCH→'not_found' 映射回错误，不会静默把这个 socket 接进通话。
    expect(bystanderJoin.last('group_call:error').payload.reason).toBe('not_found');
    expect(registry.get(callId).participants.get('bob').socketIds.size).toBe(0);

    const bystanderResume = createSocket('bob', 'bob-bystander-resume', io);
    registerGroupCallHandler(io, bystanderResume, registry);
    bystanderResume.handlers['group_call:resume']({ callId });
    expect(bystanderResume.last('group_call:error').payload.reason).toBe('not_found');
    expect(registry.get(callId).participants.get('bob').socketIds.size).toBe(0);

    jest.advanceTimersByTime(15_000);
    expect(io.last('group_call:peer_left').payload).toEqual({ callId, userId: 'bob' }); // 宽限如期到期，没有被假恢复取消
  });

  test('grace expiry with no resume removes only that member, not the whole call', () => {
    const io = createIoHarness();
    let registry;
    registry = createRegistry({
      onGraceExpired: info => registerGroupCallHandler.handleGraceExpired(io, registry, info),
    });
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-grace-no-resume', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    const bob = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:join']({ callId });

    bob.handlers.disconnect();
    jest.advanceTimersByTime(15_000);

    expect(io.last('group_call:peer_left').payload).toEqual({ callId, userId: 'bob' });
    expect(registry.callForUser('bob')).toBeUndefined();
    expect(registry.get(callId)).toBeDefined(); // alice 还在，通话没结束
    expect(registry.callForUser('alice')).toBe(callId);
  });

  test('group_call:resume against a session the server no longer has returns server_restarted', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);

    alice.handlers['group_call:resume']({ callId: 'lost-during-restart' });

    expect(alice.last('group_call:ended').payload).toEqual({
      callId: 'lost-during-restart',
      reason: 'server_restarted',
    });
  });

  test('realtime dispatches group grace expiry to the group handler, not the private one', () => {
    jest.isolateModules(() => {
      const registerCall = jest.fn();
      registerCall.handleGraceExpired = jest.fn();
      const registerGroupCall = jest.fn();
      registerGroupCall.handleGraceExpired = jest.fn();
      const registerTyping = jest.fn(() => ({ cleanup: jest.fn() }));
      const connectionDb = { prepare: jest.fn(() => ({ get: jest.fn(), all: jest.fn(() => []) })) };
      const isolatedPresence = {
        onlineUsers: new Map(),
        isOnline: jest.fn(() => false),
        addSocket: jest.fn(),
        removeSocket: jest.fn(() => true),
        cacheProfile: jest.fn(),
        cleanupUser: jest.fn(),
        onlineUserIdSet: jest.fn(() => new Set()),
      };

      jest.doMock('../src/realtime/handlers/call', () => registerCall);
      jest.doMock('../src/realtime/handlers/groupCall', () => registerGroupCall);
      jest.doMock('../src/realtime/handlers/message', () => jest.fn());
      jest.doMock('../src/realtime/handlers/file', () => jest.fn());
      jest.doMock('../src/realtime/handlers/typing', () => registerTyping);
      jest.doMock('../src/realtime/handlers/nudge', () => jest.fn());
      jest.doMock('../src/realtime/presence', () => isolatedPresence);
      jest.doMock('../src/realtime/broadcaster', () => ({ setIo: jest.fn() }));
      jest.doMock('../src/utils/prodMetrics', () => ({
        recordConnAttempt: jest.fn(),
        recordConnResult: jest.fn(),
      }));
      jest.doMock('../src/utils/tokenBlacklist', () => ({ isBlacklisted: jest.fn(() => false) }));
      jest.doMock('../src/db/connection', () => ({ readDb: connectionDb }));
      jest.doMock('../src/db/writer', () => ({ write: jest.fn() }));

      const setupRealtime = require('../src/realtime');
      let connect;
      const io = {
        use: jest.fn(),
        on: jest.fn((event, handler) => { if (event === 'connection') connect = handler; }),
        to: jest.fn(() => ({ emit: jest.fn() })),
      };
      setupRealtime(io);
      const socket = {
        id: 'socket-group-wiring',
        authToken: 'synthetic-auth-token',
        user: { id: 'alice-group-wiring' },
        use: jest.fn(),
        join: jest.fn(),
        on: jest.fn(),
        to: jest.fn(() => ({ emit: jest.fn() })),
      };
      connect(socket);

      const groupRegistry = registerGroupCall.mock.calls[0][2];
      expect(groupRegistry).toBeDefined();

      groupRegistry.createGroup({
        callId: 'group-grace-wiring',
        conversationId: 'conv-wiring',
        startedBy: 'alice-group-wiring',
        socketId: 'socket-group-wiring',
      });
      groupRegistry.unbindSocket('alice-group-wiring', 'socket-group-wiring');
      jest.advanceTimersByTime(15_000);

      expect(registerGroupCall.handleGraceExpired).toHaveBeenCalledWith(io, groupRegistry, {
        callId: 'group-grace-wiring',
        userId: 'alice-group-wiring',
        kind: 'group',
      });
      expect(registerCall.handleGraceExpired).not.toHaveBeenCalled();
      groupRegistry.reset();
    });
  });
});
