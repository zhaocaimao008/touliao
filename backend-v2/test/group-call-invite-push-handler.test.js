'use strict';
/**
 * group_call:start → 群邀请推送接线（realtime/handlers/groupCall.js 的 pushInviteInBackground）。
 *
 * 钉死的行为：
 *  1. 发起成功后、group_call:started 回执之后调用一次 pushGroupCallInvite；
 *     expiresAt 与同一次 socket group_call:invite 的 expiresAt 是同一个值；isBusy 按 registry 判定忙线。
 *  2. 推送异步失败 / 同步抛错 / 函数不存在（部分测试把 utils/push mock 成不含它的对象）：
 *     started 照常回给发起方，不抛错，只记一条 warn。
 *  3. 发起失败（忙线 / 群里已有通话 / 不是群 / 后台关闭该通话类型 / 被限流）时不推送。
 *
 * mock 方式沿用 group-call-occupancy.test.js（readDb 按 SQL 片段返回、writer/shared 打桩），
 * utils/push 整体打桩：这里只验证接线，推送本身见 push-group-call-invite.test.js。
 */

// 设为 admin_settings 的开关键名（如 'feature_group_video_call'）即模拟后台关闭该通话类型
let mockFeatureOff = null;

jest.mock('../src/db/connection', () => ({
  readDb: {
    prepare: jest.fn(sql => ({
      get: jest.fn((...args) => {
        // 默认未关闭 => groupCallAllowed() 返回 true
        if (sql.includes('admin_settings')) return args[0] === mockFeatureOff ? { value: 'off' } : undefined;
        if (sql.includes('FROM conversations')) return args[0] === 'conv-push-not-group' ? { type: 'private' } : { type: 'group' };
        if (sql.includes('FROM users')) return { username: 'starter-name', avatar: '' };
        if (sql.includes('conversation_members')) return { allowed: 1 };
        return undefined;
      }),
      all: jest.fn(() => []),
    })),
  },
}));
jest.mock('../src/db/writer', () => ({ write: jest.fn() }));
jest.mock('../src/modules/messages/shared', () => ({ isMember: jest.fn(() => true), deletedRelation: jest.fn(() => null) }));
jest.mock('../src/utils/push', () => ({
  pushGroupCallInvite: jest.fn(() => Promise.resolve()),
  pushCallInvite: jest.fn(() => Promise.resolve()),
}));

const createRegistryFactory = require('../src/realtime/callSessionRegistry');
const registerGroupCallHandler = require('../src/realtime/handlers/groupCall');
const { pushGroupCallInvite } = require('../src/utils/push');

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
    once(event, handler) { return this.on(event, handler); },
    emit(event, payload) { emitted.push({ event, payload }); return this; },
    to(room) { return io.to(room); },
    last(event) { return emitted.filter(item => item.event === event).at(-1); },
  };
}

// 让已 settle 的 promise 回调（.catch 里的 warn）跑完；fake timers 不影响原生 Promise 微任务
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('group_call:start 群邀请推送接线', () => {
  let warnSpy;

  beforeAll(() => jest.useFakeTimers());
  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    for (const registry of registries.splice(0)) registry.reset();
    jest.clearAllTimers();
  });
  afterAll(() => jest.useRealTimers());

  test('发起成功：started 之后调用一次 pushGroupCallInvite，expiresAt 与 socket 邀请相同，isBusy 按 registry 判定', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('push-starter', 'push-starter-web', io);
    registerGroupCallHandler(io, alice, registry);
    let startedBeforePush = null;
    pushGroupCallInvite.mockImplementationOnce(() => {
      startedBeforePush = !!alice.last('group_call:started');
      return Promise.resolve();
    });

    alice.handlers['group_call:start']({ conversationId: 'conv-push-ok', type: 'audio' });

    const started = alice.last('group_call:started');
    expect(started).toBeDefined();
    expect(pushGroupCallInvite).toHaveBeenCalledTimes(1);
    expect(startedBeforePush).toBe(true);   // 推送不阻塞、也不先于发起方的回执
    const args = pushGroupCallInvite.mock.calls[0][0];
    expect(args).toMatchObject({
      callId: started.payload.callId,
      conversationId: 'conv-push-ok',
      callType: 'audio',
      fromUserId: 'push-starter',
      fromName: 'starter-name',
    });
    const invite = io.last('group_call:invite').payload;
    expect(args.expiresAt).toBe(invite.expiresAt);
    expect(args.expiresAt).toBe(Date.now() + 60000);
    // socket 邀请的载荷形状不变
    expect(Object.keys(invite).sort()).toEqual(['callId', 'conversationId', 'expiresAt', 'from', 'fromAvatar', 'fromName', 'type']);
    expect(args.isBusy('push-starter')).toBe(true);    // 发起人已占用 registry
    expect(args.isBusy('someone-else')).toBe(false);
  });

  test('视频群通话：callType=video', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('push-video', 'push-video-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-push-video', type: 'video' });
    expect(pushGroupCallInvite).toHaveBeenCalledTimes(1);
    expect(pushGroupCallInvite.mock.calls[0][0].callType).toBe('video');
  });

  test('推送异步失败：started 照常发出、不抛错，只记一条 warn', async () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('push-reject', 'push-reject-web', io);
    registerGroupCallHandler(io, alice, registry);
    pushGroupCallInvite.mockImplementationOnce(() => Promise.reject(new Error('x')));

    expect(() => alice.handlers['group_call:start']({ conversationId: 'conv-push-reject', type: 'audio' })).not.toThrow();
    expect(alice.last('group_call:started')).toBeDefined();
    expect(io.last('group_call:invite')).toBeDefined();
    await flushMicrotasks();
    expect(warnSpy).toHaveBeenCalledWith('[groupCall] 群通话邀请推送失败:', 'x');
  });

  test('推送同步抛错：started 照常发出、不抛错，只记一条 warn', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('push-sync', 'push-sync-web', io);
    registerGroupCallHandler(io, alice, registry);
    pushGroupCallInvite.mockImplementationOnce(() => { throw new Error('sync'); });

    expect(() => alice.handlers['group_call:start']({ conversationId: 'conv-push-sync', type: 'audio' })).not.toThrow();
    expect(alice.last('group_call:started')).toBeDefined();
    expect(registry.callForUser('push-sync')).toBe(alice.last('group_call:started').payload.callId);
    expect(warnSpy).toHaveBeenCalledWith('[groupCall] 群通话邀请推送失败:', 'sync');
  });

  test('忙线（已在 1v1 通话中）：发起被拒，不推送', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    registry.createPrivate({ callId: 'private-push-busy', callerId: 'push-busy', calleeId: 'push-busy-peer', socketId: 'push-busy-phone' });
    const alice = createSocket('push-busy', 'push-busy-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-push-busy', type: 'audio' });
    expect(alice.last('group_call:error').payload).toEqual({ reason: 'busy' });
    expect(pushGroupCallInvite).not.toHaveBeenCalled();
  });

  test('群里已有进行中的通话（另一成员发起）：发起被拒，不再推送', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const bob = createSocket('push-active-bob', 'push-active-bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:start']({ conversationId: 'conv-push-active', type: 'audio' });
    expect(pushGroupCallInvite).toHaveBeenCalledTimes(1);
    pushGroupCallInvite.mockClear();

    const alice = createSocket('push-active-alice', 'push-active-alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-push-active', type: 'audio' });
    expect(alice.last('group_call:error').payload).toEqual({ reason: 'active_call' });
    expect(pushGroupCallInvite).not.toHaveBeenCalled();
  });

  test('不是群会话：发起被拒，不推送', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('push-not-group', 'push-not-group-web', io);
    registerGroupCallHandler(io, alice, registry);
    alice.handlers['group_call:start']({ conversationId: 'conv-push-not-group', type: 'audio' });
    expect(alice.last('group_call:error').payload).toEqual({ reason: 'not_group' });
    expect(pushGroupCallInvite).not.toHaveBeenCalled();
  });

  test('后台关闭群视频（video_disabled）：发起被拒，不推送', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('push-switch-off', 'push-switch-off-web', io);
    registerGroupCallHandler(io, alice, registry);
    mockFeatureOff = 'feature_group_video_call';
    try {
      alice.handlers['group_call:start']({ conversationId: 'conv-push-switch-off', type: 'video' });
    } finally {
      mockFeatureOff = null;
    }
    expect(alice.last('group_call:error').payload).toEqual({ reason: 'video_disabled' });
    expect(registry.callForUser('push-switch-off')).toBeUndefined();
    expect(pushGroupCallInvite).not.toHaveBeenCalled();
  });

  test('发起频率超限（rate_limited）：被拒的那次不推送', () => {
    const { GROUP_START_LIMIT } = registerGroupCallHandler.startRateLimit;
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('push-rate', 'push-rate-web', io);
    registerGroupCallHandler(io, alice, registry);
    for (let i = 0; i < GROUP_START_LIMIT; i++) {
      alice.handlers['group_call:start']({ conversationId: 'conv-push-rate', type: 'audio' });
      const { callId } = alice.last('group_call:started').payload;
      alice.handlers['group_call:leave']({ callId });
    }
    expect(pushGroupCallInvite).toHaveBeenCalledTimes(GROUP_START_LIMIT);
    pushGroupCallInvite.mockClear();

    alice.handlers['group_call:start']({ conversationId: 'conv-push-rate', type: 'audio' });
    expect(alice.last('group_call:error').payload.reason).toBe('rate_limited');
    expect(pushGroupCallInvite).not.toHaveBeenCalled();
  });

  // groupCall.js 在调用时才从 utils/push 取函数：临时删掉 mock 对象上的 pushGroupCallInvite，
  // 模拟其它测试把 utils/push mock 成不含它的对象
  test('utils/push 不含 pushGroupCallInvite（部分测试的 mock）：started 照常发出、不抛错', () => {
    const pushModule = require('../src/utils/push');
    const saved = pushModule.pushGroupCallInvite;
    delete pushModule.pushGroupCallInvite;
    try {
      const io = createIoHarness();
      const registry = createRegistry();
      const alice = createSocket('push-missing', 'push-missing-web', io);
      registerGroupCallHandler(io, alice, registry);

      expect(() => alice.handlers['group_call:start']({ conversationId: 'conv-push-missing', type: 'audio' })).not.toThrow();
      expect(alice.last('group_call:started')).toBeDefined();
      expect(io.last('group_call:invite')).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith('[groupCall] 群通话邀请推送失败:', expect.stringContaining('not a function'));
    } finally {
      pushModule.pushGroupCallInvite = saved;
    }
    expect(saved).not.toHaveBeenCalled();
  });
});
