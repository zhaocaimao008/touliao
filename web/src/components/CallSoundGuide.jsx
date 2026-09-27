import { clientStorage as localStorage } from '../utils/clientStorage';
import React, { useEffect, useState } from 'react';
import { prewarmAudio } from '../utils/callTones';
import { useI18n } from '../contexts/I18nContext';
import './PermissionGuide.css';

// v2 separates enabled from the old key, which also meant "not now".
const ENABLED_KEY = 'touliao_call_sound_enabled_v2';
const LATER_KEY = 'touliao_call_sound_later_v2';

export default function CallSoundGuide() {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(ENABLED_KEY) === '1' || sessionStorage.getItem(LATER_KEY) === '1'; }
    catch { return false; }
  });
  const nativeShell = !!(window.__ELECTRON_CONFIG__ || window.Capacitor?.isNativePlatform?.());

  // 浏览器每次加载都要一次用户手势才能出声：页面上任意点击/按键即自动激活并收起提示，
  // 不必专门点「开启」；已开启过的用户重新打开页面后同样需要这一步，否则来电无铃声。
  // 用 click 而非 pointerdown：横幅在按下瞬间消失会让列表上移，松手落到别的行，这次点击就丢了。
  useEffect(() => {
    if (nativeShell) return undefined;
    const unlock = () => { enable(); };
    const opts = { capture: true, once: true };
    document.addEventListener('click', unlock, opts);
    document.addEventListener('keydown', unlock, opts);
    return () => {
      document.removeEventListener('click', unlock, opts);
      document.removeEventListener('keydown', unlock, opts);
    };
  }, [nativeShell]);

  if (dismissed || nativeShell) return null;

  async function enable() {
    const ctx = prewarmAudio();
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') await ctx.resume();
      if (ctx.state !== 'running') return;
      try { localStorage.setItem(ENABLED_KEY, '1'); } catch { /* private storage */ }
      setDismissed(true);
    } catch { /* Keep the enable action available if audio could not start. */ }
  }
  const later = () => {
    try { sessionStorage.setItem(LATER_KEY, '1'); } catch { /* private storage */ }
    setDismissed(true);
  };
  return (
    <div className="permission-guide" role="status">
      <span>{t('callSound.text')}</span>
      <div className="permission-guide-actions">
        <button type="button" onClick={enable}>{t('callSound.enable')}</button>
        <button type="button" onClick={later}>{t('callSound.later')}</button>
      </div>
    </div>
  );
}
