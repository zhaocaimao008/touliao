/* 投聊 Service Worker — 离线缓存 + Web Push 推送处理 */
'use strict';

const CACHE_NAME     = 'touliao-v2.0.21';
// 本应用管理的所有缓存名前缀；激活时只清理此前缀的旧版本，
// 不误删 API 缓存（touliao-api-v1）或同源其他应用的缓存
const OWN_CACHE_PREFIX = 'touliao-';
const API_CACHE_NAME   = 'touliao-api-v1';
const STATIC_SHELL   = ['/', '/index.html', '/manifest.json', '/icon.png'];

// 资产指纹正则：Vite 产出的 hash 文件名，内容永不变 → cache-first
const IMMUTABLE_RE = /\/assets\/[^?#]+\.[a-z0-9]{8}\.(js|css|woff2?|png|webp|svg)($|\?)/i;

// ── 安装：预缓存应用外壳 ─────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_SHELL).catch((err) =>
        console.warn('[SW] 预缓存失败:', err.message)
      )
    )
  );
  self.skipWaiting(); // 立即激活，不等旧标签页关闭
});

// ── 激活：只清理本应用此前缀的旧版本缓存 ─────────────────────────
// 修复：之前是 keys.filter(k => k !== CACHE_NAME)，会误删 touliao-api-v1
// 和同源其他应用的缓存。现在只删 OWN_CACHE_PREFIX 开头、且不是当前版本的。
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(OWN_CACHE_PREFIX) && k !== CACHE_NAME && k !== API_CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch 策略 ───────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // 1. API：跳过（实时数据），仅 /api/config 做 stale-while-revalidate
  if (path.startsWith('/api/')) {
    if (request.headers.get('X-Touliao-Session') === 'isolated') return;
    if (path === '/api/config') {
      // 把 event 传进去，后台刷新时用 waitUntil 保活，避免被浏览器提前中断
      e.respondWith(staleWhileRevalidate(e, request, API_CACHE_NAME, 300));
    }
    return;
  }

  // 2. /uploads：跳过（鉴权后动态内容）
  if (path.startsWith('/uploads/')) return;

  // 3. hash 指纹静态资源：cache-first（永不过期）
  if (IMMUTABLE_RE.test(request.url)) {
    e.respondWith(cacheFirst(request));
    return;
  }

  // 4. 其他同源资源（index.html / sw.js / manifest 等）：network-first + 离线兜底
  e.respondWith(networkFirst(request));
});

// ── 策略实现 ─────────────────────────────────────────────────────

/** cache-first：命中则直接返回，miss 则网络获取后写缓存 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, resp.clone()).catch(() => {});
    }
    return resp;
  } catch {
    return new Response('offline', { status: 503 });
  }
}

/** network-first：先网络，失败降级缓存，再失败返回 index.html（SPA）*/
async function networkFirst(request) {
  try {
    const resp = await fetch(request);
    if (resp.ok && resp.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, resp.clone()).catch(() => {});
    }
    return resp;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      // 修复：caches.match 可能返回 undefined，直接返回会导致 respondWith 失败
      const shell = await caches.match('/index.html');
      if (shell) return shell;
    }
    return new Response('离线不可用', { status: 503 });
  }
}

/**
 * stale-while-revalidate：立即返回缓存（低延迟），后台异步刷新。
 * maxAge: 缓存有效期（秒）。超过 maxAge 时仍先返回旧值，但触发后台刷新。
 * event: 传入 fetch 事件，后台刷新时用 event.waitUntil 保活。
 */
async function staleWhileRevalidate(event, request, cacheName, maxAge = 300) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const doRevalidate = async () => {
    try {
      const fresh = await fetch(request);
      if (fresh.ok) await cache.put(request, fresh.clone());
      return fresh;
    } catch { return null; }
  };

  if (cached) {
    const date = cached.headers.get('date');
    const age  = date ? (Date.now() - new Date(date).getTime()) / 1000 : Infinity;
    if (age < maxAge) return cached;     // 够新：直接用
    // 过期：后台刷新，本次仍用旧值；用 waitUntil 保活避免被浏览器中断
    const bg = doRevalidate();
    if (event && typeof event.waitUntil === 'function') event.waitUntil(bg);
    return cached;
  }

  // 没缓存：同步拉取
  // 修复：doRevalidate() 返回 Promise 恒为真值，之前 || 右边的兜底永远不会执行，
  // 且失败时调用方会拿到 null。必须 await 后再兜底。
  return (await doRevalidate()) || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
}

// Legacy root subscriptions use the same account-aware click handling.
importScripts('/push-sw.js');
