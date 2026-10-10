import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import useCallHistory, { canOpenCall } from './useCallHistory';
import useReadStatus from './useReadStatus';

// Deterministic hook scheduling lets requests resolve out of order in Node.
const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], owner: 1 }));
vi.mock('react', () => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => v !== b[i]);
  return {
    useState: initial => {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = initial;
      return [hooks.slots[i], value => { hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value; }];
    },
    useRef: initial => {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
      return hooks.slots[i];
    },
    useCallback: (fn, deps) => {
      const i = hooks.cursor++;
      if (changed(hooks.slots[i]?.deps, deps)) hooks.slots[i] = { fn, deps };
      return hooks.slots[i].fn;
    },
    useEffect: (fn, deps) => {
      const i = hooks.cursor++;
      if (!changed(hooks.slots[i]?.deps, deps)) return;
      hooks.effects.push(() => {
        hooks.slots[i]?.cleanup?.();
        hooks.slots[i] = { deps, cleanup: fn() };
      });
    },
  };
});
vi.mock('../utils/sessionContext', () => ({ captureSession: () => ({ owner: hooks.owner }), isSessionCurrent: scope => scope.owner === hooks.owner }));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const unmount = () => hooks.slots.forEach(slot => slot?.cleanup?.());
const message = { id: 'm1', sender_id: 'me', type: 'text' };
const call = { id: 'call1', peer_id: 'peer', peer_name: 'Peer', kind: 'private' };
let onOpenChat;
function render(kind = 'calls', key = 0) {
  hooks.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Controlled hook runner, one hook per test.
  const result = kind === 'calls' ? useCallHistory(key, onOpenChat) : useReadStatus(key || 'c1', 'me');
  hooks.effects.splice(0).forEach(effect => effect());
  return result;
}
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.owner = 1; onOpenChat = vi.fn();
  vi.spyOn(axios, 'get').mockResolvedValue({ data: [] });
  vi.spyOn(axios, 'post').mockResolvedValue({ data: { conversationId: 'chat1' } });
});
afterEach(() => { unmount(); vi.restoreAllMocks(); });

test('nonzero initial refresh key performs exactly one history load', async () => {
  render('calls', 4); await settle(); render('calls', 4);
  expect(axios.get).toHaveBeenCalledTimes(1); expect(render('calls', 4).loading).toBe(false);
});
test('slower initial response cannot replace the refreshed records', async () => {
  const old = deferred(), fresh = deferred();
  axios.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  render(); const signal = axios.get.mock.calls[0][1].signal;
  render('calls', 1); expect(signal.aborted).toBe(true);
  fresh.resolve({ data: [{ id: 'new' }] }); await settle();
  old.resolve({ data: [{ id: 'old' }] }); await settle();
  expect(render('calls', 1).list).toEqual([{ id: 'new' }]);
});
test('refresh failure retains records and explicit retry recovers without clearing them', async () => {
  axios.get.mockResolvedValueOnce({ data: [call] }).mockRejectedValueOnce(new Error('offline'));
  render(); await settle(); render('calls', 1); await settle();
  expect(render('calls', 1)).toMatchObject({ list: [call], loadError: true, loading: false });
  axios.get.mockResolvedValue({ data: [{ id: 'new' }] });
  render('calls', 1).retry(); expect(render('calls', 1).list).toEqual([call]); await settle();
  expect(render('calls', 1)).toMatchObject({ list: [{ id: 'new' }], loadError: false, loading: false });
});
test('malformed history becomes a recoverable failure', async () => {
  axios.get.mockResolvedValue({ data: { error: 'bad' } }); render(); await settle();
  expect(render()).toMatchObject({ list: [], loadError: true, loading: false });
});
test('repeated activation shares one request until chat opens', async () => {
  const request = deferred(); axios.post.mockReturnValue(request.promise);
  const first = render().openPeer(call); await render().openPeer(call);
  expect(axios.post).toHaveBeenCalledTimes(1); expect(render().openingId).toBe(call.id);
  request.resolve({ data: { conversationId: 'chat1' } }); await first;
  expect(onOpenChat).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'chat1', type: 'private' }));
  expect(render().openingId).toBe(null);
});
test.each([new Error('offline'), null])('opening failure or invalid response can be retried', async failure => {
  if (failure) axios.post.mockRejectedValueOnce(failure);
  else axios.post.mockResolvedValueOnce({ data: {} });
  await render().openPeer(call);
  expect(render().openErrorId).toBe(call.id); expect(onOpenChat).not.toHaveBeenCalled();
  await render().openPeer(call); expect(onOpenChat).toHaveBeenCalledOnce(); expect(render().openErrorId).toBe(null);
});
test('leaving the panel cancels loading and prevents a late navigation', async () => {
  const request = deferred(); axios.post.mockReturnValue(request.promise);
  const first = render().openPeer(call); unmount();
  expect(axios.get.mock.calls[0][1].signal.aborted).toBe(true);
  expect(axios.post.mock.calls[0][2].signal.aborted).toBe(true);
  request.resolve({ data: { conversationId: 'chat1' } }); await first;
  expect(onOpenChat).not.toHaveBeenCalled();
});
test('account change prevents late history and navigation from being applied', async () => {
  const load = deferred(), open = deferred(); axios.get.mockReturnValue(load.promise); axios.post.mockReturnValue(open.promise);
  const first = render().openPeer(call); hooks.owner++;
  load.resolve({ data: [call] }); open.resolve({ data: { conversationId: 'chat1' } }); await first; await settle();
  expect(render().list).toEqual([]); expect(onOpenChat).not.toHaveBeenCalled();
});
test('missing targets cannot be activated; group records open without creating a private chat', async () => {
  expect(canOpenCall({ id: 'missing' })).toBe(false);
  await render().openPeer({ id: 'missing' }); await render().openPeer({ id: 'group', kind: 'group' });
  expect(onOpenChat).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
  await render().openPeer({ id: 'group', kind: 'group', conversation_id: 'g1' });
  expect(onOpenChat).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'g1', type: 'group' }));
});

test('close and reopen the same message ignores the old response', async () => {
  const old = deferred(), fresh = deferred(); axios.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const first = render('read').load(message); render('read').close();
  expect(axios.get.mock.calls[0][1].signal.aborted).toBe(true); expect(render('read').state).toBe(null);
  const second = render('read').load(message);
  fresh.resolve({ data: { readStates: { m1: ['peer'] } } }); await second;
  old.resolve({ data: { readStates: { m1: [] } } }); await first;
  expect(render('read').state).toMatchObject({ readUserIds: ['peer'], loading: false, error: false });
});
test('late failure cannot replace a successful read-status retry', async () => {
  const old = deferred(), fresh = deferred(); axios.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const first = render('read').load(message), second = render('read').load(message);
  fresh.resolve({ data: { readStates: { m1: ['peer'] } } }); await second;
  old.reject(new Error('timeout')); await first;
  expect(render('read').state.error).toBe(false);
});
test('read-status failure has a recoverable error and retry clears it', async () => {
  axios.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { readStates: {} } });
  await render('read').load(message); expect(render('read').state.error).toBe(true);
  await render('read').load(message); expect(render('read').state).toMatchObject({ error: false, loading: false, readUserIds: [] });
});
test.each([{}, { readStates: [] }, { readStates: { m1: 'invalid' } }])('invalid read-status data %j is not shown as unread', async data => {
  axios.get.mockResolvedValue({ data }); await render('read').load(message);
  expect(render('read').state.error).toBe(true);
});
test.each(['leave', 'conversation', 'account'])('%s change blocks a pending read-status response', async action => {
  const request = deferred(); axios.get.mockReturnValue(request.promise);
  const first = render('read').load(message);
  if (action === 'leave') unmount();
  if (action === 'conversation') render('read', 'c2');
  if (action === 'account') hooks.owner++;
  request.resolve({ data: { readStates: { m1: ['peer'] } } }); await first;
  const state = render('read', action === 'conversation' ? 'c2' : 'c1').state;
  expect(state?.readUserIds || []).toEqual([]);
});
test('messages owned by someone else do not query read receipts', async () => {
  await render('read').load({ ...message, sender_id: 'peer' }); expect(axios.get).not.toHaveBeenCalled();
});
