import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import useMomentUnread from './useMomentUnread';
const hooks = vi.hoisted(() => ({ count: 0, effects: [] }));
vi.mock('react', () => ({ useState: () => [hooks.count, value => { hooks.count = value; }], useEffect: effect => hooks.effects.push(effect) }));
let listeners;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
// eslint-disable-next-line react-hooks/rules-of-hooks -- Controlled hook runner for the Node test environment.
const render = enabled => useMomentUnread(enabled, 'chats');
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  hooks.count = 0; hooks.effects = []; listeners = new Map();
  vi.stubGlobal('window', { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) });
  vi.spyOn(axios, 'get').mockResolvedValue({ data: { count: 3 } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
test('disabled or unresolved feature never requests or registers a listener', () => {
  hooks.count = 9;
  expect(render(false)).toBe(0); hooks.effects.at(-1)();
  expect(axios.get).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
});
test('enabled feature loads and refreshes its badge from interaction events', async () => {
  render(true); const cleanup = hooks.effects.at(-1)(); await settle();
  expect(render(true)).toBe(3);
  axios.get.mockResolvedValue({ data: { count: 7 } }); listeners.get('touliao:moment')(); await settle();
  expect(render(true)).toBe(7); cleanup(); expect(listeners.size).toBe(0);
});
test('slower old response cannot overwrite a newer badge', async () => {
  const first = deferred(), second = deferred();
  axios.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(true); hooks.effects.at(-1)();
  const signal = axios.get.mock.calls[0][1].signal;
  listeners.get('touliao:moment')(); expect(signal.aborted).toBe(true);
  second.resolve({ data: { count: 8 } }); await settle();
  first.resolve({ data: { count: 2 } }); await settle(); expect(render(true)).toBe(8);
});
test('disabling the feature cancels requests and late failure cannot change the count', async () => {
  const request = deferred(); axios.get.mockReturnValue(request.promise);
  hooks.count = 5; render(true); const cleanup = hooks.effects.at(-1)();
  cleanup(); expect(axios.get.mock.calls[0][1].signal.aborted).toBe(true);
  request.reject(new Error('cancelled')); await settle();
  expect(hooks.count).toBe(5); expect(render(false)).toBe(0); expect(listeners.size).toBe(0);
});
