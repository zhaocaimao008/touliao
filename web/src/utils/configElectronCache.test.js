import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// config.js 依赖 clientStorage（内部读写 localStorage）；这里用内存实现替身
const store = new Map();
vi.mock('./clientStorage', () => ({
  clientStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
}));

beforeEach(() => {
  store.clear();
  vi.resetModules();
});
afterEach(() => { vi.unstubAllGlobals(); });

const remote = { api: 'https://new.example', socket: 'https://new.example', cdn: '', version: '9' };

test('Electron 有缓存时立即用缓存，后台刷新缓存', async () => {
  vi.stubGlobal('window', { __ELECTRON_CONFIG__: {} });
  store.set('touliao_remote_config', JSON.stringify({ api: 'https://old.example', socket: 'https://old.example' }));
  let release;
  const fetchMock = vi.fn(() => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => remote }); }));
  vi.stubGlobal('fetch', fetchMock);
  const { loadRemoteConfig, isConfigLoaded, getConfig } = await import('./config.js');
  const cfg = await loadRemoteConfig();          // 不等待网络
  expect(cfg.api).toBe('https://old.example');
  expect(isConfigLoaded()).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);    // 后台刷新已发出
  release();
  await vi.waitFor(() => expect(JSON.parse(store.get('touliao_remote_config')).api).toBe('https://new.example'));
  expect(getConfig().api).toBe('https://old.example'); // 本次会话保持一致，下次启动生效
});

test('Electron 无缓存时保持原行为：等待远程配置', async () => {
  vi.stubGlobal('window', { __ELECTRON_CONFIG__: {} });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => remote })));
  const { loadRemoteConfig } = await import('./config.js');
  expect((await loadRemoteConfig()).api).toBe('https://new.example');
});

test('网页端有缓存也先拉远程（行为不变）', async () => {
  vi.stubGlobal('window', {});
  store.set('touliao_remote_config', JSON.stringify({ api: 'https://old.example' }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => remote })));
  const { loadRemoteConfig } = await import('./config.js');
  expect((await loadRemoteConfig()).api).toBe('https://new.example');
});
