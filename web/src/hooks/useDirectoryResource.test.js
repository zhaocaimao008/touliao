import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { useDirectoryResource } from './useDirectoryResource';
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
function render() {
  hooks.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Controlled hook scheduling for asynchronous regression tests.
  const result = useDirectoryResource('/api/users/contacts');
  hooks.effects.splice(0).forEach(effect => effect());
  return result;
}
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.owner = 1;
  vi.spyOn(axios, 'get').mockResolvedValue({ data: [] });
});
afterEach(() => { unmount(); vi.restoreAllMocks(); });

test('empty content is only shown after a successful response, including during retry', async () => {
  expect(render()).toMatchObject({ loading: true, loaded: false, emptyReady: false });
  axios.get.mockRejectedValueOnce(new Error('offline'));
  await render().reload();
  expect(render()).toMatchObject({ data: [], loading: false, error: true, loaded: false, emptyReady: false });
  const response = deferred(); axios.get.mockReturnValueOnce(response.promise);
  const retry = render().reload();
  expect(render()).toMatchObject({ loading: true, error: false, emptyReady: false });
  response.resolve({ data: [] }); await retry;
  expect(render()).toMatchObject({ loading: false, loaded: true, error: false, emptyReady: true });
});

test('background refresh failures preserve previously loaded data', async () => {
  const data = [{ id: 'friend-1', username: 'Original' }];
  axios.get.mockResolvedValueOnce({ data }); await render().reload();
  const response = deferred(); axios.get.mockReturnValueOnce(response.promise);
  const refresh = render().reload();
  expect(render()).toMatchObject({ data, loading: true, loaded: true });
  response.reject(new Error('offline')); await refresh;
  expect(render()).toMatchObject({ data, loading: false, loaded: true, error: true, emptyReady: false });
});

test.each([null, {}, { error: 'unauthorized' }, 'unexpected html'])('malformed response %j is a retryable failure, not an empty directory', async data => {
  axios.get.mockResolvedValueOnce({ data }); await render().reload();
  expect(render()).toMatchObject({ error: true, loaded: false, emptyReady: false });
});

test.each(['success', 'failure'])('older refresh %s cannot overwrite the latest response', async outcome => {
  const older = deferred(), newer = deferred();
  axios.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const first = render().reload(), second = render().reload();
  expect(axios.get.mock.calls[0][1].signal.aborted).toBe(true);
  expect(axios.get.mock.calls[1][1]._sessionContext).toEqual({ owner: 1 });
  newer.resolve({ data: [{ id: 'new' }] }); await second;
  if (outcome === 'success') older.resolve({ data: [{ id: 'old' }] }); else older.reject(new Error('offline'));
  await first;
  expect(render()).toMatchObject({ data: [{ id: 'new' }], loading: false, error: false });
});

test.each(['unmount', 'account'])('%s suppresses a late directory response', async change => {
  const response = deferred(); axios.get.mockReturnValueOnce(response.promise);
  const task = render().reload();
  if (change === 'unmount') { unmount(); expect(axios.get.mock.calls[0][1].signal.aborted).toBe(true); }
  else hooks.owner++;
  response.resolve({ data: [{ id: 'old-owner' }] }); await task;
  expect(render().data).toEqual([]);
});

test('late errors after a view unmount do not create feedback', async () => {
  const response = deferred(); axios.get.mockReturnValueOnce(response.promise);
  const task = render().reload(); unmount(); response.reject(new Error('offline')); await task;
  expect(render().error).toBe(false);
});

test('socket refresh replaces an in-flight list without dropping confirmed local changes while pending', async () => {
  axios.get.mockResolvedValueOnce({ data: [{ id: 'a' }] }); await render().reload();
  render().setData(previous => previous.map(row => ({ ...row, remark: 'New remark' })));
  const response = deferred(); axios.get.mockReturnValueOnce(response.promise);
  const task = render().reload();
  expect(render().data).toEqual([{ id: 'a', remark: 'New remark' }]);
  response.resolve({ data: [{ id: 'a', remark: 'New remark' }, { id: 'b' }] }); await task;
  expect(render().data).toHaveLength(2);
});
