import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../contexts/I18nContext';

/**
 * Windows/桌面端更新条。
 * 监听 electron:update-* 事件，全程可见进度，支持手动检查。
 * 无更新时不渲染任何内容。
 */
export default function UpdateBanner() {
  const { t } = useI18n();
  const [state, setState] = useState('idle'); // idle|checking|available|downloading|ready|error
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (!window.__ELECTRON_CONFIG__) return;

    const onAvailable  = (e) => { setVersion(e.detail?.version || ''); setState('available'); };
    const onProgress   = (e) => { setProgress(e.detail ?? 0); setState('downloading'); };
    const onDownloaded = ()  => setState('ready');
    const onError      = (e) => { setErrMsg(e.detail || t('update.updateFailed')); setState('error'); };

    window.addEventListener('electron:update-available',  onAvailable);
    window.addEventListener('electron:update-progress',   onProgress);
    window.addEventListener('electron:update-downloaded', onDownloaded);
    window.addEventListener('electron:update-error',      onError);
    return () => {
      window.removeEventListener('electron:update-available',  onAvailable);
      window.removeEventListener('electron:update-progress',   onProgress);
      window.removeEventListener('electron:update-downloaded', onDownloaded);
      window.removeEventListener('electron:update-error',      onError);
    };
  }, [t]);

  const handleCheck = useCallback(() => {
    setState('checking');
    setErrMsg('');
    window.electronAPI?.checkUpdate?.().catch(() => {});
  }, []);

  const handleInstall = useCallback(() => {
    window.electronAPI?.installUpdate?.();
  }, []);

  const handleDismiss = useCallback(() => setState('idle'), []);

  if (!window.__ELECTRON_CONFIG__) return null;

  // 「检查更新」按钮（无活跃更新时常驻）
  if (state === 'idle') {
    return (
      <button
        className="wc-update-check-btn"
        onClick={handleCheck}
        title={t('update.checkForUpdates')}
        aria-label={t('update.checkForUpdates')}
      >↑</button>
    );
  }

  return (
    <div className="wc-update-banner" role="status" aria-live="polite">
      {state === 'checking' && (
        <>
          <span className="wc-update-icon wc-spin">↻</span>
          <span className="wc-update-text">{t('update.checking')}</span>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('common.close')}>✕</button>
        </>
      )}
      {state === 'available' && (
        <>
          <span className="wc-update-icon">🎉</span>
          <span className="wc-update-text">{t('update.newVersionDownloadingTemplate').replace('{version}', version)}</span>
          <div className="wc-update-progress-wrap">
            <div className="wc-update-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('common.close')}>✕</button>
        </>
      )}
      {state === 'downloading' && (
        <>
          <span className="wc-update-icon">⬇</span>
          <span className="wc-update-text">{t('update.downloadingTemplate').replace('{percent}', Math.round(progress))}</span>
          <div className="wc-update-progress-wrap">
            <div className="wc-update-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('update.downloadInBackground')}>✕</button>
        </>
      )}
      {state === 'ready' && (
        <>
          <span className="wc-update-icon">✅</span>
          <span className="wc-update-text">{t('update.readyToInstall')}</span>
          <button className="wc-update-install-btn" onClick={handleInstall}>{t('update.restartAndInstall')}</button>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('update.later')}>{t('update.later')}</button>
        </>
      )}
      {state === 'error' && (
        <>
          <span className="wc-update-icon">⚠️</span>
          <span className="wc-update-text">{errMsg || t('update.checkFailed')}</span>
          <button className="wc-update-install-btn" onClick={handleCheck}>{t('common.retry')}</button>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('common.close')}>✕</button>
        </>
      )}
    </div>
  );
}
