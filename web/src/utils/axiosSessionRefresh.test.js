import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { setupAxiosInterceptors, clearCsrfToken, setCsrfToken, notifyCredentialsUpdated } from './axiosInterceptor';

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal('localStorage', { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) });
  clearCsrfToken();
});
afterEach(() => { vi.unstubAllGlobals(); });

// The transport fixture models actual server responses while using the real Axios interceptor chain.
function clientForRefresh(bearer) {
  let reads = 0;
  const client = axios.create({ adapter: async config => {
    if (config.url === '/api/auth/refresh') return { status: 200, data: { success: true, token: 'synthetic-new-token' }, headers: {}, config };
    reads += 1;
    if (reads === 1 || (bearer && config.headers.get('Authorization') !== 'Bearer synthetic-new-token')) {
      throw new axios.AxiosError('Synthetic credential expired', 'ERR_BAD_REQUEST', config, null, { status: 401, data: {}, headers: {}, config });
    }
    return { status: 200, data: { accountAvailable: true }, headers: {}, config };
  } });
  if (bearer) {
    window.__ELECTRON_CONFIG__ = {};
    client.defaults.headers.common.Authorization = 'Bearer synthetic-old-token';
  }
  setupAxiosInterceptors(client);
  return client;
}

test('Electron retries the original protected request with the newly refreshed Bearer credential', async () => {
  const client = clientForRefresh(true);
  const result = await client.get('/api/protected-fixture')
    .then(response => ({ status: response.status, available: response.data.accountAvailable }),
      error => ({ status: error.response?.status, available: false }));
  expect(result).toEqual({ status: 200, available: true });
});

test('successful Cookie refresh signals credential readiness so an idle Socket can reconnect', async () => {
  let ready = false;
  window.addEventListener('touliao:credentials-updated', () => { ready = true; });
  const client = clientForRefresh(false);
  expect((await client.get('/api/protected-fixture')).status).toBe(200);
  expect(ready).toBe(true);
});

test('sibling revision uses the current CSRF Cookie on a write without background GET', async () => {
  setCsrfToken('old-csrf');
  document.cookie = 'csrf_token=current-csrf';
  localStorage.setItem('touliao_session_revision', 'sibling-rotation');
  const client = axios.create({ adapter: async config => ({ status: 200,
    data: { accepted: config.headers.get('X-CSRF-Token') === 'current-csrf' }, headers: {}, config }) });
  setupAxiosInterceptors(client);
  expect((await client.put('/api/fixture', {})).data.accepted).toBe(true);
});

test('credential listeners observe the new revision synchronously', () => {
  let seen;
  window.addEventListener('touliao:credentials-updated', () => { seen = localStorage.getItem('touliao_session_revision'); });
  notifyCredentialsUpdated();
  expect(seen).toBeTruthy();
  expect(seen).toBe(localStorage.getItem('touliao_session_revision'));
});

test.each(['same-tab', 'sibling'])('late old header cannot poison subsequent writes after %s rotation', async mode => {
  let finish;
  const client = axios.create({ adapter: config => config.url === '/slow'
    ? new Promise(resolve => { finish = () => resolve({ status: 200, data: {}, headers: { 'x-csrf-token': 'stale' }, config }); })
    : Promise.resolve({ status: 200, data: { csrf: config.headers.get('X-CSRF-Token') || null }, headers: {}, config }) });
  setupAxiosInterceptors(client);
  const old = client.get('/slow').catch(error => error.code);
  await Promise.resolve();
  document.cookie = 'csrf_token=fresh';
  if (mode === 'same-tab') notifyCredentialsUpdated();
  else localStorage.setItem('touliao_session_revision', 'sibling');
  expect((await client.put('/write')).data.csrf).toBe('fresh');
  finish();
  expect(await old).toBe('ERR_CANCELED');
  expect((await client.put('/write')).data.csrf).toBe('fresh');
  document.cookie = '';
  localStorage.setItem('touliao_session_revision', 'logout');
  expect((await client.put('/write')).data.csrf).toBe(null);
});
