'use strict';
/**
 * 2026-10-11 perf/nudge 回归：拍一拍冷却 + 群通话发起频率。
 *   1. 同一用户同步连发两个 nudge（同一批包被 socket.io 连续派发）→ 只放行一个。
 *      旧实现 await cache.get → 校验 → await cache.set，两个包都在 set 落地前读到旧值；
 *      测试环境无 Redis 时 get 恒为 null，两个都放行（即 10-07 Redis 宕机时的线上行为）。
 *   2. nudge 共用 presence.checkMsgRate 的每秒消息预算，命中时 ack 形状与 send_message 一致
 *      （code: 'RATE_LIMITED' + retryAfterMs），且被限流的那次不占用 3s 冷却。
 *   3. 冷却 Map 惰性清扫后只剩未过期条目（有界）。
 *   4. group_call:start 每用户每窗口最多成功发起 GROUP_START_LIMIT 次，start→leave 循环被截断；
 *      失败的发起（busy）不计数，窗口过后恢复。
 * mock 方式沿用 group-call-occupancy.test.js（readDb 按 SQL 片段返回、writer/shared 打桩），
 * 另把 sync.service / broadcaster 打桩，让 nudge 走完整条成功路径而不触碰 writer worker。
 */

jest.mock('../src/db/connection', () => ({
  readDb: {
    prepare: jest.fn(sql => ({
      get: jest.fn(() => {
        if (sql.includes('admin_settings')) return undefined; // 未关闭 => 拍一拍 / 群通话开关均为开启
        if (sql.includes('FROM conversations')) return { type: 'group', mute_all: 0 };
        if (sql.includes('SELECT nickname')) return { nickname: null };
        if (sql.includes('FROM users')) return { username: 'perf-user', avatar: '' };
        // 发起者 role 查询 / 对象成员查询都要真值
        if (sql.includes('conversation_members')) return { role: 'member' };
        return undefined;
      }),
      all: jest.fn(() => []),
    })),
  },
}));
jest.mock('../src/db/writer', () => ({ write: jest.fn(), SEQUENCE_PARAM: '__SEQ__' }));
jest.mock('../src/modules/messages/shared', () => ({
  isMember: jest.fn(() => true),
  privateSendGuard: jest.fn(() => null),
}));
jest.mock('../src/modules/messages/sync.service', () => ({
  appendConversationEvent: jest.fn(async () => ({ server_sequence: 1 })),
  emitSyncAvailable: jest.fn(),
}));
jest.mock('../src/realtime/broadcaster', () => ({ broadcastMessage: jest.fn() }));

const config = require('../src/config');
const presence = require('../src/realtime/presence');
const createRegistryFactory = require('../src/realtime/callSessionRegistry');
const registerGroupCallHandler = require('../src/realtime/handlers/groupCall');
const registerNudgeHandler = require('../src/realtime/handlers/nudge');
const { appendConversationEvent } = require('../src/modules/messages/sync.service');

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

describe('nudge 冷却：进程内同步检查并占用（不依赖 Redis）', () => {
  const { nudgeCooldown, COOLDOWN_MS, SWEEP_INTERVAL_MS } = registerNudgeHandler.cooldownInternals || {};
  // 受控时钟：每个用例跳到一个全新的时间段，之前用例留下的冷却/限流窗口/清扫时间点都已过期
  let clock = Date.now();
  let nowSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    clock += 10 * 60 * 1000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(() => nowSpy.mockRestore());

  test('同一用户同步连发两个 nudge → 只放行一个，另一个回「操作过于频繁」；冷却过后恢复', async () => {
    const io = createIoHarness();
    const alice = createSocket('nudge-burst-alice', 'nudge-burst-alice-web', io);
    registerNudgeHandler(io, alice);
    const payload = { conversationId: 'conv-nudge-burst', targetId: 'nudge-burst-bob' };
    const acks = [];

    // 不 await 第一个：等价于 socket.io 在同一次 TCP 读取里连续派发两个 'nudge' 包
    const first = alice.handlers.nudge(payload, res => acks.push(res));
    const second = alice.handlers.nudge(payload, res => acks.push(res));
    await Promise.all([first, second]);

    expect(acks).toHaveLength(2);
    expect(acks.filter(a => a.success)).toHaveLength(1);
    expect(acks.filter(a => !a.success)).toEqual([{ success: false, error: '操作过于频繁' }]);
    expect(appendConversationEvent).toHaveBeenCalledTimes(1); // 只落一条 sequenced 写

    // 冷却到期后可以再拍
    clock += COOLDOWN_MS;
    const again = jest.fn();
    await alice.handlers.nudge(payload, again);
    expect(again.mock.calls[0][0].success).toBe(true);
    expect(appendConversationEvent).toHaveBeenCalledTimes(2);
  });

  test('与 send_message 共用每秒消息预算：命中时 ack 带 code/retryAfterMs，且不占用冷却', async () => {
    const io = createIoHarness();
    const uid = 'nudge-rate-alice';
    const alice = createSocket(uid, 'nudge-rate-alice-web', io);
    registerNudgeHandler(io, alice);
    const payload = { conversationId: 'conv-nudge-rate', targetId: 'nudge-rate-bob' };

    // 先把这一秒的预算用光（等价于刚连发了 msgRateLimit 条 send_message）
    for (let i = 0; i < config.limits.msgRateLimit; i++) expect(presence.checkMsgRate(uid).ok).toBe(true);

    const limited = jest.fn();
    await alice.handlers.nudge(payload, limited);
    expect(limited).toHaveBeenCalledWith({
      success: false, error: '发送频率过高，请稍后再试', code: 'RATE_LIMITED', retryAfterMs: expect.any(Number),
    });
    expect(limited.mock.calls[0][0].retryAfterMs).toBeGreaterThan(0);
    expect(appendConversationEvent).not.toHaveBeenCalled();
    expect(nudgeCooldown.has(uid)).toBe(false);

    // 预算窗口过去、但仍在 3s 冷却之内：被限流那次没占冷却，这次应正常放行
    expect(config.limits.msgRateWindow).toBeLessThan(COOLDOWN_MS);
    clock += config.limits.msgRateWindow;
    const ok = jest.fn();
    await alice.handlers.nudge(payload, ok);
    expect(ok.mock.calls[0][0].success).toBe(true);
    expect(appendConversationEvent).toHaveBeenCalledTimes(1);
  });

  test('冷却 Map 有界：过期条目在下一次清扫时被删除', async () => {
    const io = createIoHarness();
    const payload = { conversationId: 'conv-nudge-sweep', targetId: 'nudge-sweep-target' };
    const early = ['nudge-sweep-1', 'nudge-sweep-2', 'nudge-sweep-3'];
    for (const uid of early) {
      const s = createSocket(uid, `${uid}-web`, io);
      registerNudgeHandler(io, s);
      await s.handlers.nudge(payload, jest.fn());
      expect(nudgeCooldown.has(uid)).toBe(true);
    }

    clock += SWEEP_INTERVAL_MS; // 满一个清扫间隔，也早已超过 3s 冷却
    const late = createSocket('nudge-sweep-4', 'nudge-sweep-4-web', io);
    registerNudgeHandler(io, late);
    await late.handlers.nudge(payload, jest.fn());

    expect([...nudgeCooldown.keys()]).toEqual(['nudge-sweep-4']);
  });
});

describe('group_call:start 每用户发起频率（只计成功建成的通话）', () => {
  const { GROUP_START_LIMIT, GROUP_START_WINDOW_MS } = registerGroupCallHandler.startRateLimit || {};

  beforeAll(() => jest.useFakeTimers());
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    for (const registry of registries.splice(0)) registry.reset();
    jest.clearAllTimers();
  });
  afterAll(() => jest.useRealTimers());

  test('start→leave 循环：窗口内超出上限的发起被拒（rate_limited + retryAfterMs），不再全群响铃；窗口过后恢复', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    const alice = createSocket('loop-alice', 'loop-alice-web', io);
    registerGroupCallHandler(io, alice, registry);
    const startedCount = () => alice.emitted.filter(e => e.event === 'group_call:started').length;

    for (let i = 0; i < GROUP_START_LIMIT; i++) {
      alice.handlers['group_call:start']({ conversationId: 'conv-start-loop', type: 'audio' });
      const { callId } = alice.last('group_call:started').payload;
      alice.handlers['group_call:leave']({ callId }); // 唯一成员离开 → endCall（写日志 + 通话消息）
      expect(registry.callForUser('loop-alice')).toBeUndefined();
    }
    expect(startedCount()).toBe(GROUP_START_LIMIT);
    expect(io.events('group_call:invite')).toHaveLength(GROUP_START_LIMIT);

    alice.handlers['group_call:start']({ conversationId: 'conv-start-loop', type: 'audio', requestId: 'attempt-over-limit' });
    const err = alice.last('group_call:error').payload;
    expect(err).toEqual({ reason: 'rate_limited', retryAfterMs: expect.any(Number), requestId: 'attempt-over-limit' });
    expect(err.retryAfterMs).toBeGreaterThan(0);
    expect(err.retryAfterMs).toBeLessThanOrEqual(GROUP_START_WINDOW_MS);
    expect(startedCount()).toBe(GROUP_START_LIMIT);
    expect(io.events('group_call:invite')).toHaveLength(GROUP_START_LIMIT); // 没有再响铃
    expect(registry.callForUser('loop-alice')).toBeUndefined();

    // 按用户计数：别的用户不受 alice 的计数影响
    const bob = createSocket('loop-bob', 'loop-bob-web', io);
    registerGroupCallHandler(io, bob, registry);
    bob.handlers['group_call:start']({ conversationId: 'conv-start-loop-bob', type: 'audio' });
    expect(bob.last('group_call:started')).toBeDefined();

    // 窗口过后恢复
    jest.advanceTimersByTime(GROUP_START_WINDOW_MS);
    alice.handlers['group_call:start']({ conversationId: 'conv-start-loop', type: 'audio' });
    expect(startedCount()).toBe(GROUP_START_LIMIT + 1);
    expect(registry.callForUser('loop-alice')).toBe(alice.last('group_call:started').payload.callId);
  });

  test('失败的发起（busy）不计数：忙线期间反复重试，空闲后仍能立即发起', () => {
    const io = createIoHarness();
    const registry = createRegistry();
    registry.createPrivate({ callId: 'private-busy-retry', callerId: 'retry-alice', calleeId: 'retry-bob', socketId: 'retry-alice-phone' });
    const alice = createSocket('retry-alice', 'retry-alice-web', io);
    registerGroupCallHandler(io, alice, registry);

    for (let i = 0; i < GROUP_START_LIMIT + 2; i++) {
      alice.handlers['group_call:start']({ conversationId: 'conv-start-retry', type: 'audio' });
      expect(alice.last('group_call:error').payload).toEqual({ reason: 'busy' });
    }
    registry.end('private-busy-retry');

    alice.handlers['group_call:start']({ conversationId: 'conv-start-retry', type: 'audio' });
    const started = alice.last('group_call:started');
    expect(started).toBeDefined();
    expect(registry.callForUser('retry-alice')).toBe(started.payload.callId);
  });
});
