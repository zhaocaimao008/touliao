import { useEffect, useRef } from 'react';
import axios from 'axios';

// URL-safe Base64 → Uint8Array（VAPID 公钥转换）
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function usePushNotification(user) {
  const subscriptionRef = useRef(null);

  useEffect(() => {
    if (!user) return;

    // 原生 App（Capacitor / Android·iOS）：走 FCM/APNs 设备令牌，而非 Web Push
    if (window.Capacitor?.isNativePlatform?.()) {
      // 用 cancelled 标志 + listeners 数组：注册是异步的，若组件在权限弹窗/注册
      // 完成前就卸载，同步 cleanup 拿不到 listener 句柄会漏；标志确保 async 恢复后补移除。
      let cancelled = false;
      let listeners = [];
      (async () => {
        try {
          const { PushNotifications } = await import('@capacitor/push-notifications');
          let perm = await PushNotifications.checkPermissions();
          if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
            perm = await PushNotifications.requestPermissions();
          }
          if (perm.receive !== 'granted' || cancelled) return;
          const regL = await PushNotifications.addListener('registration', (token) => {
            const platform = window.Capacitor.getPlatform?.() === 'ios' ? 'ios' : 'android';
            axios.post('/api/notifications/device-token', { token: token.value, platform }).catch(() => {});
          });
          const errL = await PushNotifications.addListener('registrationError', () => {});
          // 点击推送 → 跳转到对应会话
          const actL = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            const cid = action?.notification?.data?.conversationId;
            if (cid) window.dispatchEvent(new CustomEvent('vxin:open-conversation', { detail: { conversationId: cid } }));
          });
          listeners = [regL, errL, actL];
          // await 期间可能已卸载：立即移除已注册的 listener，不再 register
          if (cancelled) { listeners.forEach(l => l.remove?.()); listeners = []; return; }
          await PushNotifications.register();
        } catch { /* 插件不可用时静默 */ }
      })();
      return () => { cancelled = true; listeners.forEach(l => l.remove?.()); listeners = []; };
    }

    // Electron 桌面端用原生通知（window.electron.showNotification），
    // 且 file:// 下无法注册 Service Worker，直接跳过 web-push。
    if (window.__ELECTRON_CONFIG__) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    let cancelled = false;

    async function setup() {
      try {
        // 1. 拉取 VAPID 公钥
        const { data } = await axios.get('/api/notifications/vapid-public-key');
        if (cancelled || !data.publicKey) return;

        // 2. 注册 Service Worker
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        if (cancelled) return;

        // 3. 请求通知权限
        const permission = await Notification.requestPermission();
        if (permission !== 'granted' || cancelled) return;

        // 4. 订阅 Push（幂等：已订阅直接返回现有订阅）
        const existing = await reg.pushManager.getSubscription();
        const sub = existing || await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.publicKey),
        });

        subscriptionRef.current = sub;

        // 5. 保存订阅到后端
        await axios.post('/api/notifications/web-subscribe', { subscription: sub.toJSON() });

        // 6. 监听 Service Worker 消息（通知点击跳转到会话）
        navigator.serviceWorker.addEventListener('message', handleSWMessage);
      } catch {
        // 用户拒绝权限或浏览器不支持，静默失败
      }
    }

    function handleSWMessage(event) {
      if (event.data?.type === 'OPEN_CONVERSATION') {
        window.dispatchEvent(new CustomEvent('vxin:open-conversation', {
          detail: { conversationId: event.data.conversationId },
        }));
      }
    }

    setup();

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
    };
  }, [user?.id]);

  // 登出时取消订阅
  async function unsubscribe() {
    try {
      const sub = subscriptionRef.current;
      if (sub) {
        await axios.delete('/api/notifications/web-subscribe', {
          data: { endpoint: sub.endpoint },
        });
        await sub.unsubscribe();
        subscriptionRef.current = null;
      }
    } catch { /* unsubscribe failed; ref already cleared */ }
  }

  return { unsubscribe };
}
