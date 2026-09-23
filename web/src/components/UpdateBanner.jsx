import TouliaoIcon from '../ui-kit/Icon';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useI18n } from '../contexts/I18nContext';

/**
 * Windows/桌面端更新条。
 * 监听 electron:update-* 事件，全程可见进度，支持手动检查。
 * 手动检查无更新、IPC 失败与安装启动均提供明确反馈。
 */
export default function UpdateBanner() {
  const { t } = useI18n();
  const [state, setState] = useState('idle'); // idle|checking|current|available|downloading|ready|installing|error
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [errMsg, setErrMsg] = useState('');
  const installRequested = useRef(false);

  useEffect(() => {
    if (!window.__ELECTRON_CONFIG__) return;

    const onChecking   = () => { setErrMsg(''); setState('checking'); };
    const onCurrent    = (e) => {
      setVersion(e.detail?.version || window.__ELECTRON_CONFIG__.appVersion || '');
      setState(current => current === 'checking' ? 'current' : current);
    };
    const onAvailable  = (e) => { setVersion(e.detail?.version || ''); setProgress(0); setErrMsg(''); setState('available'); };
    const onProgress   = (e) => { setProgress(e.detail ?? 0); setState('downloading'); };
    const onDownloaded = ()  => setState('ready');
    const onError      = (e) => { installRequested.current = false; setErrMsg(e.detail || t('update.updateFailed')); setState('error'); };

    window.addEventListener('electron:update-checking', onChecking);
    window.addEventListener('electron:update-not-available', onCurrent);
    window.addEventListener('electron:update-available',  onAvailable);
    window.addEventListener('electron:update-progress',   onProgress);
    window.addEventListener('electron:update-downloaded', onDownloaded);
    window.addEventListener('electron:update-error',      onError);
    return () => {
      window.removeEventListener('electron:update-checking', onChecking);
      window.removeEventListener('electron:update-not-available', onCurrent);
      window.removeEventListener('electron:update-available',  onAvailable);
      window.removeEventListener('electron:update-progress',   onProgress);
      window.removeEventListener('electron:update-downloaded', onDownloaded);
      window.removeEventListener('electron:update-error',      onError);
    };
  }, [t]);

  const handleCheck = useCallback(async () => {
    setState('checking');
    setErrMsg('');
    try {
      if (!window.electronAPI?.checkUpdate) throw new Error(t('update.bridgeUnavailable'));
      await window.electronAPI.checkUpdate();
    } catch (error) {
      setErrMsg(error.message || t('update.checkFailed'));
      setState('error');
    }
  }, [t]);

  const handleInstall = useCallback(async () => {
    if (installRequested.current) return;
    installRequested.current = true;
    setState('installing');
    setErrMsg('');
    try {
      if (!window.electronAPI?.installUpdate) throw new Error(t('update.bridgeUnavailable'));
      await window.electronAPI.installUpdate();
    } catch (error) {
      installRequested.current = false;
      setErrMsg(error.message || t('update.updateFailed'));
      setState('error');
    }
  }, [t]);

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
      ><TouliaoIcon name="refresh" size="sm" /></button>
    );
  }

  return (
    <div className="wc-update-banner" role="status" aria-live="polite">
      {state === 'current' && (
        <>
          <span className="wc-update-icon"><TouliaoIcon name="check" size="sm" /></span>
          <span className="wc-update-text">{t('update.noUpdateTemplate').replace('{version}', version)}</span>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
        </>
      )}
      {state === 'installing' && (
        <>
          <span className="wc-update-icon wc-spin"><TouliaoIcon name="refresh" size="sm" /></span>
          <span className="wc-update-text">{t('update.installing')}</span>
          <button className="wc-update-install-btn" disabled>{t('update.restartAndInstall')}</button>
        </>
      )}
      {state === 'checking' && (
        <>
          <span className="wc-update-icon wc-spin"><TouliaoIcon name="refresh" size="sm" /></span>
          <span className="wc-update-text">{t('update.checking')}</span>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
        </>
      )}
      {state === 'available' && (
        <>
          <span className="wc-update-icon"><TouliaoIcon name="download" size="sm" /></span>
          <span className="wc-update-text">{t('update.newVersionDownloadingTemplate').replace('{version}', version)}</span>
          <div className="wc-update-progress-wrap">
            <div className="wc-update-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
        </>
      )}
      {state === 'downloading' && (
        <>
          <span className="wc-update-icon"><TouliaoIcon name="download" size="sm" /></span>
          <span className="wc-update-text">{t('update.downloadingTemplate').replace('{percent}', Math.round(progress))}</span>
          <div className="wc-update-progress-wrap">
            <div className="wc-update-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('update.downloadInBackground')}><TouliaoIcon name="close" size="sm" /></button>
        </>
      )}
      {state === 'ready' && (
        <>
          <span className="wc-update-icon"><TouliaoIcon name="check" size="sm" /></span>
          <span className="wc-update-text">{t('update.readyToInstall')}</span>
          <button className="wc-update-install-btn" onClick={handleInstall}>{t('update.restartAndInstall')}</button>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('update.later')}>{t('update.later')}</button>
        </>
      )}
      {state === 'error' && (
        <>
          <span className="wc-update-icon"><TouliaoIcon name="warning" size="sm" tone="danger" /></span>
          <span className="wc-update-text">{errMsg || t('update.checkFailed')}</span>
          <button className="wc-update-install-btn" onClick={handleCheck}>{t('common.retry')}</button>
          <button className="wc-update-dismiss" onClick={handleDismiss} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
        </>
      )}
    </div>
  );
}
