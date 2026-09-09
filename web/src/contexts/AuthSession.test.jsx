import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { AuthProvider } from './AuthContext';
import { captureSession, invalidateSession } from '../utils/sessionContext';
import { clearCsrfToken, setupAxiosInterceptors } from '../utils/axiosInterceptor';
const originalAdapter = axios.defaults.adapter;

// Exercise the real provider callbacks; only React scheduling and HTTP transport
// are fixtures. This is not a DOM/navigation test (the browser suite owns that).
const hooks = vi.hoisted(() => {
  globalThis.window = new EventTarget();
  return { effects: [], states: [] };
});
vi.mock('../utils/config', () => ({ getConfig: () => ({}), isConfigLoaded: () => false }));
vi.mock('react', async importOriginal => ({ ...(await importOriginal()),
  useEffect: effect => hooks.effects.push(effect),
  useRef: value => ({ current: value }),
  useState: initial => {
    const index = hooks.states.length;
    hooks.states.push(typeof initial === 'function' ? initial() : initial);
    return [hooks.states[index], value => { hooks.states[index] = value; }];
  },
}));
beforeEach(() => {
  hooks.effects.length = 0; hooks.states.length = 0;
  axios.interceptors.request.clear(); axios.interceptors.response.clear();
  clearCsrfToken();
  delete axios.defaults.baseURL;
  delete axios.defaults.headers.common.Authorization;
  const storage = new Map();
  const local = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', local);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { href: 'https://fixture.invalid', reload: vi.fn() } }));
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('document', { cookie: '' });
  invalidateSession();
});
afterEach(() => {
  axios.defaults.adapter = originalAdapter;
  axios.interceptors.request.clear(); axios.interceptors.response.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test.each(['success', 'failure'])('late bootstrap %s cannot publish after login B', async outcome => {
  let resolve, reject;
  vi.spyOn(axios, 'get').mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
  const api = AuthProvider({ children: null }).props.value;
  hooks.effects[2](); // real bootstrap effect
  api.login({ id: 'B' });
  if (outcome === 'success') resolve({ data: { id: 'A' } }); else reject(new Error('synthetic offline'));
  await flush();
  expect(captureSession().accountId).toBe('B');
  expect(hooks.states[0]).toEqual({ id: 'B' });
  expect(hooks.states[2]).toBe(false);
});

test.each(['B', 'ABA'])('late account-switch success cannot replace newer %s identity', async mode => {
  let resolve;
  vi.spyOn(axios, 'post').mockReturnValue(new Promise(yes => { resolve = yes; }));
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' });
  const switching = api.switchAccount('stale-target');
  api.login({ id: 'B' });
  if (mode === 'ABA') api.login({ id: 'A' });
  resolve({ data: { user: { id: 'stale-target' } } });
  await switching;
  expect(captureSession().accountId).toBe(mode === 'ABA' ? 'A' : 'B');
  expect(window.location.reload).not.toHaveBeenCalled();
});

test('current bootstrap and switch still publish their owners', async () => {
  vi.spyOn(axios, 'get').mockResolvedValue({ data: { id: 'A' } });
  vi.spyOn(axios, 'post').mockResolvedValue({ data: { user: { id: 'B' } } });
  const api = AuthProvider({ children: null }).props.value;
  hooks.effects[2](); await flush();
  expect(captureSession().accountId).toBe('A');
  expect(hooks.states[2]).toBe(false);
  await api.switchAccount('B');
  expect(captureSession().accountId).toBe('B');
  expect(window.location.reload).toHaveBeenCalledOnce();
});

test('bootstrap can publish after its own successful credential refresh', async () => {
  let resolve;
  vi.spyOn(axios, 'get').mockReturnValue(new Promise(yes => { resolve = yes; }));
  AuthProvider({ children: null });
  hooks.effects[2]();
  localStorage.setItem('touliao_session_revision', 'synthetic-refresh');
  resolve({ data: { id: 'A' }, config: { _sessionContext: captureSession() } });
  await flush();
  expect(captureSession().accountId).toBe('A');
  expect(hooks.states[2]).toBe(false);
});

test.each(['logout', 'deleteAccount', 'changeServer'])('late %s success cannot clear login B', async action => {
  let resolve;
  vi.spyOn(axios, 'post').mockReturnValue(new Promise(yes => { resolve = yes; }));
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' });
  const ending = api[action]('https://other.invalid');
  api.login({ id: 'B' });
  resolve({ data: {} }); await ending;
  expect(captureSession().accountId).toBe('B');
  expect(hooks.states[0]).toEqual({ id: 'B' });
});

test.each(['logout', 'deleteAccount', 'changeServer'])('late %s failure cannot clear login B', async action => {
  let reject;
  vi.spyOn(axios, 'post').mockReturnValue(new Promise((_yes, no) => { reject = no; }));
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' });
  const ending = api[action]('https://other.invalid');
  api.login({ id: 'B' });
  reject(new Error('synthetic offline'));
  await ending.catch(error => expect(error.message).toBe('synthetic offline'));
  expect(captureSession().accountId).toBe('B');
  expect(hooks.states[0]).toEqual({ id: 'B' });
});

test.each(['logout', 'deleteAccount', 'changeServer'])('current %s can still complete', async action => {
  vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' });
  await api[action]('https://other.invalid');
  expect(captureSession().accountId).toBeUndefined();
  expect(hooks.states[0]).toBe(null);
});

test('late change-password success cannot replace the newer login credential', async () => {
  window.__ELECTRON_CONFIG__ = {};
  let resolve;
  vi.spyOn(axios, 'put').mockReturnValue(new Promise(yes => { resolve = yes; }));
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' }, 'synthetic-A');
  const changing = api.changePassword('old', 'new');
  api.login({ id: 'B' }, 'synthetic-B');
  resolve({ data: { token: 'synthetic-new-A' } }); await changing;
  expect(localStorage.getItem('touliao_electron_token')).toBe('synthetic-B');
});

test.each(['logout', 'deleteAccount'])('%s paused in service-worker cleanup cannot continue under B', async action => {
  let resolve, started;
  const begun = new Promise(yes => { started = yes; });
  const getSubscription = vi.fn();
  navigator.serviceWorker = { getRegistration: () => {
    started(); return new Promise(yes => { resolve = yes; });
  } };
  vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' });
  const ending = api[action]('synthetic-password');
  await begun;
  api.login({ id: 'B' });
  resolve({ pushManager: { getSubscription } }); await ending;
  expect(getSubscription).not.toHaveBeenCalled();
  expect(captureSession().accountId).toBe('B');
  expect(hooks.states[0]).toEqual({ id: 'B' });
});

test('current change-password success installs the new credential and publishes its revision', async () => {
  window.__ELECTRON_CONFIG__ = {};
  vi.spyOn(axios, 'put').mockResolvedValue({ data: { token: 'synthetic-new-A' } });
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' }, 'synthetic-A');
  await api.changePassword('old', 'new');
  expect(captureSession().accountId).toBe('A');
  expect(localStorage.getItem('touliao_electron_token')).toBe('synthetic-new-A');
  expect(localStorage.getItem('touliao_session_revision')).toBeTruthy();
});

// Real Provider -> Axios -> refresh -> retried DELETE. No axios method mocks.
// Removing response-context adoption makes the refresh control fail; removing
// identity/revision guards makes the paused B/ABA cases clear the newer login.
function pushCleanupTransport({ refresh = false, cleanupFailure = false, pauseAt, onPause = () => {}, release = Promise.resolve() } = {}) {
  const wire = [];
  let deleteAttempts = 0;
  const unsubscribe = vi.fn(async () => {
    if (pauseAt === 'unsubscribe') { onPause(); await release; }
    return true;
  });
  navigator.serviceWorker = { getRegistration: async () => ({ pushManager: {
    getSubscription: async () => ({ endpoint: 'https://push.invalid/synthetic', unsubscribe }),
  } }) };
  const adapter = async config => {
    wire.push(`${config.method}:${config.url}`);
    if (config.url === '/api/notifications/web-subscribe') {
      if (refresh && deleteAttempts++ === 0) {
        throw new axios.AxiosError('synthetic expired credential', 'ERR_BAD_REQUEST', config, null, { status: 401, config });
      }
      if (pauseAt === 'delete') { onPause(); await release; }
      if (cleanupFailure) {
        throw new axios.AxiosError('synthetic cleanup forbidden', 'ERR_BAD_REQUEST', config, null, { status: 403, config });
      }
    }
    return { status: 200, data: config.url === '/api/auth/refresh' ? { token: 'synthetic-new-A' } : {}, headers: {}, config };
  };
  axios.defaults.adapter = adapter;
  setupAxiosInterceptors(axios);
  return { wire, unsubscribe };
}

test.each([false, true])('logout completes push cleanup through the real Axios chain (refresh=%s)', async refresh => {
  const { wire, unsubscribe } = pushCleanupTransport({ refresh });
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' });
  await api.logout();
  expect(wire).toEqual(refresh
    ? ['delete:/api/notifications/web-subscribe', 'post:/api/auth/refresh', 'delete:/api/notifications/web-subscribe', 'post:/api/auth/logout']
    : ['delete:/api/notifications/web-subscribe', 'post:/api/auth/logout']);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(hooks.states[0]).toBe(null);
  expect(captureSession().accountId).toBeUndefined();
});

test.each([
  ['delete', 'B'], ['delete', 'ABA'], ['unsubscribe', 'B'], ['unsubscribe', 'ABA'],
])('logout with refresh paused at %s cannot continue after %s', async (pauseAt, identity) => {
  let resume, started;
  const release = new Promise(resolve => { resume = resolve; });
  const begun = new Promise(resolve => { started = resolve; });
  const { wire, unsubscribe } = pushCleanupTransport({ refresh: true, pauseAt, release, onPause: started });
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' });
  const ending = api.logout();
  expect(await Promise.race([begun.then(() => true), ending.then(() => false)])).toBe(true);
  api.login({ id: 'B' });
  if (identity === 'ABA') api.login({ id: 'A' });
  resume(); await ending;
  expect(wire).not.toContain('post:/api/auth/logout');
  expect(unsubscribe).toHaveBeenCalledTimes(pauseAt === 'delete' ? 0 : 1);
  expect(captureSession().accountId).toBe(identity === 'ABA' ? 'A' : 'B');
  expect(hooks.states[0]).toEqual({ id: identity === 'ABA' ? 'A' : 'B' });
});

test('logout remains best-effort if push DELETE fails after its own valid refresh', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { wire, unsubscribe } = pushCleanupTransport({ refresh: true, cleanupFailure: true });
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' });
  await api.logout();
  expect(wire).toContain('post:/api/auth/logout');
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(hooks.states[0]).toBe(null);
});

// Client-only shared-pattern check: the adapter accepts refresh after a synthetic
// deletion. This does not establish that a real deleted account can refresh.
test.each([false, true])('deleteAccount consumes a synthetic cleanup response (refresh=%s)', async refresh => {
  const { wire, unsubscribe } = pushCleanupTransport({ refresh });
  const api = AuthProvider({ children: null }).props.value;
  api.login({ id: 'A' });
  await api.deleteAccount('synthetic-password');
  expect(wire[0]).toBe('post:/api/auth/delete-account');
  expect(wire).not.toContain('post:/api/auth/logout');
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(hooks.states[0]).toBe(null);
});
