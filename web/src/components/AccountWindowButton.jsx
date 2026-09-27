import React from 'react';
import './AccountWindowButton.css';
import { openAccountWindow } from '../utils/clientStorage';
import { useI18n } from '../contexts/I18nContext';

export default function AccountWindowButton() {
  const { t } = useI18n();
  if (window.Capacitor?.isNativePlatform?.()) return null;
  return <button type="button" className="auth-window-button" onClick={openAccountWindow}>{t('auth.openAccountWindow')}</button>;
}
