/* 投聊 Service Worker — 离线缓存 + Web Push 推送处理 */
'use strict';

const CACHE_NAME     = 'touliao-v2.0.20';
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

// ── 激活：清理旧缓存版本 ─────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
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
    if (path === '/api/config') {
      e.respondWith(staleWhileRevalidate(request, 'touliao-api-v1', 300));
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
    if (request.mode === 'navigate') return caches.match('/index.html');
    return new Response('离线不可用', { status: 503 });
  }
}

/**
 * stale-while-revalidate：立即返回缓存（低延迟），后台异步刷新。
 * maxAge: 缓存有效期（秒）。超过 maxAge 时仍先返回旧值，但触发后台刷新。
 */
async function staleWhileRevalidate(request, cacheName, maxAge = 300) {
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
    doRevalidate();                      // 过期：后台刷新，本次仍用旧值
    return cached;
  }

  // 没缓存：同步拉取
  return doRevalidate() || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
}

// ── Push 推送 ────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  let payload = { title: '投聊新消息', body: '你有一条新消息' };
  if (e.data) {
    try { payload = e.data.json(); }
    catch { payload = { title: '投聊', body: e.data.text() }; }
  }

  const title   = payload.senderName || payload.title || '投聊新消息';
  const options = {
    body:      payload.body || '',
    icon:      '/icon.png',
    badge:     '/icon.png',
    tag:       `touliao-conv-${payload.conversationId || 'default'}`,
    renotify:  true,
    silent:    false,
    vibrate:   [200, 100, 200],
    timestamp: payload.timestamp ? payload.timestamp * 1000 : Date.now(),
    data: {
      conversationId: payload.conversationId || '',
      senderId:       payload.senderId       || '',
      url:            '/',
    },
    actions: [
      { action: 'reply',   title: '回复' },
      { action: 'dismiss', title: '忽略' },
    ],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── 通知点击：跳转到对应会话 ─────────────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  const { conversationId, url } = e.notification.data || {};

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin)) {
          w.focus();
          if (conversationId) {
            w.postMessage({ type: 'openConversation', conversationId });
          }
          return;
        }
      }
      return clients.openWindow(url || '/');
    })
  );
});

// ── 订阅过期自动续期 ─────────────────────────────────────────────
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    self.registration.pushManager
      .subscribe(e.oldSubscription.options)
      .then((sub) =>
        fetch('/api/notifications/web-subscribe', {
          method:      'POST',
          headers:     { 'Content-Type': 'application/json' },
          body:        JSON.stringify({ subscription: sub }),
          credentials: 'include',
        })
      )
  );
});
