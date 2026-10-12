/*
 * 投聊 /sw.js —— 退役版 Service Worker（标记 touliao-sw-retired-20261012）
 *
 * 为什么要在线上留几个月：9a915ac2（2026-09-15）之前 Web 端把 /sw.js 注册在根作用域 '/'
 * （离线缓存 + fetch 拦截 + importScripts('/push-sw.js')），之后只注册 /push-sw.js（作用域
 * /push/<账号>/<会话>/<窗口>/，见 src/utils/pushScope.js）。老访客浏览器里的根注册不会自己
 * 消失，只会在回访导航时重新请求 /sw.js 做更新检查：拿到本文件 → 清缓存并注销自己；拿不到
 * （404，或被 SPA 回落成 index.html）→ 更新失败，旧 worker 和它的缓存一直留着。
 *
 * 什么时候可以删（不删也无害：文件很小，新版页面从不请求它）。两条都满足才删：
 * 1. 上线满 6 个月（不早于 2027-04）；
 * 2. /var/log/nginx/touliao-sw.log（deploy/nginx/touliao-cc.conf 的 location = /sw.js，记录
 *    Service-Worker 请求头）里没有来自服务器本机以外的 sw=script 请求。浏览器取 SW 脚本时才带
 *    这个头，巡检脚本和爬虫不带。logrotate 只留 14 天，所以相隔至少 16 天各查一次、两次都为 0：
 *      zcat -f /var/log/nginx/touliao-sw.log* | grep 'sw=script' | grep -v '^<服务器本机 IP> '
 * 删的步骤：仓库里删掉本文件；deploy.yml 的 rsync 不带 --delete，所以还要手工删
 * /var/www/touliao-web/sw.js 和 sw.js.gz（不删线上就一直发本文件，同样无害）；一并去掉
 * tests/robot_full_test.js、scripts/public-login-smoke.cjs 对 /sw.js 的检查，
 * scripts/multi-window-browser-smoke.cjs 的退役段，src/utils/legacyServiceWorker.test.js，
 * vite.config.js 对 sw.js 的强制压缩，package.json lint 里的 public/sw.js，nginx 的
 * location = /sw.js。删之前服务器重建/灾难恢复照常从仓库发布 dist/，本文件会随之发布。
 *
 * 行为：install 时 skipWaiting，立刻顶替旧 worker；activate 时先删历史缓存，删完再注销运行本
 * 脚本的注册（顺序不能反，见 retire()）。没有 fetch 监听（受控页面的请求全部直连网络），不
 * clients.claim()，不刷新、不导航任何页面。
 *
 * 只删 LEGACY_CACHE 匹配的历史缓存名。本文件还在线上时，新代码不要再用 touliao-v2.0.x、
 * touliao-api-v1、vxin-v<数字> 这几类缓存名，否则老浏览器退役时会把它们一起删掉。
 *
 * 不再 importScripts('/push-sw.js')：根注册上已没有有效订阅（9a915ac2 起只在 /push/... 上订阅，
 * 后端已删除无会话归属的旧订阅，见 backend-v2/src/db/schema.js；unregister() 也会让本注册的
 * 订阅失效）；push-sw.js 在根作用域下只能信任载荷里的 recipientId，没有会话/窗口隔离；退役
 * 脚本也应自包含，安装不依赖别的文件。万一注销前有推送落到这里，事件直接结束、不会抛错。
 * 只留一个最小的 notificationclick：根注册以前弹出的通知可能还在系统通知中心，而有页面受控时
 * 注册会在注销后多留一阵，这期间点通知要有反应。它不读通知里的数据，只聚焦已打开的窗口或打开首页。
 *
 * 语法不超出旧版 sw.js（async/await、可选 catch 绑定，即 ES2019），跑得动旧 worker 的浏览器
 * 都能装上本脚本；npm run lint 按 ecmaVersion 2019 检查本文件（见 eslint.config.js）。
 */
'use strict';

const RETIREMENT_MARKER = 'touliao-sw-retired-20261012';

// 历史上 /sw.js 建过的全部缓存（git log -p -- web/public/sw.js）：touliao-v2.0.19…v2.0.22、
// touliao-api-v1，以及改名前的 vxin-v1、vxin-v2、vxin-v2.0.19。同源上的其他缓存一律不碰。
const LEGACY_CACHE = /^(?:touliao-v2\.0\.\d+|touliao-api-v1|vxin-v\d+(?:\.\d+)*)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(retire());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(focusOrOpenApp());
});

async function retire() {
  // 先删完缓存再注销，不能并行：没有受控页面时，unregister() 会立刻清除注册并终止本 worker
  // （规范的 Clear Registration，Safari/WebKit 就是这么做的），并行中的删缓存会被打断；注册
  // 没了，以后也不会再有 worker 来补删。两步的失败各自吞掉：删缓存失败照样注销。
  const deletedCaches = await deleteLegacyCaches().catch((error) => `failed: ${error}`);
  console.info('[sw]', RETIREMENT_MARKER, { deletedCaches });
  await unregisterOwnRegistration().catch((error) => console.warn('[sw] unregister failed', error));
}

async function deleteLegacyCaches() {
  const names = await caches.keys();
  const legacy = names.filter((name) => LEGACY_CACHE.test(name));
  await Promise.all(legacy.map((name) => caches.delete(name)));
  return legacy;
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

async function focusOrOpenApp() {
  const [existing] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (existing) return existing.focus();
  return self.clients.openWindow('/');
}
