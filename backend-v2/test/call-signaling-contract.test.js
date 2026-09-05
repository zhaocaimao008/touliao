'use strict';

jest.mock('../src/db/connection', () => ({
  readDb: {
    prepare: jest.fn(sql => ({
      get: jest.fn(() => {
        if (sql.includes('blocked_users')) return undefined;
        if (sql.includes('conversation_members')) return { allowed: 1 };
        if (sql.includes('FROM users')) return { username: 'Caller', avatar: null };
        return undefined;
      }),
      all: jest.fn(() => []),
    })),
  },
}));
jest.mock('../src/db/writer', () => ({ write: jest.fn() }));
jest.mock('../src/realtime/presence', () => ({
  onlineUsers: new Map(),
  isOnline: jest.fn(() => true),
  onlinePlatforms: jest.fn(() => new Set(['android'])),
  addSocket: jest.fn(),
  removeSocket: jest.fn(() => true),
  cacheProfile: jest.fn(),
  cleanupUser: jest.fn(),
  onlineUserIdSet: jest.fn(() => new Set()),
}));
jest.mock('../src/utils/push', () => ({ pushCallInvite: jest.fn(() => Promise.resolve()) }));

const createRegistryFactory = require('../src/realtime/callSessionRegistry');
const registerCallHandler = require('../src/realtime/handlers/call');
const config = require('../src/config');
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
    on(event, handler) {
      handlers[event] = handler;
      return this;
    },
    emit(event, payload) {
      emitted.push({ event, payload });
      return this;
    },
    to(room) {
      return io.to(room);
    },
    last(event) {
      return emitted.filter(item => item.event === event).at(-1);
    },
  };
}

describe('private call signaling contract', () => {
  beforeAll(() => jest.useFakeTimers());
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    config.calls.requireId = false;
    for (const registry of registries.splice(0)) registry.reset();
    jest.clearAllTimers();
  });
  afterAll(() => jest.useRealTimers());

  test('call reliability settings default to compatibility mode and 15 second grace', () => {
    expect(config.calls).toEqual({ requireId: false, reconnectGraceMs: 15_000 });
  });

  test('disconnecting an unrelated socket does not emit call:end', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const web = createSocket('alice-unrelated', 'web-a', io);
    const phone = createSocket('alice-unrelated', 'phone-a', io);
    registerCallHandler(io, web, registry);
    registerCallHandler(io, phone, registry);

    web.handlers['call:request']({ to: 'bob-unrelated', type: 'audio' }, jest.fn());
    phone.handlers.disconnect();

    expect(io.events('call:end')).toHaveLength(0);
  });

  test('stale offer is rejected and current offer is forwarded with callId', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice-offer', 'web-offer', io);
    registerCallHandler(io, alice, registry);
    const ack = jest.fn();
    const validOffer = { type: 'offer', sdp: 'v=0' };
    alice.handlers['call:request']({ to: 'bob-offer', type: 'audio' }, ack);
    const callId = ack.mock.calls[0][0].callId;

    alice.handlers['call:offer']({ to: 'bob-offer', callId: 'old', offer: validOffer });
    expect(io.events('call:offer')).toHaveLength(0);

    alice.handlers['call:offer']({ to: 'bob-offer', callId, offer: validOffer });
    expect(io.last('call:offer').payload.callId).toBe(callId);
  });

  test('private caller is rejected while occupying a group call', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    registry.createGroup({
      callId: 'group-busy',
      conversationId: 'group-conversation',
      startedBy: 'alice-busy',
      socketId: 'web-busy',
      type: 'audio',
    });
    const alice = createSocket('alice-busy', 'web-busy', io);
    registerCallHandler(io, alice, registry);

    alice.handlers['call:request']({ to: 'bob-busy', type: 'audio' }, jest.fn());

    expect(alice.last('call:error').payload.code).toBe('CALL_BUSY');
  });

  test('accepted response binds its socket and forwards the resolved callId', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice-response', 'web-response', io);
    const bob = createSocket('bob-response', 'phone-response', io);
    registerCallHandler(io, alice, registry);
    registerCallHandler(io, bob, registry);
    const ack = jest.fn();
    alice.handlers['call:request']({ to: 'bob-response', type: 'audio' }, ack);
    const callId = ack.mock.calls[0][0].callId;

    bob.handlers['call:response']({ to: 'alice-response', callId, accepted: true });

    expect(io.last('call:response').payload).toMatchObject({
      from: 'bob-response',
      accepted: true,
      callId,
    });
    expect(registry.get(callId).participants.get('bob-response').socketIds)
      .toContain('phone-response');
  });

  test('late rejection cannot terminate an already accepted call', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice-late-reject', 'web-late-reject', io);
    const bob = createSocket('bob-late-reject', 'phone-late-reject', io);
    registerCallHandler(io, alice, registry);
    registerCallHandler(io, bob, registry);
    const ack = jest.fn();
    alice.handlers['call:request']({ to: 'bob-late-reject', type: 'audio' }, ack);
    const callId = ack.mock.calls[0][0].callId;

    bob.handlers['call:response']({ to: 'alice-late-reject', callId, accepted: true });
    bob.handlers['call:response']({ to: 'alice-late-reject', callId, accepted: false });

    expect(registry.get(callId)).toBeDefined();
    expect(write).not.toHaveBeenCalledWith(
      "UPDATE call_logs SET status='rejected', ended_at=? WHERE id=?",
      expect.any(Array),
    );
  });

  test.each([
    ['call:answer', 'answer', { type: 'answer', sdp: 'v=0 answer' }],
    ['call:ice', 'candidate', { candidate: 'candidate:1' }],
  ])('%s forwards the canonical callId', (eventName, fieldName, signal) => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket(`alice-${fieldName}`, `web-${fieldName}`, io);
    registerCallHandler(io, alice, registry);
    const ack = jest.fn();
    const peerId = `bob-${fieldName}`;
    alice.handlers['call:request']({ to: peerId, type: 'audio' }, ack);
    const callId = ack.mock.calls[0][0].callId;

    alice.handlers[eventName]({ to: peerId, callId, [fieldName]: signal });

    expect(io.last(eventName).payload).toMatchObject({ callId, [fieldName]: signal });
  });

  test('call:end resolves old-client payloads and forwards the canonical callId', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice-end', 'web-end', io);
    registerCallHandler(io, alice, registry);
    const ack = jest.fn();
    alice.handlers['call:request']({ to: 'bob-end', type: 'audio' }, ack);
    const callId = ack.mock.calls[0][0].callId;

    alice.handlers['call:end']({ to: 'bob-end', reason: 'hangup' });

    expect(io.last('call:end').payload).toEqual({ from: 'alice-end', reason: 'hangup', callId });
    expect(registry.get(callId)).toBeUndefined();
  });

  test('strict mode rejects a missing callId without forwarding signaling', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice-strict', 'web-strict', io);
    registerCallHandler(io, alice, registry);
    alice.handlers['call:request']({ to: 'bob-strict', type: 'audio' }, jest.fn());
    config.calls.requireId = true;

    alice.handlers['call:offer']({ to: 'bob-strict', offer: { type: 'offer', sdp: 'v=0' } });

    expect(alice.last('call:error').payload.code).toBe('CALL_ID_REQUIRED');
    expect(io.events('call:offer')).toHaveLength(0);
  });

  test.each([42, { malicious: true }, ['call-id'], 'x'.repeat(65)])(
    'malformed callId %p cannot forward signaling', badCallId => {
      const io = createIoHarness();
      const registry = createRegistry();
      const alice = createSocket(`alice-malformed-${typeof badCallId}`, `socket-${typeof badCallId}`, io);
      registerCallHandler(io, alice, registry);
      const peerId = `bob-malformed-${typeof badCallId}`;
      alice.handlers['call:request']({ to: peerId, type: 'audio' }, jest.fn());

      expect(() => alice.handlers['call:ice']({
        to: peerId,
        callId: badCallId,
        candidate: { candidate: 'candidate:1' },
      })).not.toThrow();
      expect(io.events('call:ice')).toHaveLength(0);
      expect(alice.last('call:error').payload).toMatchObject({
        code: 'INVALID_CALL_REQUEST',
        field: 'callId',
      });
    }
  );

  test('call:resume reports a missing in-memory session as server_restarted', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('alice-restart', 'web-restart', io);
    registerCallHandler(io, alice, registry);

    alice.handlers['call:resume']({ callId: 'lost-during-restart' });

    expect(alice.last('call:end').payload).toEqual({
      reason: 'server_restarted',
      callId: 'lost-during-restart',
    });
  });

  test('call:resume rebinds the participant and cancels disconnect cleanup', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const first = createSocket('alice-resume', 'web-before', io);
    registerCallHandler(io, first, registry);
    const ack = jest.fn();
    first.handlers['call:request']({ to: 'bob-resume', type: 'audio' }, ack);
    const callId = ack.mock.calls[0][0].callId;
    first.handlers.disconnect();

    const reconnected = createSocket('alice-resume', 'web-after', io);
    registerCallHandler(io, reconnected, registry);
    reconnected.handlers['call:resume']({ callId });
    jest.advanceTimersByTime(15_000);

    expect(registry.get(callId).participants.get('alice-resume').socketIds)
      .toEqual(new Set(['web-after']));
    expect(io.events('call:end')).toHaveLength(0);
  });

  test('private grace expiry performs handler-owned logging and peer notification', () => {
    const io = createIoHarness();
    const callbacks = [];
    let registry;
    registry = createRegistry({
      setTimer: callback => { callbacks.push(callback); return callback; },
      clearTimer: jest.fn(),
      onGraceExpired: info => registerCallHandler.handleGraceExpired(io, registry, info),
    });
    const alice = createSocket('alice-grace', 'web-grace', io);
    registerCallHandler(io, alice, registry);
    const ack = jest.fn();
    alice.handlers['call:request']({ to: 'bob-grace', type: 'audio' }, ack);
    const callId = ack.mock.calls[0][0].callId;

    alice.handlers.disconnect();
    callbacks[0]();

    expect(write).toHaveBeenCalledWith(
      "UPDATE call_logs SET status='canceled', ended_at=? WHERE id=?",
      [expect.any(Number), callId]
    );
    expect(io.last('call:end').payload).toEqual({
      from: 'alice-grace',
      reason: 'disconnected',
      callId,
    });
    expect(registry.get(callId)).toBeUndefined();
  });

  test('realtime shares one registry and delegates private grace expiry to the call handler', () => {
    jest.isolateModules(() => {
      const registerCall = jest.fn();
      registerCall.handleGraceExpired = jest.fn();
      const registerGroupCall = jest.fn();
      const registerTyping = jest.fn(() => ({ cleanup: jest.fn() }));
      const connectionDb = { prepare: jest.fn(() => ({ get: jest.fn(), all: jest.fn(() => []) })) };
      const isolatedPresence = {
        onlineUsers: new Map(),
        isOnline: jest.fn(() => false),
        onlinePlatforms: jest.fn(() => new Set()),
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
        id: 'socket-wiring',
        user: { id: 'alice-wiring' },
        use: jest.fn(),
        join: jest.fn(),
        on: jest.fn(),
        to: jest.fn(() => ({ emit: jest.fn() })),
      };
      connect(socket);

      const privateRegistry = registerCall.mock.calls[0][2];
      const groupRegistry = registerGroupCall.mock.calls[0][2];
      expect(privateRegistry).toBeDefined();
      expect(groupRegistry).toBe(privateRegistry);

      privateRegistry.createPrivate({
        callId: 'grace-wiring',
        callerId: 'alice-wiring',
        calleeId: 'bob-wiring',
        socketId: 'socket-wiring',
      });
      privateRegistry.unbindSocket('alice-wiring', 'socket-wiring');
      jest.advanceTimersByTime(15_000);

      expect(registerCall.handleGraceExpired).toHaveBeenCalledWith(io, privateRegistry, {
        callId: 'grace-wiring',
        userId: 'alice-wiring',
        kind: 'private',
      });
      privateRegistry.reset();
    });
  });
});
