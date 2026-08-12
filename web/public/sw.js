/* V信 Service Worker — 离线缓存 + Web Push 推送处理 */
const CACHE_NAME = 'vxin-v2.0.19';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png',
];

// ── 安装：预缓存核心资源 ────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_URLS).catch((err) => {
        console.warn('[SW] 预缓存失败:', err.message);
      });
    })
  );
  // 立即激活新 SW，不等待旧标签页关闭
  self.skipWaiting();
});

// ── 激活：清理旧缓存 ────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] 删除旧缓存:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  // 立即接管所有页面
  return self.clients.claim();
});

// ── Fetch：网络优先，失败则降级到缓存（离线可用）──────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // 只处理同源请求，跳过 API 调用（需要实时数据）
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/uploads/')) return;

  e.respondWith(
    fetch(request)
      .then((response) => {
        // 成功：更新缓存并返回
        if (response && response.status === 200 && request.method === 'GET') {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, cloned).catch(() => {});
          });
        }
        return response;
      })
      .catch(() => {
        // 网络失败：尝试从缓存读取
        return caches.match(request).then((cached) => {
          if (cached) {
            console.log('[SW] 离线缓存命中:', url.pathname);
            return cached;
          }
          // 缓存也没有：返回离线页面或 404
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('离线不可用', { status: 503 });
        });
      })
  );
});

// ── Push 事件：收到推送消息 ──────────────────────────────────────
self.addEventListener('push', (e) => {
  let payload = { title: 'V信新消息', body: '你有一条新消息' };

  if (e.data) {
    try {
      payload = e.data.json();
    } catch {
      payload = { title: 'V信', body: e.data.text() };
    }
  }

  const title = payload.senderName || payload.title || 'V信新消息';
  const options = {
    body: payload.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: `vxin-conv-${payload.conversationId || 'default'}`,
    renotify: true,
    silent: false,
    vibrate: [200, 100, 200],
    timestamp: payload.timestamp ? payload.timestamp * 1000 : Date.now(),
    data: {
      conversationId: payload.conversationId || '',
      senderId: payload.senderId || '',
      url: '/',
    },
    actions: [
      { action: 'reply', title: '回复' },
      { action: 'dismiss', title: '忽略' },
    ],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── notificationclick：点击通知跳转到对应会话 ────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  if (e.action === 'dismiss') return;

  const { conversationId, url } = e.notification.data || {};
  const targetUrl = url || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 已有打开的标签页：聚焦并传递会话ID
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          if (conversationId) {
            client.postMessage({ type: 'openConversation', conversationId });
          }
          return;
        }
      }
      // 没有打开的标签页：打开新窗口
      return clients.openWindow(targetUrl);
    })
  );
});

      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          if (conversationId) {
            client.postMessage({ type: 'OPEN_CONVERSATION', conversationId });
          }
          return;
        }
      }
      // 没有标签页：打开新窗口
      return clients.openWindow(targetUrl);
    })
  );
});

// ── pushsubscriptionchange：订阅过期自动续期 ────────────────────
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    self.registration.pushManager.subscribe(e.oldSubscription.options).then((sub) => {
      return fetch('/api/notifications/web-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub }),
        credentials: 'include',
      });
    })
  );
});
