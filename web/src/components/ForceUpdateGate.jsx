import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useI18n } from '../contexts/I18nContext';
import { PrimaryButton } from '../ui-kit/Button';

// 按数字逐段比较 x.y.z；a < b 返回 true
export function versionLess(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return false;
}

// 桌面端：当前版本低于后台最低版本（GET /api/config → minVersion.desktop）时强制升级。拉取失败不强制。
export function useDesktopForceUpdate() {
  const [required, setRequired] = useState(false);
  useEffect(() => {
    const current = window.__ELECTRON_CONFIG__?.appVersion;
    if (!current) return;
    let alive = true;
    axios.get('/api/config').then(res => {
      const minimum = res.data?.minVersion?.desktop;
      if (alive && minimum && versionLess(current, minimum)) setRequired(true);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return required;
}

// 替换整个主界面、不可关闭；下载进度与「重启安装」由常驻的 UpdateBanner 展示。
export function ForceUpdateScreen() {
  const { t } = useI18n();
  const check = () => window.electronAPI?.checkUpdate?.().catch(() => {});
  useEffect(() => { check(); }, []);
  return (
    <div role="alertdialog" aria-labelledby="force-update-title" style={{
      height: '100vh', padding: '30px 32px 32px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center',
      background: 'var(--bg-primary)', color: 'var(--text-primary)',
    }}>
      <h1 id="force-update-title" style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{t('update.forceTitle')}</h1>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('update.forceBody')}</p>
      <PrimaryButton style={{ marginTop: 20, minWidth: 200 }} onClick={check}>{t('update.updateNow')}</PrimaryButton>
    </div>
  );
}
