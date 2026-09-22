import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { setupAxiosInterceptors, clearCsrfToken } from './axiosInterceptor';
import { invalidateSession, activateSession } from './sessionContext';
import { createFinancialRequest } from './financialRequest';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { cookie: '' });
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) });
  clearCsrfToken(); invalidateSession();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture(status) {
  let writes = 0;
  const client = axios.create({ adapter: async config => {
    writes++;
    if (writes === 1) throw new axios.AxiosError('synthetic response lost after commit', status ? 'ERR_BAD_RESPONSE' : 'ECONNABORTED', config, null,
      status ? { status, data: {}, headers: {}, config } : undefined);
    return { status: 200, data: {}, headers: {}, config };
  } });
  setupAxiosInterceptors(client);
  return { client, writes: () => writes };
}
test.each([502, 504, 500, undefined])('committed wallet POST with %s response is never replayed', async status => {
  const f = fixture(status);
  const result = f.client.post('/api/wallet/transfer', { amount: 10 }).then(() => 'success', () => 'uncertain');
  await vi.runAllTimersAsync();
  expect({ result: await result, debits: f.writes() }).toEqual({ result: 'uncertain', debits: 1 });
});
test.each(['post', 'put', 'patch', 'delete'])('%s is not automatically replayed on 502', async method => {
  const f = fixture(502);
  const result = f.client.request({ method, url: '/api/synthetic-write' }).catch(() => 'failed');
  await vi.runAllTimersAsync(); await result;
  expect(f.writes()).toBe(1);
});
test.each(['get', 'head', 'options'])('%s retains automatic recovery on transient 502', async method => {
  const f = fixture(502);
  const result = f.client.request({ method, url: '/api/synthetic-read' });
  await vi.runAllTimersAsync();
  expect((await result).status).toBe(200); expect(f.writes()).toBe(2);
});
test('cancellation is never retried', async () => {
  let calls = 0;
  const client = axios.create({ adapter: config => { calls++; return Promise.reject(new axios.CanceledError('synthetic abort', config)); } });
  setupAxiosInterceptors(client);
  const result = client.get('/api/cancelled').catch(e => e.code);
  await vi.runAllTimersAsync();
  expect(await result).toBe('ERR_CANCELED'); expect(calls).toBe(1);
});
test('financial key survives manual retry and credential refresh, but is scoped to account and payload', () => {
  activateSession('https://fixture.invalid', 'A');
  const config = createFinancialRequest();
  const payload = { amount: 10, to_user_id: 'B' };
  const first = config(payload);
  expect(first.skipRetry).toBe(true);
  const key = first.headers['Idempotency-Key'];
  expect(config({ ...payload }).headers['Idempotency-Key']).toBe(key);
  localStorage.setItem('touliao_session_revision', 'fresh');
  expect(config(payload).headers['Idempotency-Key']).toBe(key);
  expect(config({ ...payload, amount: 20 }).headers['Idempotency-Key']).not.toBe(key);
  expect(config(payload).headers['Idempotency-Key']).toBe(key);
  activateSession('https://fixture.invalid', 'C');
  expect(config(payload).headers['Idempotency-Key']).not.toBe(key);
});
test('financial POST cannot be replayed by the 401 refresh branch either', async () => {
  const f = fixture(401);
  const result = f.client.post('/api/wallet/transfer', {}, { skipRetry: true }).catch(() => 'failed');
  await vi.runAllTimersAsync();
  expect(await result).toBe('failed'); expect(f.writes()).toBe(1);
});
test.each(['get', 'post', 'put', 'patch', 'delete'])('%s without skipRetry refreshes on 401 and replays once', async method => {
  const calls = [];
  const client = axios.create({ adapter: async config => {
    calls.push(`${config.method} ${config.url}`);
    if (calls.length === 1) throw new axios.AxiosError('expired', 'ERR_BAD_RESPONSE', config, null,
      { status: 401, data: {}, headers: {}, config });
    return { status: 200, data: config.url.endsWith('/refresh') ? { token: 'synthetic-fresh' } : {}, headers: {}, config };
  } });
  setupAxiosInterceptors(client);
  expect((await client.request({ method, url: '/api/thing' })).status).toBe(200);
  expect(calls).toEqual([`${method} /api/thing`, 'post /api/auth/refresh', `${method} /api/thing`]);
});
test.each(['get', 'post'])('%s with skipRetry refuses both refresh and replay on 401', async method => {
  const f = fixture(401);
  await expect(f.client.request({ method, url: '/api/thing', skipRetry: true })).rejects.toMatchObject({ response: { status: 401 } });
  expect(f.writes()).toBe(1);
});
test.each([503, undefined, 401])('refresh failure %s is not replayed; only definitive auth rejection clears Bearer token', async status => {
  window.__ELECTRON_CONFIG__ = {};
  localStorage.setItem('touliao_electron_token', 'synthetic-old');
  const calls = [];
  const client = axios.create({ adapter: async config => {
    calls.push(config.url);
    if (config.url.endsWith('/refresh')) throw new axios.AxiosError('synthetic refresh failure', 'ERR_NETWORK', config, null,
      status ? { status, data: {}, headers: {}, config } : undefined);
    if (calls.length === 1) throw new axios.AxiosError('expired', 'ERR_BAD_RESPONSE', config, null,
      { status: 401, data: {}, headers: {}, config });
    return { status: 200, data: {}, headers: {}, config };
  } });
  client.defaults.headers.common.Authorization = 'Bearer synthetic-old';
  setupAxiosInterceptors(client);
  const result = client.get('/api/thing');
  await vi.runAllTimersAsync();
  expect((await result).status).toBe(200);
  expect(calls).toEqual(['/api/thing', '/api/auth/refresh', '/api/thing']);
  expect(localStorage.getItem('touliao_electron_token')).toBe(status === 401 ? undefined : 'synthetic-old');
  expect(client.defaults.headers.common.Authorization).toBe(status === 401 ? undefined : 'Bearer synthetic-old');
});
test('financial key falls back to random bytes when randomUUID is unavailable', () => {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const config = createFinancialRequest();
  const first = config({ amount: 1 }).headers['Idempotency-Key'];
  expect(first).toMatch(/^[a-f0-9]{32}$/);
  expect(config({ amount: 1 }).headers['Idempotency-Key']).toBe(first);
  expect(config({ amount: 2 }).headers['Idempotency-Key']).not.toBe(first);
});
test('safe read retries stop after three replays', async () => {
  let calls = 0;
  const client = axios.create({ adapter: config => {
    calls++;
    return Promise.reject(new axios.AxiosError('synthetic offline', 'ERR_NETWORK', config));
  } });
  setupAxiosInterceptors(client);
  const result = client.get('/api/offline').catch(() => 'failed');
  await vi.runAllTimersAsync();
  expect(await result).toBe('failed'); expect(calls).toBe(4);
});
