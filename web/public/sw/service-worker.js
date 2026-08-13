// ── 投聊 服务工作线程 ──────────────────────────────────────────
// PWA 离线回退 + 推送通知处理
// Capacitor 移动端使用原生推送，此 SW 仅用于 Web 端推送

const CACHE_NAME = 'touliao-cache-v2';

// 安装阶段：预缓存关键资源（由 Vite 构建后填充）
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 激活阶段：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

// ── 网络优先策略 ──────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // 只处理同源 GET 请求
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.origin.startsWith(self.location.origin)) return;

  // API 请求不缓存
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // 缓存成功的响应
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
        return res;
      })
      .catch(() => {
        // 离线时从缓存返回
        return caches.match(event.request).then((cached) => {
          return cached || new Response('离线', { status: 503 });
        });
      })
  );
});

// ── 推送通知 ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const options = {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'default',
      data: data.data || {},
      vibrate: [200, 100, 200],
      requireInteraction: true,
      actions: data.actions || [],
    };
    event.waitUntil(
      self.registration.showNotification(data.title || '投聊', options)
    );
  } catch (e) {
    console.warn('[SW] 推送解析失败:', e);
  }
});

// 点击通知 → 聚焦窗口 / 打开页面
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const focused = windowClients.find(c => c.focused);
      if (focused) {
        focused.focus();
        focused.navigate(targetUrl);
      } else if (windowClients.length) {
        windowClients[0].focus();
        windowClients[0].navigate(targetUrl);
      } else {
        clients.openWindow(targetUrl);
      }
    })
  );
});
