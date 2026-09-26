import TouliaoField from '../ui-kit/Field';
import { PrimaryButton } from '../ui-kit/Button';
import TouliaoIcon from '../ui-kit/Icon';

import './auth.css';
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';

export default function Register() {
  const { t } = useI18n();
  // 从邀请链接 /register?invite=123456 预填邀请码（好友分享链接一点即注册）——
  // 惰性初始化，避免 effect 内 setState 造成的额外渲染
  const [form, setForm] = useState(() => {
    let inviteCode = '';
    try {
      const code = new URLSearchParams(window.location.search).get('invite');
      if (code && /^\d{6}$/.test(code)) inviteCode = code;
    } catch { /* SSR/无 window 时忽略 */ }
    return { username: '', phone: '', password: '', inviteCode };
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorField, setErrorField] = useState(null);
  // 是否需要邀请码由后台开关决定（GET /api/config）。默认 true，避免加载前误放行 UI。
  const [inviteRequired, setInviteRequired] = useState(true);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/api/config')
      .then(r => setInviteRequired(r.data?.features?.inviteRequired !== false))
      .catch(() => {}); // 拉取失败保持默认（需要邀请码），后端仍会最终裁决
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // 防连点/回车重复提交（避免重复注册）
    setError(''); setErrorField(null); setLoading(true);

    // 前端基础校验
    if (!form.username || form.username.trim().length < 2 || form.username.trim().length > 20) {
      setErrorField('username'); setError(t('auth.nicknameLenError')); setLoading(false); return;
    }
    if (!/^\d{11}$/.test(form.phone)) {
      setErrorField('phone'); setError(t('auth.phoneFormatError')); setLoading(false); return;
    }
    if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(form.password)) {
      setErrorField('password'); setError(t('auth.passwordFormatError')); setLoading(false); return;
    }
    if (inviteRequired && (!form.inviteCode || !/^\d{6}$/.test(form.inviteCode))) {
      setErrorField('inviteCode'); setError(t('auth.inviteCodeFormatError')); setLoading(false); return;
    }

    try {
      const { data } = await axios.post('/api/auth/register', form);
      login(data.user, data.token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || t('auth.registerFailed'));
    } finally { setLoading(false); }
  };

  const fields = [
    { key: 'username', label: t('auth.nickname'), type: 'text', autocomplete: 'nickname', placeholder: t('auth.nicknamePlaceholder'), maxLength: 20, icon: (
      <TouliaoIcon name="contact" className="auth-field-icon" size="sm" />
    )},
    { key: 'phone', label: t('auth.phone'), type: 'tel', inputMode: 'tel', autocomplete: 'username', placeholder: t('auth.phonePlaceholder'), maxLength: 11, icon: (
      <TouliaoIcon name="phoneNumber" className="auth-field-icon" size="sm" />
    )},
    { key: 'password', label: t('auth.password'), type: 'password', autocomplete: 'new-password', placeholder: t('auth.setPasswordPlaceholder'), icon: (
      <TouliaoIcon name="lock" className="auth-field-icon" size="sm" />
    )},
    ...(inviteRequired ? [{ key: 'inviteCode', label: t('auth.inviteCode'), type: 'text', inputMode: 'numeric', autocomplete: 'off', placeholder: t('auth.inviteCodePlaceholder'), maxLength: 6, icon: (
      <TouliaoIcon name="passwordReset" className="auth-field-icon" size="sm" />
    )}] : []),
  ];

  return (
    <div className="auth-page">
      <div className="auth-bg-circle auth-bg-circle-1" />
      <div className="auth-bg-circle auth-bg-circle-2" />
      <div className="auth-bg-circle auth-bg-circle-3" />

      <div className="auth-container" style={{ width: 400 }}>
        <div className="auth-brand">
          <div className="auth-brand-icon">
            <svg viewBox="0 0 40 40" width="38" height="38" fill="none">
              <path d="M5 7a3 3 0 013-3h16a3 3 0 013 3v12a3 3 0 01-3 3H14l-5 5V7z" fill="rgba(255,255,255,.3)"/>
              <path d="M17 15a3 3 0 013-3h11a3 3 0 013 3v10a3 3 0 01-3 3h-3v4l-5-4h-3a3 3 0 01-3-3V15z" fill="white"/>
            </svg>
          </div>
          <h1 className="auth-brand-name">{t('auth.createAccount')}</h1>
          <p className="auth-brand-desc">{t('auth.registerSlogan')}</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {inviteRequired && (
            <div className="auth-note">
              {t('auth.inviteCodeHint')}
            </div>
          )}

          {fields.map(f => (
            <TouliaoField key={f.key} id={`reg-${f.key}`} label={f.label} icon={f.icon}
              data-testid={f.key === 'inviteCode' ? 'register-invite-input' : `register-${f.key}-input`}
              variant={f.key === 'password' ? 'PASSWORD' : f.key === 'inviteCode' ? 'CODE' : 'TEXT'}
              type={f.type} inputMode={f.inputMode} autoComplete={f.autocomplete} placeholder={f.placeholder}
              value={form[f.key]} maxLength={f.maxLength} required
              error={errorField === f.key ? error : undefined} aria-describedby={error && !errorField ? 'register-error' : undefined}
              onChange={e => { setForm({...form, [f.key]: e.target.value}); if (errorField === f.key) { setErrorField(null); setError(''); } }} />
          ))}

          {error && (
            <div id="register-error" className="auth-error" role="alert">
              <TouliaoIcon name="error" size="xs" />
              {error}
            </div>
          )}

          <PrimaryButton type="submit" data-testid="register-submit-btn" className="auth-submit" loading={loading} disabled={!form.username || !form.phone || !form.password || (inviteRequired && !form.inviteCode)}>
            {t('auth.registerBtn')}
          </PrimaryButton>
        </form>

        <p className="auth-footer">
          {t('auth.haveAccount')}<Link to="/login" className="auth-link">{t('auth.loginLink')}</Link>
        </p>
      </div>
    </div>
  );
}
