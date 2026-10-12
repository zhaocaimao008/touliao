import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// public/sw.js 是退役版：只为让 9a915ac2 之前注册在根作用域 '/' 的旧 worker 清理缓存并注销自己。
const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

const OWN = ['touliao-v2.0.22', 'touliao-api-v1', 'vxin-v2.0.19'];
const FOREIGN = ['workbox-precache-v2-https://app.test/', 'landing-pages', 'my-touliao-v1'];

// 伪造的 ServiceWorkerGlobalScope：沙箱对象本身就是全局对象，self 指回它自己，
// 所以 self.addEventListener(...)、裸 addEventListener(...)、self.onfetch = ... 都能被看到。
function loadWorker({ scriptPath = '/sw.js', registration = {}, caches: cacheOverrides = {} } = {}) {
  const listeners = {};
  const names = new Set([...OWN, ...FOREIGN]);
  const scope = {
    location: new URL(`https://app.test${scriptPath}`),
    registration: { scope: 'https://app.test/', installing: null, waiting: null, active: {},
      unregister: vi.fn().mockResolvedValue(true), ...registration },
    skipWaiting: vi.fn().mockResolvedValue(),
    addEventListener: vi.fn((type, fn) => { (listeners[type] ||= []).push(fn); }),
    caches: { keys: vi.fn(async () => [...names]), delete: vi.fn(async name => names.delete(name)),
      open: vi.fn(), match: vi.fn(), ...cacheOverrides },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn() },
    importScripts: vi.fn(),
    console: { info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  scope.self = scope;
  vm.runInNewContext(source, scope);
  const dispatch = async type => {
    const pending = [];
    for (const fn of listeners[type] || []) fn({ waitUntil: promise => pending.push(promise) });
    await Promise.all(pending);
    return pending.length;
  };
  return { scope, listeners, names, dispatch, registration: scope.registration };
}

test('only install and activate are handled: no fetch interception, no push, no imported scripts', () => {
  const { scope, listeners } = loadWorker();
  expect(Object.keys(listeners).sort()).toEqual(['activate', 'install']);
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

test('activate deletes only this app\'s caches, then unregisters its own registration without touching pages', async () => {
  const w = loadWorker();
  await w.dispatch('activate');
  expect(w.scope.caches.delete.mock.calls.map(([name]) => name).sort()).toEqual([...OWN].sort());
  expect([...w.names].sort()).toEqual([...FOREIGN].sort());
  expect(w.registration.unregister).toHaveBeenCalledOnce();
  expect(w.scope.clients.claim).not.toHaveBeenCalled();
  expect(w.scope.clients.matchAll).not.toHaveBeenCalled();
  expect(w.scope.clients.openWindow).not.toHaveBeenCalled();
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

test('cache cleanup and unregistering do not block each other, and activation never rejects', async () => {
  const brokenCaches = loadWorker({ caches: { keys: vi.fn().mockRejectedValue(new Error('storage')) } });
  await expect(brokenCaches.dispatch('activate')).resolves.toBe(1);
  expect(brokenCaches.registration.unregister).toHaveBeenCalledOnce();

  const brokenUnregister = loadWorker({ registration: { unregister: vi.fn().mockRejectedValue(new Error('gone')) } });
  await expect(brokenUnregister.dispatch('activate')).resolves.toBe(1);
  expect([...brokenUnregister.names].sort()).toEqual([...FOREIGN].sort());
});
