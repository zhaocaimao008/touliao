/* V信 Service Worker — Web Push 推送处理 */
const CACHE_NAME = 'vxin-v2';

// ── 安装 ─────────────────────────────────────────────────────────
self.addEventListener('install', () => {
  // 不调用 skipWaiting —— 等待下次页面加载再激活，避免中途接管导致白屏
});

self.addEventListener('activate', () => {
  // 不调用 clients.claim —— 同样避免中途接管
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
