import AuthBrand from '../components/AuthBrand';
import TouliaoIcon from '../ui-kit/Icon';

import './auth.css';
import React from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';

/**
 * P1-01：公开密码重置通道已禁用。
 * 原「手机号+邀请码」流程存在账号接管风险，平台暂无短信/邮箱验证码能力，
 * 重置密码请通过管理员线下处理（admin 后台 /users/:id/reset-password）。
 */
export default function ForgotPassword() {
  const { t } = useI18n();
  return (
    <div className="auth-page">
      <div className="auth-bg-circle auth-bg-circle-1" />
      <div className="auth-bg-circle auth-bg-circle-2" />
      <div className="auth-bg-circle auth-bg-circle-3" />

      <div className="auth-container">
        <AuthBrand title={t('auth.forgotTitle')} description={t('auth.recoverySubtitle')} />

        <section className="auth-form auth-recovery" aria-label={t('auth.recoveryHelp')}>
          <p className="auth-recovery-intro">{t('auth.forgotBody1')}</p>
          <ol className="auth-recovery-steps">
            <li>{t('auth.recoveryStep1')}</li>
            <li>{t('auth.recoveryStep2')}</li>
          </ol>
          <p className="auth-recovery-privacy">{t('auth.recoveryPrivacy')}</p>
          <a className="auth-recovery-mail" href={`mailto:support@touliao.cc?subject=${encodeURIComponent(t('auth.recoverySubject'))}`}>
            <TouliaoIcon name="help" size="sm" />{t('auth.contactSupport')}
          </a>
          <p className="auth-support-address">support@touliao.cc</p>
          <a className="auth-link" href="https://touliao.cc/support.html" target="_blank" rel="noopener noreferrer">
            {t('auth.supportDetails')}<TouliaoIcon name="externalLink" size="xs" />
          </a>
        </section>

        <p className="auth-footer">
          <Link to="/login" className="auth-link">{t('auth.backToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}
