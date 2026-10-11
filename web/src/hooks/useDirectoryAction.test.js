import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { useDirectoryAction } from './useDirectoryAction';
const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], owner: 1 }));
vi.mock('react', () => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => v !== b[i]);
  return {
    useState: initial => {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial;
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
      hooks.effects.push(() => { hooks.slots[i]?.cleanup?.(); hooks.slots[i] = { deps, cleanup: fn() }; });
    },
  };
});
vi.mock('../utils/sessionContext', () => ({ captureSession: () => ({ owner: hooks.owner }), isSessionCurrent: scope => scope.owner === hooks.owner }));

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const unmount = () => hooks.slots.forEach(slot => slot?.cleanup?.());
let viewKey, request, commit, onSuccess, reconcile;
function render() {
  hooks.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Controlled hook scheduling for asynchronous regression tests.
  const result = useDirectoryAction(viewKey);
  hooks.effects.splice(0).forEach(effect => effect());
  return result;
}
const changeView = key => { viewKey = key; render(); return render(); };
const run = extras => render().run({ key: 'save', request, commit, onSuccess, reconcile, ...extras });
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.owner = 1; viewKey = 'edit:one';
  request = vi.fn().mockResolvedValue({ id: 'one' }); commit = vi.fn(); onSuccess = vi.fn(); reconcile = vi.fn().mockResolvedValue();
});
afterEach(() => { unmount(); vi.restoreAllMocks(); });

test('rapid competing actions acquire one synchronous lock until acknowledgement', async () => {
  const response = deferred(); request.mockReturnValue(response.promise);
  const first = run(); await run({ key: 'delete' });
  expect(request).toHaveBeenCalledTimes(1); expect(render().pendingKey).toBe('save');
  expect(request.mock.calls[0][0]._sessionContext).toEqual({ owner: 1 });
  expect(commit).not.toHaveBeenCalled();
  response.resolve({ id: 'one' }); expect(await first).toBe(true);
  expect(commit).toHaveBeenCalledExactlyOnceWith({ id: 'one' });
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith({ id: 'one' });
  expect(render().pendingKey).toBeNull();
});
test('confirmation is locked before opening and cancelling sends no write', async () => {
  const answer = deferred(), confirm = vi.fn(() => answer.promise);
  const first = run({ confirm }); await run({ confirm });
  expect(confirm).toHaveBeenCalledTimes(1); expect(request).not.toHaveBeenCalled();
  answer.resolve(false); expect(await first).toBe(false);
  expect(request).not.toHaveBeenCalled(); expect(render().pendingKey).toBeNull();
});
test.each(['leave', 'roundtrip', 'account', 'unmount'])('%s during confirmation invalidates later approval', async change => {
  const answer = deferred(); const first = run({ confirm: () => answer.promise });
  if (change === 'account') hooks.owner++;
  else if (change === 'unmount') unmount();
  else { changeView('list'); if (change === 'roundtrip') changeView('edit:one'); }
  answer.resolve(true); await first;
  expect(request).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
});
test.each(['leave', 'roundtrip'])('%s while writing preserves the lock and confirmed data without closing a later editor', async change => {
  const response = deferred(); request.mockReturnValue(response.promise);
  const first = run(); changeView('list'); if (change === 'roundtrip') changeView('edit:one');
  await run(); expect(request).toHaveBeenCalledTimes(1);
  response.resolve({ id: 'one' }); await first;
  expect(commit).toHaveBeenCalledTimes(1); expect(onSuccess).not.toHaveBeenCalled();
  expect(render().pendingKey).toBeNull();
});
test.each(['account', 'unmount'])('%s suppresses old-account commits and UI effects', async change => {
  const response = deferred(); request.mockReturnValue(response.promise);
  const first = run();
  if (change === 'account') hooks.owner++; else unmount();
  response.resolve({ id: 'one' }); await first;
  expect(commit).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled();
  if (change === 'unmount') expect(request.mock.calls[0][0].signal.aborted).toBe(true);
});
test('lost acknowledgement reads back before unlocking and never replays a write', async () => {
  const read = deferred(); reconcile.mockReturnValue(read.promise); request.mockRejectedValue(new Error('offline'));
  const first = run(); await Promise.resolve(); await Promise.resolve();
  expect(reconcile).toHaveBeenCalledTimes(1); expect(render().pendingKey).toBe('save');
  await run(); expect(request).toHaveBeenCalledTimes(1);
  read.resolve(); await first;
  expect(render()).toMatchObject({ error: true, pendingKey: null });
  expect(commit).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled();
});
test('read-back failure still releases the lock and retains honest error feedback', async () => {
  request.mockRejectedValue(new Error('offline')); reconcile.mockRejectedValue(new Error('offline'));
  expect(await run()).toBe(false); expect(render()).toMatchObject({ error: true, pendingKey: null });
});
test('late failure in another view refreshes data without stale visible feedback', async () => {
  const response = deferred(); request.mockReturnValue(response.promise);
  const first = run(); changeView('list'); response.reject(new Error('offline')); await first;
  expect(reconcile).toHaveBeenCalledTimes(1); expect(render().error).toBe(false);
  changeView('edit:one'); expect(render().error).toBe(false);
});
test('leaving a failed editor clears its error even after returning', async () => {
  request.mockRejectedValueOnce(new Error('offline')); await run(); expect(render().error).toBe(true);
  changeView('list'); changeView('edit:one'); expect(render().error).toBe(false);
});
test('callbacks retained from a previous view cannot start a write', async () => {
  const old = render().run; changeView('list'); changeView('edit:one');
  await old({ key: 'save', request }); expect(request).not.toHaveBeenCalled();
});
test('a new attempt clears previous failure and can complete normally', async () => {
  request.mockRejectedValueOnce(new Error('offline')); await run(); expect(render().error).toBe(true);
  expect(await run()).toBe(true); expect(render()).toMatchObject({ error: false, pendingKey: null });
});
