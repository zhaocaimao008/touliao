import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSearchTask } from './searchTask';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('search task replacement and recovery', () => {
  it('does not request a cleared query or publish a canceled debounce', async () => {
    const load = vi.fn().mockResolvedValue([]), onState = vi.fn();
    const cancel = startSearchTask({ key: 'old', query: 'old', load, onState });
    cancel();
    startSearchTask({ key: 'empty', query: '  ', load, onState });
    await vi.runAllTimersAsync();
    expect(load).not.toHaveBeenCalled();
    expect(onState.mock.lastCall[0]).toMatchObject({ key: 'empty', status: 'idle', data: [] });
  });

  it('ignores an older response even when its transport ignores abort', async () => {
    const old = deferred(), current = deferred(), onState = vi.fn();
    let oldSignal;
    const cancel = startSearchTask({ key: 'old', query: 'old', load: (_, signal) => { oldSignal = signal; return old.promise; }, onState });
    await vi.advanceTimersByTimeAsync(280);
    cancel();
    startSearchTask({ key: 'current', query: 'new', load: () => current.promise, onState });
    await vi.advanceTimersByTimeAsync(280);
    current.resolve([{ id: 'new' }]);
    await vi.runAllTimersAsync();
    old.resolve([{ id: 'old' }]);
    await vi.runAllTimersAsync();
    expect(oldSignal.aborted).toBe(true);
    expect(onState.mock.lastCall[0]).toMatchObject({ key: 'current', status: 'success', data: [{ id: 'new' }] });
    expect(onState.mock.calls.filter(([state]) => state.key === 'old' && state.status === 'success')).toHaveLength(0);
  });

  it('separates failure from empty results and allows retrying the same query', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]), onState = vi.fn();
    const cancel = startSearchTask({ key: 'query', query: 'same', load, onState });
    await vi.runAllTimersAsync();
    expect(onState.mock.lastCall[0].status).toBe('error');
    cancel();
    startSearchTask({ key: 'query', query: 'same', load, onState });
    expect(onState.mock.lastCall[0].status).toBe('loading');
    await vi.runAllTimersAsync();
    expect(onState.mock.lastCall[0]).toMatchObject({ status: 'success', data: [] });
  });

  it('publishes nothing after unmount, including late failures', async () => {
    const pending = deferred(), onState = vi.fn();
    const cancel = startSearchTask({ key: 'query', query: 'value', load: () => pending.promise, onState });
    await vi.advanceTimersByTimeAsync(280);
    cancel();
    pending.reject(new Error('late failure'));
    await vi.runAllTimersAsync();
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState.mock.lastCall[0].status).toBe('loading');
  });
});
