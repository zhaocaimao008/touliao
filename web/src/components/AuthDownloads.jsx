import React from 'react';
import { useI18n } from '../contexts/I18nContext';
import { preferredDownload } from '../utils/downloadPlatform';
import TouliaoIcon from '../ui-kit/Icon';

const downloads = [
  { platform: 'windows', label: 'auth.windowsVersion', href: '/downloads/touliao-windows-latest-setup.exe' },
  { platform: 'android', label: 'auth.androidVersion', href: '/downloads/touliao-android-latest.apk' },
];

export default function AuthDownloads() {
  const { t } = useI18n();
  const preferred = preferredDownload(navigator);
  const link = ({ platform, label, href }) => <a key={platform} href={href} download
    className={`auth-download-btn${platform === preferred ? ' auth-download-preferred' : ''}`}
    data-testid={`download-${platform}`}>
    <TouliaoIcon name="download" size="sm" />{t(label)}
  </a>;
  return <section className="auth-download" aria-label={t('auth.downloadClient')}>
    <p className="auth-download-label">{t(preferred ? 'auth.downloadForDevice' : 'auth.webAvailable')}</p>
    {preferred && <div className="auth-download-row">{downloads.filter(item => item.platform === preferred).map(link)}</div>}
    <details className="auth-other-downloads">
      <summary>{t(preferred ? 'auth.otherVersions' : 'auth.otherPlatformClients')}</summary>
      <div className="auth-download-row">{downloads.filter(item => item.platform !== preferred).map(link)}</div>
    </details>
  </section>;
}
