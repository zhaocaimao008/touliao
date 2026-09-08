'use strict';

const createRegistry = require('../src/realtime/callSessionRegistry');

function createTimerHarness() {
  const callbacks = [];
  const setTimer = jest.fn((callback, delay) => {
    const timer = { callback, delay };
    callbacks.push(timer);
    return timer;
  });
  const clearTimer = jest.fn();

  return { callbacks, setTimer, clearTimer };
}

test('unrelated device disconnect does not release user occupancy', () => {
  const r = createRegistry({ graceMs: 15_000, setTimer: jest.fn(), clearTimer: jest.fn() });

  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'web-a' });

  expect(r.unbindSocket('alice', 'phone-a')).toEqual({ affected: false });
  expect(r.callForUser('alice')).toBe('c1');
});

test('last participating socket starts grace and resume cancels it', () => {
  let callback;
  const clearTimer = jest.fn();
  const r = createRegistry({ graceMs: 15_000, setTimer: fn => (callback = fn), clearTimer });

  const created = r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'web-a' });

  expect(r.unbindSocket('alice', 'web-a').graceStarted).toBe(true);
  // Q06 全修：resume 必须证明持有创建时签发的 resumeToken，光凭 userId 不再够——
  // 否则同账号任意旁观 Socket 都能在宽限期内顶替进来（ownership-design-review.md #1/#3）。
  expect(r.resume('c1', 'alice', 'web-a2', created.resumeToken).ok).toBe(true);
  expect(clearTimer).toHaveBeenCalled();
  expect(callback).toBeDefined();
});

test('resume without the resumeToken issued at binding is rejected, even while the original socket is still connected', () => {
  const r = createRegistry();

  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'web-owner' });

  expect(r.resume('c1', 'alice', 'web-observer')).toMatchObject({
    ok: false,
    code: 'CALL_ID_MISMATCH',
    callId: 'c1',
  });
  expect(r.get('c1').participants.get('alice').socketIds).toEqual(new Set(['web-owner']));
});

test('resume with a wrong resumeToken is rejected after the participant has actually disconnected', () => {
  const r = createRegistry();

  const created = r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'web-owner' });
  r.unbindSocket('alice', 'web-owner');

  expect(r.resume('c1', 'alice', 'web-observer', 'wrong-token')).toMatchObject({
    ok: false, code: 'CALL_ID_MISMATCH', callId: 'c1',
  });
  expect(r.resume('c1', 'alice', 'web-observer')).toMatchObject({
    ok: false, code: 'CALL_ID_MISMATCH', callId: 'c1',
  });
  expect(r.resume('c1', 'alice', 'web-observer', created.resumeToken).ok).toBe(true);
});

test('resume cannot bind a reserved-but-never-accepted callee before accept issues their resumeToken', () => {
  const r = createRegistry();

  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'web-owner' });

  // bob 从未真正 accept/bind 过，参与者槽位存在但 resumeToken 还没签发——
  // 任何人光凭 userId 冒充 bob 调 resume 都不该在被叫接听前就把自己接进去。
  expect(r.resume('c1', 'bob', 'bob-observer')).toMatchObject({
    ok: false, code: 'CALL_ID_MISMATCH', callId: 'c1',
  });
  expect(r.get('c1').participants.get('bob').socketIds.size).toBe(0);
});

test('bindSocket freely adds a concurrent socket while the participant is still live (existing multi-device behavior, no token required)', () => {
  const r = createRegistry();

  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'alice-web' });
  // bob accept 首绑（call.js 真实用法）
  expect(r.bindSocket('c1', 'bob', 'bob-phone', { isInitialBind: true }).ok).toBe(true);

  // alice 还活着(alice-web 未断)时开第二个标签页——existing product behavior, unaffected
  expect(r.bindSocket('c1', 'alice', 'alice-web-2').ok).toBe(true);
  expect(r.get('c1').participants.get('alice').socketIds).toEqual(new Set(['alice-web', 'alice-web-2']));
});

test('bindSocket without isInitialBind or a resumeToken cannot acquire a disconnected participant\'s slot (Q06 ownership bypass via ordinary join)', () => {
  const r = createRegistry();

  const created = r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'alice-web' });
  r.unbindSocket('alice', 'alice-web'); // alice 断线，进入宽限期，socketIds 归零

  // 另一台旁观 Socket（同账号）不带任何凭据，光凭一次普通 bindSocket（例如
  // group_call:join 落到 occupy 的"已是成员"分支）就想顶替进去——必须被拒绝，
  // 这正是 ownership-design-review.md 阻断项 #1 描述的洞。
  expect(r.bindSocket('c1', 'alice', 'alice-observer')).toMatchObject({
    ok: false, code: 'CALL_ID_MISMATCH', callId: 'c1',
  });
  expect(r.bindSocket('c1', 'alice', 'alice-observer', { isInitialBind: true })).toMatchObject({
    ok: false, code: 'CALL_ID_MISMATCH', callId: 'c1',
  });
  expect(r.get('c1').participants.get('alice').socketIds.size).toBe(0);

  // 真正的原设备带着 createPrivate 签发的 resumeToken 走 resume 才能恢复
  expect(r.resume('c1', 'alice', 'alice-web-2', created.resumeToken).ok).toBe(true);
});

test('isInitialBind mints a resumeToken only for a participant that has never bound before', () => {
  const r = createRegistry();

  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'alice-web' });
  const firstAccept = r.bindSocket('c1', 'bob', 'bob-phone', { isInitialBind: true });
  expect(firstAccept.ok).toBe(true);
  expect(firstAccept.resumeToken).toEqual(expect.any(String));

  r.unbindSocket('bob', 'bob-phone'); // bob 断线，进入宽限期，已经有 resumeToken 了

  // isInitialBind 不能在已经签发过 token 之后被用来重新抢注一个新身份
  expect(r.bindSocket('c1', 'bob', 'bob-imposter', { isInitialBind: true })).toMatchObject({
    ok: false, code: 'CALL_ID_MISMATCH', callId: 'c1',
  });
});

test('private and group calls share the same busy occupancy', () => {
  const r = createRegistry();

  expect(r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'a' }).ok).toBe(true);
  expect(r.createGroup({ callId: 'g1', conversationId: 'g', startedBy: 'alice', socketId: 'a' }))
    .toMatchObject({ ok: false, code: 'CALL_BUSY' });
});

test('private creation checks every participant before changing shared state', () => {
  const r = createRegistry();

  r.createGroup({ callId: 'g1', conversationId: 'g', startedBy: 'bob', socketId: 'bob-web' });

  expect(r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'alice-web' }))
    .toMatchObject({ ok: false, code: 'CALL_BUSY', userId: 'bob' });
  expect(r.callForUser('alice')).toBeUndefined();
  expect(r.get('c1')).toBeUndefined();
});

test('occupy adds a group member atomically and is idempotent for the same call', () => {
  const r = createRegistry();

  r.createGroup({ callId: 'g1', conversationId: 'g', startedBy: 'alice', socketId: 'alice-web' });

  expect(r.occupy('g1', 'bob', 'bob-web')).toMatchObject({ ok: true });
  expect(r.occupy('g1', 'bob', 'bob-phone')).toMatchObject({ ok: true, alreadyMember: true });
  expect(r.get('g1').participants.get('bob').socketIds).toEqual(new Set(['bob-web', 'bob-phone']));
});

test('releaseUser frees a group participant immediately without ending other members', () => {
  const r = createRegistry();

  r.createGroup({ callId: 'g1', conversationId: 'g', startedBy: 'alice', socketId: 'alice-web' });
  r.occupy('g1', 'bob', 'bob-web');

  expect(r.releaseUser('g1', 'bob')).toMatchObject({ ok: true, released: true });
  expect(r.callForUser('bob')).toBeUndefined();
  expect(r.get('g1').participants.has('bob')).toBe(false);
  expect(r.get('g1').participants.has('alice')).toBe(true);
});

// 2026-08-31 review 发现：私聊只有两个参与者，releaseUser 若像群聊那样只移除
// "这一个人"，另一方会永久卡在占用中（跟 call:request 重拨覆盖未接听旧通话时漏发
// 通知是同一类孤儿状态 bug）。releaseUser 对私聊 session 必须整段释放，不是半释放。
test('releaseUser on a private call ends the whole session, not just the departing participant', () => {
  const r = createRegistry();

  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'alice-web' });

  expect(r.releaseUser('c1', 'alice')).toMatchObject({ ok: true, released: true, ended: true });
  expect(r.callForUser('alice')).toBeUndefined();
  expect(r.callForUser('bob')).toBeUndefined(); // 关键：对方也必须被一并释放，不能孤儿化
  expect(r.get('c1')).toBeUndefined();
});

// 2026-08-31 review 发现：createPrivate 完全依赖调用方（call.js 现有的 to===userId
// 拦截）阻止自己呼叫自己；这里补一层纵深防御，不完全信任调用方纪律。
test('createPrivate rejects a caller and callee that are the same user', () => {
  const r = createRegistry();

  expect(r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'alice', socketId: 'alice-web' }))
    .toMatchObject({ ok: false, code: 'CALL_ID_MISMATCH' });
  expect(r.get('c1')).toBeUndefined();
  expect(r.callForUser('alice')).toBeUndefined();
});

test('grace expiry reports the active user and call without releasing registry state itself', () => {
  const timers = createTimerHarness();
  const onGraceExpired = jest.fn();
  const r = createRegistry({ graceMs: 15_000, ...timers, onGraceExpired });

  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'web-a' });
  r.unbindSocket('alice', 'web-a');
  timers.callbacks[0].callback();

  expect(onGraceExpired).toHaveBeenCalledWith({ callId: 'c1', userId: 'alice', kind: 'private' });
  expect(r.callForUser('alice')).toBe('c1');
});

test('private validation rejects missing calls and stale or unrelated call ids', () => {
  const r = createRegistry();

  expect(r.validatePrivate('missing', 'alice', 'bob')).toMatchObject({ ok: false, code: 'CALL_NOT_FOUND' });
  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'alice-web' });

  expect(r.validatePrivate('c1', 'alice', 'mallory')).toMatchObject({ ok: false, code: 'CALL_ID_MISMATCH' });
  expect(r.validatePrivate('c1', 'mallory', 'alice')).toMatchObject({ ok: false, code: 'CALL_ID_MISMATCH' });
  expect(r.validatePrivate('c1', 'alice', 'bob')).toMatchObject({ ok: true, callId: 'c1' });
});

test('compatibility resolution only returns the users shared private call', () => {
  const r = createRegistry();

  expect(r.resolvePrivateCall('alice', 'bob')).toMatchObject({ ok: false, code: 'CALL_NOT_FOUND' });
  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'alice-web' });

  expect(r.resolvePrivateCall('alice', 'bob')).toMatchObject({ ok: true, callId: 'c1' });
  expect(r.resolvePrivateCall('alice', 'mallory')).toMatchObject({ ok: false, code: 'CALL_ID_MISMATCH' });
});

test('end and reset clear every occupancy and pending disconnect timer', () => {
  const timers = createTimerHarness();
  const r = createRegistry(timers);

  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'alice-web' });
  r.unbindSocket('alice', 'alice-web');
  expect(r.end('c1')).toMatchObject({ ok: true, ended: true });
  expect(timers.clearTimer).toHaveBeenCalledWith(timers.callbacks[0]);
  expect(r.callForUser('alice')).toBeUndefined();
  expect(r.callForUser('bob')).toBeUndefined();

  r.createGroup({ callId: 'g1', conversationId: 'g', startedBy: 'alice', socketId: 'alice-web' });
  r.reset();
  expect(r.get('g1')).toBeUndefined();
  expect(r._state.sessions.size).toBe(0);
  expect(r._state.userSessions.size).toBe(0);
});
