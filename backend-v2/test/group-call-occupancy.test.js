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
    alice.handlers['group_call:start']({ conversationId: 'conv-start-busy', type: 'audio' });

    expect(alice.last('group_call:error').payload.reason).toBe('busy');
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

  test('joining twice with a second device is idempotent and does not re-broadcast', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice', 'alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-idempotent-join', type: 'audio' });
    const callId = alice.last('group_call:started').payload.callId;

    const bobWeb = createSocket('bob', 'bob-web', io);
    registerGroupCallHandler(io, bobWeb, registry);
    bobWeb.handlers['group_call:join']({ callId });
    io.emitted.length = 0; // 只关心第二次 join 的行为

    const bobPhone = createSocket('bob', 'bob-phone', io);
    registerGroupCallHandler(io, bobPhone, registry);
    bobPhone.handlers['group_call:join']({ callId });

    expect(io.events('group_call:peer_joined')).toHaveLength(0); // 幂等：不重复广播
    expect(registry.get(callId).participants.get('bob').socketIds).toEqual(new Set(['bob-web', 'bob-phone']));
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
    io.emitted.length = 0;

    bob.handlers.disconnect();
    const bobReconnected = createSocket('bob', 'bob-web-2', io);
    registerGroupCallHandler(io, bobReconnected, registry);
    bobReconnected.handlers['group_call:resume']({ callId });

    jest.advanceTimersByTime(15_000);

    expect(io.events('group_call:peer_left')).toHaveLength(0);
    expect(registry.get(callId).participants.get('bob').socketIds).toEqual(new Set(['bob-web-2']));
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
