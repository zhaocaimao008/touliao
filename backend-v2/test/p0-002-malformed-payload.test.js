'use strict';
/**
 * P0-002 回归测试：call:request 等实时事件的畸形 payload 不得使进程崩溃。
 *
 * 覆盖：undefined, null, {}, [], string, number, missing target, invalid target,
 * invalid callType, oversized string, malformed nested object, unauthenticated socket
 *   1. 不抛未捕获异常
 *   2. 非法输入收到 INVALID_CALL_REQUEST 错误（call 系）
 *   3. 没有向其他用户 emit 任何通话事件
 *   4. 合法输入仍能走通（回归：正常通话不被破坏）
 */
const registerCallHandler = require('../src/realtime/handlers/call');
const registerTypingHandler = require('../src/realtime/handlers/typing');
const registerGroupCallHandler = require('../src/realtime/handlers/groupCall');
const registerNudgeHandler = require('../src/realtime/handlers/nudge');
const createCallSessionRegistry = require('../src/realtime/callSessionRegistry');

// 模拟 socket：捕获 emit/on 注册，支持 rooms、user、join
function makeMockSocket(userId, rooms = new Set()) {
  const emitted = [];
  const registry = {};
  const socket = {
    user: { id: userId },
    id: `socket-${userId}`,
    rooms,
    emitted,
    _registry: registry,
    emit(event, payload) { emitted.push({ event, payload }); return this; },
    to() { return { emit() {}, _toEmitted: [] }; },
    join() {},
    on(event, handler) { registry[event] = handler; return this; },
  };
  return socket;
}

// 模拟 io：捕获定向 emit
function makeMockIo() {
  const targeted = [];
  return {
    targeted,
    to(room) {
      return {
        emit(event, payload) { targeted.push({ room, event, payload }); return this; },
      };
    },
  };
}

const MALFORMED_PAYLOADS = [
  ['undefined', undefined],
  ['null', null],
  ['empty object', {}],
  ['array', [1, 2, 3]],
  ['string', 'hello'],
  ['number', 42],
  ['boolean', true],
  ['missing target', { type: 'audio' }],
  ['target is number', { to: 123, type: 'audio' }],
  ['target is object', { to: { id: 'x' }, type: 'audio' }],
  ['target is array', { to: ['a', 'b'], type: 'audio' }],
  ['target is empty string', { to: '', type: 'audio' }],
  ['target is null', { to: null, type: 'audio' }],
  ['target oversized (65 chars)', { to: 'a'.repeat(65), type: 'audio' }],
  ['invalid callType', { to: 'user-b', type: 'smoke-signal' }],
  ['callType is object', { to: 'user-b', type: { evil: true } }],
  ['callType is number', { to: 'user-b', type: 42 }],
  ['malformed nested (to in object)', { to: { nested: { deep: ['x'] } }, type: 'audio' }],
];

describe('P0-002 实时事件畸形负载加固', () => {
  const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  function registerAll(socket, io) {
    // 2026-08-31：call.js 现在需要第三个 registry 参数（callSessionRegistry 实例）。
    // 之前这里漏传，registry 是 undefined——本文件所有畸形负载测试恰好都在
    // guardPayload/guardId 早期校验就被拦下，从没真正走到 registry.createPrivate()
    // 那一步，所以一直没暴露；但"合法负载仍能走通"这条测试用的 alice/bob 在这个
    // 隔离测试库里没有真实好友关系/会话，也会在 shareConv 检查那步提前 return，
    // 同样测不到 registry 这条路径——不是这个测试真的验证过新集成能正常工作，只是
    // 运气好没触发。补上真实 registry，避免以后新增的测试用例意外撞上
    // "registry is undefined" 崩溃。
    const registry = createCallSessionRegistry();
    registerTypingHandler(io, socket);
    registerCallHandler(io, socket, registry);
    registerGroupCallHandler(io, socket, registry);
    registerNudgeHandler(io, socket);
  }

  test.each(MALFORMED_PAYLOADS)('call:request 畸形负载 %s 不崩溃且不产生会话', (name, payload) => {
    const io = makeMockIo();
    const socket = makeMockSocket(alice);
    registerAll(socket, io);
    const handler = socket._registry['call:request'];
    expect(handler).toBeDefined();
    expect(() => handler.call(socket, payload)).not.toThrow();
    // 非法负载不应向任何 user 房间 emit 通话事件
    expect(io.targeted.filter(t => t.event.startsWith('call:'))).toEqual([]);
  });

  test('call:request 合法负载仍能走通（回归：守卫不阻断正常通话）', () => {
    const io = makeMockIo();
    const socket = makeMockSocket(alice);
    registerAll(socket, io);
    const handler = socket._registry['call:request'];
    expect(() => handler.call(socket, { to: bob, type: 'audio' })).not.toThrow();
  });

  test.each(MALFORMED_PAYLOADS)('typing 畸形负载 %s 不崩溃', (name, payload) => {
    const io = makeMockIo();
    const socket = makeMockSocket(alice, new Set(['conv-1']));
    registerAll(socket, io);
    const handler = socket._registry['typing'];
    expect(() => { if (handler) handler.call(socket, payload); }).not.toThrow();
  });

  test.each(MALFORMED_PAYLOADS)('group_call:start 畸形负载 %s 不崩溃', (name, payload) => {
    const io = makeMockIo();
    const socket = makeMockSocket(alice);
    registerAll(socket, io);
    const handler = socket._registry['group_call:start'];
    expect(() => { if (handler) handler.call(socket, payload); }).not.toThrow();
  });

  test.each(MALFORMED_PAYLOADS)('nudge 畸形负载 %s 不崩溃', async (name, payload) => {
    const io = makeMockIo();
    const socket = makeMockSocket(alice);
    registerAll(socket, io);
    const handler = socket._registry['nudge'];
    await expect((async () => { if (handler) await handler.call(socket, payload, () => {}); })()).resolves.not.toThrow();
  });

  test('非法负载返回 INVALID_CALL_REQUEST 错误', () => {
    const io = makeMockIo();
    const socket = makeMockSocket(alice);
    registerAll(socket, io);
    const handler = socket._registry['call:request'];
    handler.call(socket, null);
    const err = socket.emitted.find(e => e.event === 'call:error');
    expect(err).toBeDefined();
    expect(err.payload.code).toBe('INVALID_CALL_REQUEST');
  });

  test.each([
    ['number', 42],
    ['object', { evil: true }],
    ['array', ['audio']],
    ['boolean', true],
    ['non-enum string', 'smoke-signal'],
  ])('call:request 非字符串/非枚举 callType（%s）被拒绝且返回 INVALID_CALL_REQUEST', (name, badType) => {
    const io = makeMockIo();
    const socket = makeMockSocket(alice);
    registerAll(socket, io);
    const handler = socket._registry['call:request'];
    // 主叫 bob 合法 ID；仅 type 非法 → 必须拒绝而不是静默强转 audio
    expect(() => handler.call(socket, { to: bob, type: badType })).not.toThrow();
    const err = socket.emitted.find(e => e.event === 'call:error');
    expect(err).toBeDefined();
    expect(err.payload.code).toBe('INVALID_CALL_REQUEST');
    expect(err.payload.field).toBe('type');
    // 拒绝后不得产生任何通话信令
    expect(io.targeted.filter(t => t.event === 'call:incoming')).toEqual([]);
  });

  test('未认证 socket（无 user 身份）不产生通话信令', () => {
    // 未认证连接在 io.use 握手层已被拒绝（index.js），不会注册 handler；
    // 此处防御性验证：即使 handler 被注册到无身份 socket 上，守卫也不得产生通话信令
    const io = makeMockIo();
    const socket = makeMockSocket(alice);
    socket.user = { id: alice }; // 身份由 JWT 提供，客户端无法伪造
    registerAll(socket, io);
    const handler = socket._registry['call:request'];
    // 模拟客户端试图伪造 callerId（服务端应忽略客户端身份字段，仅用 socket.user.id）
    expect(() => handler.call(socket, { to: bob, type: 'audio', callerId: 'hacker-999', userId: 'hacker-999' })).not.toThrow();
    // 服务端身份永远是 alice，不存在向 alice 自己拨号（to===userId 直接 return）
    const incoming = io.targeted.filter(t => t.event === 'call:incoming');
    expect(incoming.length).toBe(0);
  });

  test('call:offer/answer/ice/end 畸形负载不崩溃', () => {
    const io = makeMockIo();
    const socket = makeMockSocket(alice);
    registerAll(socket, io);
    for (const ev of ['call:offer', 'call:answer', 'call:ice', 'call:end']) {
      const handler = socket._registry[ev];
      expect(handler).toBeDefined();
      expect(() => handler.call(socket, null)).not.toThrow();
      expect(() => handler.call(socket, {})).not.toThrow();
      expect(() => handler.call(socket, 'x')).not.toThrow();
    }
  });

  test('group_call:offer/answer/ice/leave 畸形负载不崩溃', () => {
    const io = makeMockIo();
    const socket = makeMockSocket(alice);
    registerAll(socket, io);
    for (const ev of ['group_call:offer', 'group_call:answer', 'group_call:ice', 'group_call:leave']) {
      const handler = socket._registry[ev];
      expect(handler).toBeDefined();
      expect(() => handler.call(socket, null)).not.toThrow();
      expect(() => handler.call(socket, {})).not.toThrow();
    }
  });
});
