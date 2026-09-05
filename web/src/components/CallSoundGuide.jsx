import React, { useState } from 'react';
import { prewarmAudio } from '../utils/callTones';
import { useI18n } from '../contexts/I18nContext';

const LS_KEY = 'touliao_call_sound_ready';

/**
 * 首次引导条「点击开启来电铃声」。
 * 浏览器 autoplay 策略下 AudioContext 需用户手势解锁——让用户主动点一次，
 * 之后来电铃声即可无手势播放（sticky activation 保持到会话结束）。
 * - Electron 桌面端：主进程已全局解锁 autoplay，无需引导
 * - 移动端（Capacitor）：有原生推送铃声，无需引导
 * - 已预热过（localStorage 标记）：不再打扰
 * 全局首次手势静默预热已由 callTones.installPrewarm 承担（CallModal 安装），本组件只做引导。
 */
export default function CallSoundGuide() {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
  });

  if (dismissed) return null;
  if (window.__ELECTRON_CONFIG__) return null;
  if (window.Capacitor && window.Capacitor.isNativePlatform()) return null;

  const enable = () => {
    prewarmAudio();
    try { localStorage.setItem(LS_KEY, '1'); } catch { /* 隐私模式忽略 */ }
    setDismissed(true);
  };

  const later = () => {
    try { localStorage.setItem(LS_KEY, '1'); } catch { /* 隐私模式忽略 */ }
    setDismissed(true);
  };

  const style = {
    position: 'fixed',
    // 顶栏（聊天页/列表页）固定高度 --header-h + 安全区，横幅需在其下方，
    // 否则移动端窄屏下会盖住聊天页返回键/联系人名（2026-09-04 UI 审计发现）。
    top: 'calc(var(--header-h, 54px) + env(safe-area-inset-top, 0px) + 8px)',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderRadius: 999,
    background: 'rgba(23,29,48,0.95)',
    color: '#fff',
    fontSize: 13,
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
  };

  return (
    <div style={style} role="status">
      <span>🔔 {t('callSound.text')}</span>
      <button
        onClick={enable}
        style={{
          border: 'none', borderRadius: 999, padding: '4px 14px',
          background: 'var(--color-primary)', color: '#fff', fontSize: 13, cursor: 'pointer',
        }}
      >
        {t('callSound.enable')}
      </button>
      <button
        onClick={later}
        style={{
          border: 'none', borderRadius: 999, padding: '4px 10px',
          background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 12, cursor: 'pointer',
        }}
      >
        {t('callSound.later')}
      </button>
    </div>
  );
}
