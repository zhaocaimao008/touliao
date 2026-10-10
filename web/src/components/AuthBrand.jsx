import React from 'react';
import { useI18n } from '../contexts/I18nContext';

/** Shared identity for all authentication steps. */
export default function AuthBrand({ title, description, home = false }) {
  const { t } = useI18n();
  return <header className="auth-brand">
    <picture className="auth-brand-icon auth-brand-logo">
      <source srcSet={`${import.meta.env.BASE_URL}icon.webp`} type="image/webp" />
      <img src={`${import.meta.env.BASE_URL}icon.png`} alt={t('common.appName')} width="68" height="68" />
    </picture>
    <h1 className={`auth-brand-name${home ? ' auth-brand-name--brand' : ''}`}>{title}</h1>
    <p className="auth-brand-desc">{description}</p>
  </header>;
}
