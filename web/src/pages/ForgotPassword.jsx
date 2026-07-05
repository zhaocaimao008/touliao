import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

export default function ForgotPassword() {
  const [form, setForm] = useState({ phone: '', inviteCode: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [showPwd, setShowPwd] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(form.inviteCode)) {
      setError('邀请码必须是6位数字');
      return;
    }
    if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(form.newPassword)) {
      setError('密码必须至少8位，且至少包含1个字母和1个数字');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      await axios.post('/api/auth/reset-password', {
        phone: form.phone.trim(),
        inviteCode: form.inviteCode.trim(),
        newPassword: form.newPassword,
      });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || '重置失败');
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    { key: 'phone', label: '手机号', type: 'tel', inputMode: 'tel', autocomplete: 'username', placeholder: '请输入注册时的手机号', icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="1" width="14" height="18" rx="3"/>
        <line x1="8" y1="15" x2="12" y2="15"/>
      </svg>
    )},
    { key: 'inviteCode', label: '邀请码', type: 'text', inputMode: 'numeric', autocomplete: 'off', placeholder: '请输入6位邀请码', maxLength: 6, icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10 2l2.4 4.8 5.3.8-3.85 3.75.9 5.3L10 14.1l-4.75 2.55.9-5.3L2.3 7.6l5.3-.8z"/>
      </svg>
    )},
    { key: 'newPassword', label: '新密码', type: 'password', autocomplete: 'new-password', placeholder: '至少8位，含字母和数字', icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="9" width="14" height="10" rx="2"/>
        <path d="M6 9V6a4 4 0 018 0v3"/>
      </svg>
    )},
    { key: 'confirmPassword', label: '确认新密码', type: 'password', autocomplete: 'new-password', placeholder: '再次输入新密码', icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="9" width="14" height="10" rx="2"/>
        <path d="M6 9V6a4 4 0 018 0v3"/>
      </svg>
    )},
  ];

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-bg-circle auth-bg-circle-1" />
        <div className="auth-bg-circle auth-bg-circle-2" />
        <div className="auth-bg-circle auth-bg-circle-3" />
        <div className="auth-container" style={{ width: 400 }}>
          <div className="auth-brand">
            <h1 className="auth-brand-name">密码已重置</h1>
            <p className="auth-brand-desc">请使用新密码登录</p>
          </div>
          <button type="button" className="auth-submit" onClick={() => navigate('/login')}>
            返回登录
          </button>
        </div>
      </div>
    );
  }

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
          <h1 className="auth-brand-name">忘记密码</h1>
          <p className="auth-brand-desc">使用注册时的手机号和邀请码重置</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px', padding: '9px 14px', background: 'rgba(7,193,96,.1)', border: '1px solid rgba(7,193,96,.2)', borderRadius: '8px', fontSize: '13px', color: 'rgba(255,255,255,.65)' }}>
            💡 需要邀请码？请向已有账号的用户询问，或联系管理员获取
          </div>

          {fields.map(f => (
            <div key={f.key} className={`auth-field ${focusedField === f.key ? 'focused' : ''} ${form[f.key] ? 'has-value' : ''}`}>
              <label className="auth-field-label" htmlFor={`fp-${f.key}`}>{f.label}</label>
              <div className="auth-field-input-wrap">
                <span className="auth-field-icon" aria-hidden="true">{f.icon}</span>
                <input
                  id={`fp-${f.key}`}
                  className="auth-field-input"
                  type={(f.key === 'newPassword' || f.key === 'confirmPassword') ? (showPwd ? 'text' : 'password') : f.type}
                  inputMode={f.inputMode}
                  autoComplete={f.autocomplete}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  maxLength={f.maxLength}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  onFocus={() => setFocusedField(f.key)}
                  onBlur={() => setFocusedField(null)}
                  required
                />
                {(f.key === 'newPassword' || f.key === 'confirmPassword') && (
                  <button type="button" className="auth-pwd-toggle" onClick={() => setShowPwd(v => !v)} aria-label={showPwd ? '隐藏密码' : '显示密码'}>
                    {showPwd ? (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}

          {error && (
            <div className="auth-error" role="alert">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 5h2v4H7V5zm0 5h2v2H7v-2z"/>
              </svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={loading || !form.phone || !form.inviteCode || !form.newPassword || !form.confirmPassword}
          >
            {loading ? <span className="auth-spinner" /> : '重置密码'}
          </button>
        </form>

        <p className="auth-footer">
          想起密码了？<Link to="/login" className="auth-link">返回登录</Link>
        </p>
      </div>
    </div>
  );
}
