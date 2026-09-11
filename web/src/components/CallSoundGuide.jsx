import React, { useState } from 'react';
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
  if (dismissed || window.__ELECTRON_CONFIG__ || window.Capacitor?.isNativePlatform?.()) return null;

  const enable = async () => {
    const ctx = prewarmAudio();
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') await ctx.resume();
      if (ctx.state !== 'running') return;
      try { localStorage.setItem(ENABLED_KEY, '1'); } catch { /* private storage */ }
      setDismissed(true);
    } catch { /* Keep the enable action available if audio could not start. */ }
  };
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
