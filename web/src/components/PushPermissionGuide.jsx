import React, { useState } from 'react';
import { useI18n } from '../contexts/I18nContext';

const LS_KEY = 'touliao_push_guide_dismissed';

/**
 * 应用内「开启消息通知」软引导条。
 *
 * 为什么必须有这一层，而不能像以前那样登录后直接调 Notification.requestPermission()：
 *  - Chrome 等浏览器里，没有上下文的系统权限框会被用户反射性拒绝，而**一旦拒绝，
 *    页面永久无法再次申请**——那个用户的 Web 推送就此彻底失效，产品侧毫无补救入口。
 *  - Safari / iOS PWA 要求 requestPermission() 必须由用户手势触发，无手势直接被拒绝，
 *    也就是说 iOS Safari 上的 Web 推送此前从来没有生效过。
 * 所以这里先用应用内横幅说明价值，用户点「开启」（真实手势）时才去调系统 API。
 *
 * 不出现的情况：
 *  - Electron 桌面端（走原生通知）/ 移动原生端（走 FCM·APNs 设备令牌）
 *  - 浏览器不支持 Notification
 *  - 已授权（granted）：无需再问；已拒绝（denied）：问也没用，不骚扰
 *  - 用户点过「暂不」（localStorage 标记）
 */
export default function PushPermissionGuide({ permission, onEnable }) {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
  });

  if (dismissed) return null;
  if (window.__ELECTRON_CONFIG__) return null;
  if (window.Capacitor?.isNativePlatform?.()) return null;
  // 只在「从没问过」时出现：granted 不必问，denied 问了也无效，unsupported 没得问
  if (permission !== 'default') return null;

  const enable = async () => {
    // 不 await 就先收起：requestPermission 必须直接挂在这次点击上，
    // 中间不能插入会让出主线程的操作，否则 Safari 判定手势已失效。
    const result = await onEnable?.();
    // 用户在系统框里点了拒绝 → 不再重复打扰
    if (result !== 'granted') {
      try { localStorage.setItem(LS_KEY, '1'); } catch { /* 隐私模式忽略 */ }
    }
    setDismissed(true);
  };

  const later = () => {
    try { localStorage.setItem(LS_KEY, '1'); } catch { /* 隐私模式忽略 */ }
    setDismissed(true);
  };

  // 定位与 CallSoundGuide 一致：让开固定顶栏 + 安全区，避免盖住返回键/会话名
  const style = {
    position: 'fixed',
    top: 'calc(var(--header-h, 54px) + env(safe-area-inset-top, 0px) + 8px)',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 9998,   // 比 CallSoundGuide(9999) 低一层，两条同时出现时来电引导在上
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderRadius: 999,
    background: 'rgba(23,29,48,0.95)',
    color: '#fff',
    fontSize: 13,
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    maxWidth: 'calc(100vw - 24px)',
  };

  return (
    <div style={style} role="status">
      <span>🔔 {t('pushGuide.text')}</span>
      <button
        onClick={enable}
        style={{
          border: 'none', borderRadius: 999, padding: '4px 14px',
          background: '#07C160', color: '#fff', fontSize: 13, cursor: 'pointer',
        }}
      >
        {t('pushGuide.enable')}
      </button>
      <button
        onClick={later}
        style={{
          border: 'none', borderRadius: 999, padding: '4px 10px',
          background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 12, cursor: 'pointer',
        }}
      >
        {t('pushGuide.later')}
      </button>
    </div>
  );
}
