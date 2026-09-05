import { useCallback, useEffect, useRef, useState } from 'react';
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
  // 订阅所需的两样东西在「自动阶段」就备好，等用户真手势时立刻可用，不必再等网络
  const vapidKeyRef = useRef(null);
  const regRef = useRef(null);
  const enablePushRef = useRef(null);
  // 'unsupported' | 'default' | 'granted' | 'denied'，驱动 PushPermissionGuide 是否出现
  const [permission, setPermission] = useState(
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  );

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
            // Capacitor's iOS registration callback returns the raw APNs device
            // token, not an FCM registration token. Keep the platform explicit
            // so the backend uses its direct APNs provider path.
            const platform = window.Capacitor.getPlatform?.() === 'ios' ? 'ios_apns' : 'android';
            axios.post('/api/notifications/device-token', { token: token.value, platform }).catch(() => {});
          });
          const errL = await PushNotifications.addListener('registrationError', () => {});
          // 点击推送 → 跳转到对应会话
          const actL = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            const cid = action?.notification?.data?.conversationId;
            if (cid) window.dispatchEvent(new CustomEvent('touliao:open-conversation', { detail: { conversationId: cid } }));
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
    // setup 的完成信号：用户可能在 SW 注册/公钥拉取还没跑完时就点了「开启」，
    // enablePush 先 await 它，避免出现「权限已授予但订阅没建成」的哑火状态。
    let readyPromise = null;

    // 自动阶段：只做「不需要权限」的准备工作——拉 VAPID 公钥、注册 SW、挂 SW 消息监听。
    // 【绝不在这里调 Notification.requestPermission()】此前是登录后立刻弹系统权限框，
    // 既没有用户手势也没有前置说明，两个后果都是真实损失：
    //   1) Chrome 等浏览器里用户反射性点「拒绝」，而一旦拒绝页面就永久无法再申请，
    //      这个用户的 Web 推送就此彻底失效，产品侧无任何补救入口；
    //   2) Safari / iOS PWA 要求 requestPermission() 必须由用户手势触发，无手势直接被拒，
    //      也就是说 iOS Safari 上的 Web 推送从来就没生效过。
    // 现在改为：权限申请由 PushPermissionGuide 的「开启」按钮（真实手势）调 enablePush()。
    // 已授权过的老用户仍在此自动续订，不需要再点一次。
    async function setup() {
      try {
        // 1. 拉取 VAPID 公钥
        const { data } = await axios.get('/api/notifications/vapid-public-key');
        if (cancelled || !data.publicKey) return;
        vapidKeyRef.current = data.publicKey;

        // 2. 注册 Service Worker（不需要通知权限，离线缓存等能力也依赖它）
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        if (cancelled) return;
        regRef.current = reg;

        // 3. 监听 Service Worker 消息（通知点击跳转到会话）
        navigator.serviceWorker.addEventListener('message', handleSWMessage);

        // 4. 已授权 → 直接续订，无需再打扰用户
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          await subscribeNow();
        }
      } catch {
        // 浏览器不支持或网络失败，静默降级（应用其余部分不受影响）
      }
    }

    // 订阅并上报（幂等：已订阅直接复用现有订阅）。调用前必须已经是 granted。
    async function subscribeNow() {
      const reg = regRef.current || await navigator.serviceWorker.ready;
      const publicKey = vapidKeyRef.current;
      if (!reg || !publicKey) return;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      subscriptionRef.current = sub;
      await axios.post('/api/notifications/web-subscribe', { subscription: sub.toJSON() });
    }

    // 暴露给引导条：必须在用户点击的同步调用栈里触发，Safari 才认这个手势
    enablePushRef.current = async () => {
      if (typeof Notification === 'undefined') return 'unsupported';
      // requestPermission 必须是点击后第一个 await，前面不能插任何 await，
      // 否则手势上下文丢失，Safari 会直接拒绝。
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return result;
      try {
        await readyPromise;          // 公钥/SW 可能还在路上，等它落定再订阅
        await subscribeNow();
      } catch { /* 订阅失败不回滚权限，下次进入应用会自动续订 */ }
      return result;
    };

    function handleSWMessage(event) {
      if (event.data?.type === 'OPEN_CONVERSATION') {
        window.dispatchEvent(new CustomEvent('touliao:open-conversation', {
          detail: { conversationId: event.data.conversationId },
        }));
      }
    }

    readyPromise = setup();

    return () => {
      cancelled = true;
      enablePushRef.current = null;
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
    };
    // 仅用 user 做登录态判空：user 变化（登录/登出/切换账号）时重新建立推送订阅
  }, [user]);

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

  // 稳定引用：供引导条的 onClick 直接调用。
  // ref 为空有两种情况，必须区分开，否则引导条会变成一个永远点不动的死按钮：
  //   · 环境根本不支持（Electron / 原生壳 / 无 serviceWorker 或 PushManager，
  //     如 Firefox 关掉 dom.push.enabled）——effect 在赋值前就 return 了，
  //     再点多少次也不会有反应 → 返回 'unsupported'，引导条据此收起。
  //   · effect 还没跑完（极短暂）——返回 'default'，横幅留着让用户再点一次。
  const enablePush = useCallback(async () => {
    const fn = enablePushRef.current;
    if (fn) return fn();
    const supported = typeof navigator !== 'undefined'
      && 'serviceWorker' in navigator && typeof PushManager !== 'undefined'
      && !window.__ELECTRON_CONFIG__ && !window.Capacitor?.isNativePlatform?.();
    return supported ? 'default' : 'unsupported';
  }, []);

  return { unsubscribe, permission, enablePush };
}
