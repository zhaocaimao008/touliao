import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import useBatchRecall from './useBatchRecall';
import { showConfirm } from '../utils/toast';
const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], owner: 1 }));
vi.mock('react', () => ({
  useState: initial => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], value => { hooks.slots[i] = value; }];
  },
  useRef: initial => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
    return hooks.slots[i];
  }, useCallback: fn => fn, useEffect: effect => { hooks.effects.push(effect); },
}));
vi.mock('../utils/toast', () => ({ showConfirm: vi.fn() }));
vi.mock('../utils/sessionContext', () => ({ captureSession: () => ({ owner: hooks.owner }), isSessionCurrent: scope => scope.owner === hooks.owner }));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const success = count => ({ data: { success: true, deleted: count } });
let options;
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.owner = 1;
  options = { conversationId: 'c1', t: key => key, onComplete: vi.fn(), onReconcile: vi.fn() };
  showConfirm.mockReset().mockResolvedValue(true);
  vi.spyOn(axios, 'post').mockResolvedValue(success(2));
});
afterEach(() => vi.restoreAllMocks());
// eslint-disable-next-line react-hooks/rules-of-hooks -- Deterministic hook runner for the Node test environment.
const render = () => { hooks.cursor = 0; return useBatchRecall(options); };

test('confirmation and request share one lock and preserve the confirmed snapshot', async () => {
  const confirm = deferred(), request = deferred();
  showConfirm.mockReturnValue(confirm.promise); axios.post.mockReturnValue(request.promise);
  const ids = new Set(['a', 'b']);
  const first = render().run(ids);
  await render().run(ids);
  expect(showConfirm).toHaveBeenCalledTimes(1); expect(render().phase).toBe('confirming');
  ids.add('not-confirmed'); confirm.resolve(true); await Promise.resolve();
  expect(render().phase).toBe('sending');
  await render().run(ids); expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][1]).toEqual({ conversationId: 'c1', msgIds: ['a', 'b'] });
  request.resolve(success(2)); await first;
  expect(options.onComplete).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
  expect(render().busy).toBe(false); expect(render().isPending()).toBe(false);
});
test('failed request keeps the view and selection, releases the lock, and permits explicit retry', async () => {
  axios.post.mockRejectedValueOnce(new Error('offline'));
  await render().run(['a', 'b']);
  expect(options.onComplete).not.toHaveBeenCalled();
  expect(render().error).toBe('multiSelect.recallFailed'); expect(render().busy).toBe(false);
  expect(options.onReconcile).toHaveBeenCalledOnce();
  await render().run(['a', 'b']);
  expect(options.onComplete).toHaveBeenCalledExactlyOnceWith(['a', 'b']); expect(render().error).toBe('');
});
test('cancelling confirmation performs no request and permits the next action', async () => {
  showConfirm.mockResolvedValue(false);
  await render().run(['a']);
  expect(axios.post).not.toHaveBeenCalled(); expect(options.onComplete).not.toHaveBeenCalled();
  expect(render().busy).toBe(false); expect(render().isPending()).toBe(false);
});
test.each([0, 21])('invalid selection size %s never opens a destructive confirmation', async count => {
  await render().run(Array.from({ length: count }, (_, n) => String(n)));
  expect(showConfirm).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
});
test.each([0, 1])('partial result %s does not claim all selected messages were recalled', async count => {
  axios.post.mockResolvedValue(success(count));
  await render().run(['a', 'b']);
  expect(options.onComplete).not.toHaveBeenCalled(); expect(options.onReconcile).toHaveBeenCalledOnce();
  expect(render().error).toBe('multiSelect.partialRecall'); expect(render().busy).toBe(false);
});
test('malformed response cannot clear messages or selection', async () => {
  axios.post.mockResolvedValue({ data: { success: true } });
  await render().run(['a']);
  expect(options.onComplete).not.toHaveBeenCalled(); expect(render().error).toBe('multiSelect.recallFailed');
});
test('account change while confirming cannot send under the next account', async () => {
  const confirm = deferred(); showConfirm.mockReturnValue(confirm.promise);
  const task = render().run(['a']); hooks.owner++;
  confirm.resolve(true); await task;
  expect(axios.post).not.toHaveBeenCalled(); expect(options.onComplete).not.toHaveBeenCalled();
});
test('unmount cancels in-flight work and ignores a late success even if abort is ignored', async () => {
  const request = deferred(); axios.post.mockReturnValue(request.promise);
  const hook = render(), cleanup = hooks.effects[0]();
  const task = hook.run(['a', 'b']); await Promise.resolve();
  const signal = axios.post.mock.calls[0][2].signal;
  cleanup(); expect(signal.aborted).toBe(true);
  request.resolve(success(2)); await task;
  expect(options.onComplete).not.toHaveBeenCalled(); expect(options.onReconcile).not.toHaveBeenCalled();
});
