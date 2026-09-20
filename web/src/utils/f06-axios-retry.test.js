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
