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

  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'web-a' });

  expect(r.unbindSocket('alice', 'web-a').graceStarted).toBe(true);
  expect(r.resume('c1', 'alice', 'web-a2').ok).toBe(true);
  expect(clearTimer).toHaveBeenCalled();
  expect(callback).toBeDefined();
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
