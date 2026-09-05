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
 *  - 用户点过「暂不」，或在系统框里明确点了「拒绝」（localStorage 标记）
 *
 * 注意「关掉系统框」与「拒绝」的区别：前者 requestPermission 返回 'default'，权限没变、
 * 以后还能再问，此时**不得**写 localStorage，否则用户随手关一个弹框就永久失去入口。
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
    // onEnable 内部第一件事就是 Notification.requestPermission()，前面不插任何 await——
    // 手势上下文必须完整传导过去，否则 Safari 判定手势已失效直接拒绝。
    const result = await onEnable?.();

    if (result === 'granted') {
      setDismissed(true);                       // 成功，收起（不必写 localStorage，permission 已变）
      return;
    }
    if (result === 'unsupported') {
      // 这个浏览器/外壳压根没有 Web Push（如 Firefox 关掉 dom.push.enabled：
      // Notification 存在但 PushManager 不存在）。再留着横幅就是个点不动的死按钮。
      try { localStorage.setItem(LS_KEY, '1'); } catch { /* 隐私模式忽略 */ }
      setDismissed(true);
      return;
    }
    if (result === 'denied') {
      // 用户在系统框里明确点了拒绝：浏览器此后永久不再弹框，问也没用 → 记下不再打扰
      try { localStorage.setItem(LS_KEY, '1'); } catch { /* 隐私模式忽略 */ }
      setDismissed(true);
      return;
    }
    // result === 'default'（用户直接关掉/按 Esc 略过了系统框，并没有拒绝），
    // 或 hook 的 effect 尚未就绪返回的兜底值。
    // 这两种情况都**不能**写 localStorage：一旦写了，用户只是随手关掉一个弹框，
    // 就永久失去了应用内唯一的开启入口，而权限其实还停在 default、本可以再问。
    // 保持横幅显示，让他可以再点一次。
  };

  const later = () => {
    try { localStorage.setItem(LS_KEY, '1'); } catch { /* 隐私模式忽略 */ }
    setDismissed(true);
  };

  // 定位：让开固定顶栏 + 安全区（避免盖住返回键/会话名），并且**必须错开
  // CallSoundGuide 一行**。两者对首次访问的网页用户是同时满足条件的（铃声引导没点过、
  // 通知权限还是 default），如果坐标完全相同，z-index 低的那个不是"叠在下面"，
  // 而是被整个盖住——看不见也点不到。故这里下移一整条横幅的高度（约 40px）。
  const style = {
    position: 'fixed',
    top: 'calc(var(--header-h, 54px) + env(safe-area-inset-top, 0px) + 8px + 44px)',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 9998,   // 与 CallSoundGuide(9999) 无重叠，这里只是保持一个确定的先后
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
          background: 'var(--color-primary)', color: '#fff', fontSize: 13, cursor: 'pointer',
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
