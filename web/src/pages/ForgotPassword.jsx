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

      <div className="auth-container" style={{ width: 400 }}>
        <div className="auth-brand">
          {/* 审计 P0 修复：与登录页统一为真实 App 图标，见 Register.jsx 同款改动注释。 */}
          <div className="auth-brand-icon" style={{background:'none',boxShadow:'none',padding:0,overflow:'hidden'}}>
            <picture>
              <source srcSet="/icon.webp" type="image/webp" />
              <img src="/icon.png" alt={t('common.appName')} width="38" height="38" style={{borderRadius:'var(--radius-md)',display:'block',objectFit:'cover'}} />
            </picture>
          </div>
          <h1 className="auth-brand-name">{t('auth.forgotTitle')}</h1>
          <p className="auth-brand-desc">{t('auth.forgotUnavailable')}</p>
        </div>

        <div className="auth-note" style={{ marginBottom: 20, lineHeight: 1.7 }}>
          {t('auth.forgotBody1')}<br />
          {t('auth.forgotBody2')}
        </div>

        <p className="auth-footer">
          <Link to="/login" className="auth-link">{t('auth.backToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}
