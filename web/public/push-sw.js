/* global self, clients */
// Dedicated account/session/window registrations isolate browser PushManagers.
function pushTarget(payload = {}) {
  const parts = new URL(self.registration.scope).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const scoped = parts[0] === 'push' && parts.length === 4;
  return { recipientId: scoped ? parts[1] : payload.recipientId,
    sessionId: scoped ? parts[2] : '', windowId: scoped ? parts[3] : '' };
}

self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  const target = pushTarget(payload);
  if (!payload || !target.recipientId || payload.recipientId !== target.recipientId) return;
  event.waitUntil(self.registration.showNotification(payload.senderName || payload.title || '投聊新消息', {
    body: payload.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: `touliao-${target.recipientId}-${payload.conversationId || 'default'}`,
    renotify: true, silent: !!payload.silent,
    data: { ...target, conversationId: payload.conversationId || '' },
  }));
});

function offerToWindow(client, target) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = accepted => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(accepted);
    };
    const timeout = setTimeout(() => finish(false), 700);
    channel.port1.onmessage = event => finish(event.data === true);
    try { client.postMessage({ type: 'OPEN_CONVERSATION', ...target }, [channel.port2]); }
    catch { channel.port2.close(); finish(false); }
  });
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const target = event.notification.data || {};
  if (!target.recipientId) return;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if (await offerToWindow(client, target)) { await client.focus(); return; }
    }
    // A closed isolated window has no surviving token; reopen it through normal login.
    const url = new URL('/', self.location.origin);
    const windowId = /^[a-f0-9-]{36}$/.test(target.windowId || '') ? target.windowId : crypto.randomUUID();
    url.searchParams.set('accountWindow', windowId);
    url.searchParams.set('pushAccount', target.recipientId);
    if (target.conversationId) url.searchParams.set('conversationId', target.conversationId);
    await clients.openWindow(url.href);
  })());
});

self.addEventListener('pushsubscriptionchange', event => {
  // The worker has no account credential. Each live page renews under its own session.
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const target = pushTarget();
    for (const client of windows) client.postMessage({ type: 'PUSH_RESUBSCRIBE', ...target });
  }));
});
