import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

export default function Register() {
  const [form, setForm] = useState({ username: '', phone: '', password: '', inviteCode: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [showPwd, setShowPwd] = useState(false);
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
    setError(''); setLoading(true);

    // 前端基础校验
    if (!form.username || form.username.trim().length < 2 || form.username.trim().length > 20) {
      setError('昵称需在 2~20 个字符之间'); setLoading(false); return;
    }
    if (!/^\d{11}$/.test(form.phone)) {
      setError('请输入 11 位手机号'); setLoading(false); return;
    }
    if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(form.password)) {
      setError('密码至少8位且需包含字母和数字'); setLoading(false); return;
    }
    if (inviteRequired && (!form.inviteCode || !/^\d{6}$/.test(form.inviteCode))) {
      setError('邀请码必须是6位数字'); setLoading(false); return;
    }

    try {
      const { data } = await axios.post('/api/auth/register', form);
      login(data.user, data.token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || '注册失败');
    } finally { setLoading(false); }
  };

  const fields = [
    { key: 'username', label: '昵称', type: 'text', placeholder: '请输入昵称', icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10 11a4 4 0 100-8 4 4 0 000 8zM3 18c0-3.3 3.1-6 7-6s7 2.7 7 6"/>
      </svg>
    )},
    { key: 'phone', label: '手机号', type: 'tel', placeholder: '请输入手机号', icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="1" width="14" height="18" rx="3"/>
        <line x1="8" y1="15" x2="12" y2="15"/>
      </svg>
    )},
    { key: 'password', label: '密码', type: 'password', placeholder: '请设置密码（至少8位，字母+数字）', icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="9" width="14" height="10" rx="2"/>
        <path d="M6 9V6a4 4 0 018 0v3"/>
      </svg>
    )},
    ...(inviteRequired ? [{ key: 'inviteCode', label: '邀请码', type: 'text', placeholder: '请输入6位邀请码', maxLength: 6, icon: (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10 2l2.4 4.8 5.3.8-3.85 3.75.9 5.3L10 14.1l-4.75 2.55.9-5.3L2.3 7.6l5.3-.8z"/>
      </svg>
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
          <h1 className="auth-brand-name">创建账号</h1>
          <p className="auth-brand-desc">注册 v信，开始畅聊</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {inviteRequired && (
            <div style={{ marginBottom: '16px', padding: '9px 14px', background: 'rgba(7,193,96,.1)', border: '1px solid rgba(7,193,96,.2)', borderRadius: '8px', fontSize: '13px', color: 'rgba(255,255,255,.65)' }}>
              💡 需要邀请码？请向已有账号的用户询问，或联系管理员获取
            </div>
          )}

          {fields.map(f => (
            <div key={f.key} className={`auth-field ${focusedField === f.key ? 'focused' : ''} ${form[f.key] ? 'has-value' : ''}`}>
              <label className="auth-field-label" htmlFor={`reg-${f.key}`}>{f.label}</label>
              <div className="auth-field-input-wrap">
                <span className="auth-field-icon" aria-hidden="true">{f.icon}</span>
                <input
                  data-testid={f.key === 'inviteCode' ? 'register-invite-input' : `register-${f.key}-input`}
                  id={`reg-${f.key}`}
                  className="auth-field-input"
                  type={f.key === 'password' ? (showPwd ? 'text' : 'password') : f.type}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  maxLength={f.maxLength}
                  onChange={e => setForm({...form, [f.key]: e.target.value})}
                  onFocus={() => setFocusedField(f.key)}
                  onBlur={() => setFocusedField(null)}
                  required
                />
                {f.key === 'password' && (
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

          <button type="submit" data-testid="register-submit-btn" className="auth-submit" disabled={loading || !form.username || !form.phone || !form.password || (inviteRequired && !form.inviteCode)}>
            {loading ? <span className="auth-spinner" /> : '注册'}
          </button>
        </form>

        <p className="auth-footer">
          已有账号？<Link to="/login" className="auth-link">登录</Link>
        </p>
      </div>
    </div>
  );
}
