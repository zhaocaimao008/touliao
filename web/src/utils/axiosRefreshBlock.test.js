import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { setupAxiosInterceptors, clearCsrfToken, resetRefreshBlock, isRefreshBlocked, __resetAuthRefreshForTests } from './axiosInterceptor';
import { invalidateSession } from './sessionContext';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { cookie: '' });
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) });
  clearCsrfToken(); invalidateSession(); __resetAuthRefreshForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const err = (config, status, headers = {}) => new axios.AxiosError('synthetic', 'ERR_BAD_REQUEST', config, null, { status, data: {}, headers, config });

// 所有受保护接口恒 401、refresh 返回指定状态的"坏 token"客户端
function badTokenClient(refreshStatus, refreshHeaders) {
  const calls = [];
  const client = axios.create({ adapter: async config => {
    calls.push(config.url);
    if (config.url.endsWith('/refresh')) throw err(config, refreshStatus, refreshHeaders);
    throw err(config, 401);
  } });
  setupAxiosInterceptors(client);
  return { client, calls };
}

test.each([401, 403])('refresh %s 后熔断：后续 401 不再 refresh、不再重放', async status => {
  const { client, calls } = badTokenClient(status);
  await expect(client.get('/api/a')).rejects.toMatchObject({ response: { status: 401 } });
  expect(calls).toEqual(['/api/a', '/api/auth/refresh', '/api/a']);   // 多标签竞态兜底重放仍保留一次
  expect(isRefreshBlocked()).toBe(true);
  calls.length = 0;
  await Promise.all([client.get('/api/b').catch(() => {}), client.get('/api/auth/me').catch(() => {}), client.post('/api/c').catch(() => {})]);
  expect(calls).toEqual(['/api/b', '/api/auth/me', '/api/c']);       // 每个请求只打一次，零 refresh
});

test('refresh 429：不重放原请求，按 Retry-After 退避后才允许再次 refresh', async () => {
  const { client, calls } = badTokenClient(429, { 'retry-after': '30' });
  await expect(client.get('/api/a')).rejects.toMatchObject({ response: { status: 401 } });
  expect(calls).toEqual(['/api/a', '/api/auth/refresh']);
  calls.length = 0;
  await client.get('/api/b').catch(() => {});
  expect(calls).toEqual(['/api/b']);
  vi.advanceTimersByTime(31_000);
  expect(isRefreshBlocked()).toBe(false);
  calls.length = 0;
  await client.get('/api/c').catch(() => {});
  expect(calls).toContain('/api/auth/refresh');
});

test('并发 401 只发一次 refresh', async () => {
  const { client, calls } = badTokenClient(401);
  await Promise.all(['/api/1', '/api/2', '/api/3'].map(u => client.get(u).catch(() => {})));
  expect(calls.filter(u => u.endsWith('/refresh'))).toHaveLength(1);
});

test('凭证变化（session revision 变化 / 登录 reset）后解除熔断', async () => {
  const { client } = badTokenClient(401);
  await client.get('/api/a').catch(() => {});
  expect(isRefreshBlocked()).toBe(true);
  localStorage.setItem('touliao_session_revision', 'sibling-tab-rotated');
  expect(isRefreshBlocked()).toBe(false);
  await client.get('/api/a').catch(() => {});
  expect(isRefreshBlocked()).toBe(true);
  resetRefreshBlock();
  expect(isRefreshBlocked()).toBe(false);
});
