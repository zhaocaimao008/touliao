/*
 * 投聊 /sw.js —— 退役版 Service Worker（标记 touliao-sw-retired-20261012）
 *
 * 为什么要在线上留几个月：9a915ac2（2026-09-15）之前 Web 端把 /sw.js 注册在根作用域 '/'
 * （离线缓存 + fetch 拦截 + importScripts('/push-sw.js')），之后只注册 /push-sw.js（作用域
 * /push/<账号>/<会话>/<窗口>/，见 src/utils/pushScope.js）。老访客浏览器里的根注册不会自己
 * 消失，只会在回访导航时重新请求 /sw.js 做更新检查：拿到本文件 → 清缓存并注销自己；文件被删
 * → nginx 的 SPA 回落返回 index.html，更新失败，旧 worker 和它的缓存永远留着。
 *
 * 什么时候可以删：上线满 6 个月（不早于 2027-04），且 nginx 访问日志里 GET /sw.js 连续 30 天
 * 接近 0（新版页面从不请求它；排除 tests/robot_full_test.js、scripts/public-login-smoke.cjs
 * 的巡检请求）。删时一并去掉这两个脚本对 /sw.js 的检查、scripts/multi-window-browser-smoke.cjs
 * 的退役段、src/utils/legacyServiceWorker.test.js 和 vite.config.js 对 sw.js 的强制压缩。
 *
 * 行为：install 时 skipWaiting，立刻顶替旧 worker；activate 时删除本应用的缓存（touliao-*、
 * 改名前的 vxin-v*）并注销运行本脚本的注册。没有 fetch 监听（受控页面的请求全部直连网络），
 * 不 clients.claim()，不刷新、不导航任何页面。
 *
 * 不再 importScripts('/push-sw.js')：根注册上已没有有效订阅（9a915ac2 起只在 /push/... 上订阅，
 * 后端已删除无会话归属的旧订阅，见 backend-v2/src/db/schema.js；unregister() 也会让本注册的
 * 订阅失效）；push-sw.js 在根作用域下只能信任载荷里的 recipientId，没有会话/窗口隔离；退役
 * 脚本也应自包含，安装不依赖别的文件。万一注销前有推送落到这里，事件直接结束、不会抛错。
 *
 * 语法不超出旧版 sw.js 的要求（它已用 async/await、可选 catch 绑定），跑得动旧 worker 的浏览器
 * 都能装上本脚本；因此不用 Promise.allSettled 之类更新的 API。
 */
'use strict';

const RETIREMENT_MARKER = 'touliao-sw-retired-20261012';

// 历史缓存名（git log -p -- web/public/sw.js）：touliao-v2.0.19…v2.0.22、touliao-api-v1，
// 以及改名前的 vxin-v1、vxin-v2、vxin-v2.0.19。同源上的其他缓存一律不碰。
const OWN_CACHE_PREFIXES = ['touliao-', 'vxin-v'];

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(retire());
});

async function retire() {
  // 两件事互不依赖：删缓存失败也要注销，注销失败也要删缓存。
  const [deletedCaches, unregistered] = await Promise.all([
    deleteOwnCaches().catch((error) => `failed: ${error}`),
    unregisterOwnRegistration().catch((error) => `failed: ${error}`),
  ]);
  console.info('[sw]', RETIREMENT_MARKER, { deletedCaches, unregistered });
}

async function deleteOwnCaches() {
  const names = await caches.keys();
  const own = names.filter((name) => OWN_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)));
  await Promise.all(own.map((name) => caches.delete(name)));
  return own;
}

async function unregisterOwnRegistration() {
  // self.registration 是运行本脚本的注册。推送注册的作用域恒为 pushScope() 的 /push/...，
  // 不会是 '/'，所以不会落到这里。另加两道保险，确保绝不注销推送注册：
  // 1. 本文件只应作为 /sw.js 运行；若被 importScripts 进别的 worker，那是别人的注册。
  if (!/\/sw\.js$/.test(self.location.pathname)) return false;
  // 2. 同一注册上已有更新的 worker 在排队（新一版 /sw.js，或别的脚本注册到了同一作用域）：
  //    让它接管，不能连它一起注销。
  const registration = self.registration;
  if (registration.installing || registration.waiting) return false;
  return registration.unregister();
}
