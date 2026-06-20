import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import axios from 'axios';

/**
 * Capacitor Push Notifications
 * - Android: FCM token 注册
 * - iOS: APNs token 注册
 * - 失败静默降级（不崩溃）
 */
export function usePushNotification() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let mounted = true;

    async function register() {
      try {
        // 1. 检查/申请权限
        const permResult = await PushNotifications.checkPermissions();
        let finalStatus = permResult.receive;

        if (finalStatus === 'prompt' || finalStatus === 'prompt-with-rationale') {
          const reqResult = await PushNotifications.requestPermissions();
          finalStatus = reqResult.receive;
        }

        if (finalStatus !== 'granted') return;

        // 2. 注册设备（生成 FCM/APNs token）
        await PushNotifications.register();
      } catch (e) {
        console.warn('[push] 初始化失败（静默降级）:', e?.message);
      }
    }

    // 3. Token 获取成功 → 上报后端
    const onToken = PushNotifications.addListener('registration', async (token) => {
      if (!mounted) return;
      try {
        await axios.post('/api/notifications/device-token', {
          token: token.value,
          platform: Capacitor.getPlatform(),
        });
      } catch (e) {
        console.warn('[push] token 上报失败:', e?.message);
      }
    });

    // 4. Token 获取失败（静默，不影响主流程）
    const onError = PushNotifications.addListener('registrationError', (err) => {
      console.warn('[push] 注册 token 失败:', err?.error);
    });

    // 5. App 在前台时收到通知 → 不显示系统通知（App 内已有消息气泡）
    const onReceived = PushNotifications.addListener('pushNotificationReceived', (notification) => {
      // 前台收到推送：触发 App 内 badge 更新
      window.dispatchEvent(new CustomEvent('push:received', { detail: notification }));
    });

    // 6. 用户点击通知 → 跳转到对应会话
    const onAction = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification?.data || {};
      if (data.conversationId) {
        window.dispatchEvent(new CustomEvent('push:open-conversation', {
          detail: { conversationId: data.conversationId },
        }));
      }
    });

    register();

    return () => {
      mounted = false;
      Promise.allSettled([onToken, onError, onReceived, onAction])
        .then((results) => results.forEach((r) => r.value?.remove?.()));
    };
  }, []);

  function unregister() {
    if (!Capacitor.isNativePlatform()) return;
    PushNotifications.unregister().catch(() => {});
  }

  return { unregister };
}
