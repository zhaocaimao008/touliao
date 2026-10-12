import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// public/sw.js 是退役版：只为让 9a915ac2 之前注册在根作用域 '/' 的旧 worker 清理缓存并注销自己。
const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

// 历史上 /sw.js 建过的缓存（git log -p -- web/public/sw.js）。
const OWN = ['touliao-v2.0.19', 'touliao-v2.0.22', 'touliao-api-v1', 'vxin-v1', 'vxin-v2', 'vxin-v2.0.19'];
// 同源上的其他缓存，含名字相近、将来可能出现的。
const FOREIGN = ['workbox-precache-v2-https://app.test/', 'landing-pages', 'my-touliao-v1',
  'touliao-media-v1', 'touliao-api-v2', 'touliao-v3-shell', 'vxin-video-cache', 'vxin-voice'];

// 伪造的 ServiceWorkerGlobalScope：沙箱对象本身就是全局对象，self 指回它自己，
// 所以 self.addEventListener(...)、裸 addEventListener(...)、self.onfetch = ... 都能被看到。
// unregister() 按没有受控页面时的规范行为（WebKit 实测如此）立刻终止 worker：
// 之后再发起的 caches 操作都不会生效，用来抓「删缓存和注销并行」的写法。
function loadWorker({ scriptPath = '/sw.js', registration = {}, caches: cacheOverrides = {}, windows = [] } = {}) {
  const listeners = {};
  const names = new Set([...OWN, ...FOREIGN]);
  const calls = [];
  let terminated = false;
  const scope = {
    location: new URL(`https://app.test${scriptPath}`),
    registration: { scope: 'https://app.test/', installing: null, waiting: null, active: {},
      unregister: vi.fn(async () => { calls.push('unregister'); terminated = true; return true; }), ...registration },
    skipWaiting: vi.fn().mockResolvedValue(),
    addEventListener: vi.fn((type, fn) => { (listeners[type] ||= []).push(fn); }),
    caches: {
      keys: vi.fn(async () => (terminated ? [] : [...names])),
      delete: vi.fn(async name => {
        if (terminated) return false;
        calls.push(`delete:${name}`);
        return names.delete(name);
      }),
      open: vi.fn(), match: vi.fn(), ...cacheOverrides },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => windows), openWindow: vi.fn().mockResolvedValue(null) },
    importScripts: vi.fn(),
    console: { info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  scope.self = scope;
  vm.runInNewContext(source, scope);
  const dispatch = async (type, event = {}) => {
    const pending = [];
    for (const fn of listeners[type] || []) fn({ ...event, waitUntil: promise => pending.push(promise) });
    await Promise.all(pending);
    return pending.length;
  };
  return { scope, listeners, names, calls, dispatch, registration: scope.registration };
}

test('handles install, activate and notification clicks only: no fetch interception, no push, no imported scripts', () => {
  const { scope, listeners } = loadWorker();
  expect(Object.keys(listeners).sort()).toEqual(['activate', 'install', 'notificationclick']);
  for (const handler of ['onfetch', 'onpush', 'onmessage', 'onnotificationclick']) expect(scope[handler]).toBeUndefined();
  expect(scope.importScripts).not.toHaveBeenCalled();
  expect(source).toContain('touliao-sw-retired-20261012');
});

test('install skips waiting so the legacy worker and its fetch handler are replaced immediately', async () => {
  const w = loadWorker();
  expect(await w.dispatch('install')).toBe(1);
  expect(w.scope.skipWaiting).toHaveBeenCalledOnce();
  expect(w.registration.unregister).not.toHaveBeenCalled();
});

test('activate deletes only the legacy caches, then unregisters its own registration without touching pages', async () => {
  const w = loadWorker();
  await w.dispatch('activate');
  expect([...w.names].sort()).toEqual([...FOREIGN].sort());
  expect(w.scope.caches.delete.mock.calls.map(([name]) => name).sort()).toEqual([...OWN].sort());
  expect(w.registration.unregister).toHaveBeenCalledOnce();
  expect(w.scope.clients.claim).not.toHaveBeenCalled();
  expect(w.scope.clients.matchAll).not.toHaveBeenCalled();
  expect(w.scope.clients.openWindow).not.toHaveBeenCalled();
});

test('every cache is deleted before unregister(), which may terminate the worker at once', async () => {
  const w = loadWorker();
  await w.dispatch('activate');
  expect(w.calls).toHaveLength(OWN.length + 1);
  expect(w.calls.at(-1)).toBe('unregister');
});

test.each(['installing', 'waiting'])('a worker %s on the same registration (e.g. /push-sw.js at "/") is never unregistered with it', async state => {
  const w = loadWorker({ registration: { [state]: { scriptURL: 'https://app.test/push-sw.js' } } });
  await w.dispatch('activate');
  expect(w.registration.unregister).not.toHaveBeenCalled();
  expect([...w.names].sort()).toEqual([...FOREIGN].sort());
});

test('never unregisters when evaluated as another worker\'s script (e.g. imported into push-sw.js)', async () => {
  const w = loadWorker({ scriptPath: '/push-sw.js', registration: { scope: 'https://app.test/push/A/S/default/' } });
  await w.dispatch('activate');
  expect(w.registration.unregister).not.toHaveBeenCalled();
});

test('a failed cache cleanup still unregisters, a failed unregister still cleans up, and activation never rejects', async () => {
  const brokenCaches = loadWorker({ caches: { keys: vi.fn().mockRejectedValue(new Error('storage')) } });
  await expect(brokenCaches.dispatch('activate')).resolves.toBe(1);
  expect(brokenCaches.registration.unregister).toHaveBeenCalledOnce();

  const brokenUnregister = loadWorker({ registration: { unregister: vi.fn().mockRejectedValue(new Error('gone')) } });
  await expect(brokenUnregister.dispatch('activate')).resolves.toBe(1);
  expect([...brokenUnregister.names].sort()).toEqual([...FOREIGN].sort());
});

test('a click on a notification left by the legacy worker focuses an open window and ignores its data', async () => {
  const focus = vi.fn().mockResolvedValue();
  const w = loadWorker({ windows: [{ url: 'https://app.test/', focus }] });
  const notification = { close: vi.fn(), data: { recipientId: 'other-account', conversationId: 'c1' } };
  expect(await w.dispatch('notificationclick', { notification, action: '' })).toBe(1);
  expect(notification.close).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledOnce();
  expect(w.scope.clients.openWindow).not.toHaveBeenCalled();
  expect(w.registration.unregister).not.toHaveBeenCalled();
});

test('a notification click with no open window opens the home page only', async () => {
  const w = loadWorker();
  const notification = { close: vi.fn(), data: { recipientId: 'A', conversationId: 'c1', windowId: 'w' } };
  await w.dispatch('notificationclick', { notification, action: '' });
  expect(notification.close).toHaveBeenCalledOnce();
  expect(w.scope.clients.openWindow.mock.calls).toEqual([['/']]);
});
