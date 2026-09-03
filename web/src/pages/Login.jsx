import './auth.css';
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { timeoutSignal } from '../utils/config';
import { saveCred, hasCred, removeCred, lastRememberedPhone } from '../utils/rememberedCreds';

const isElectron = !!window.__ELECTRON_CONFIG__;

export default function Login() {
  const { t } = useI18n();
  // 仅记住用户名，密码始终由用户输入。
  const initialPhone = lastRememberedPhone();
  const [phone, setPhone] = useState(initialPhone);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(!!initialPhone);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [showPwd, setShowPwd] = useState(false);

  // 图形验证码：是否要求由后台开关 features.loginCaptcha 决定（GET /api/config），
  // 默认 false（不要求），避免开关拉取失败时误挡住所有人登录。
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaId, setCaptchaId] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaText, setCaptchaText] = useState('');

  const { login, accounts, removeAccount, maxAccounts } = useAuth();
  const navigate = useNavigate();

  const loadCaptcha = useCallback(() => {
    setCaptchaText('');
    axios.get('/api/auth/captcha')
      .then(r => { setCaptchaId(r.data?.captchaId || ''); setCaptchaSvg(r.data?.svgDataUrl || ''); })
      .catch(() => { setCaptchaId(''); setCaptchaSvg(''); });
  }, []);

  useEffect(() => {
    axios.get('/api/config')
      .then(r => {
        const on = r.data?.features?.loginCaptcha === true;
        setCaptchaRequired(on);
        if (on) loadCaptcha();
      })
      .catch(() => {}); // 拉取失败保持默认（不要求验证码），后端仍会最终裁决
  }, [loadCaptcha]);

  // 点击「最近登录」账户只回填手机号，密码不持久化。
  const fillAccount = (acct) => {
    const p = acct?.user?.phone || '';
    setPhone(p);
    setPassword('');
    setRemember(hasCred(p));
  };

  // ── 服务器切换（仅桌面端，登录前即可切换，无需重装） ──
  // 地址来自 localStorage（手动切换）或远程配置（CONFIG_URLS：touliao.cc）
  // 不再硬编码任何域名（统一走远程配置解析出的后端）
  const currentServer = localStorage.getItem('touliao_server_url') || axios.defaults.baseURL || '';
  const [showServer, setShowServer] = useState(false);
  const [serverInput, setServerInput] = useState(currentServer);
  const [serverTest, setServerTest] = useState(null);
  const [serverBusy, setServerBusy] = useState(false);

  const testServer = async () => {
    const url = serverInput.trim().replace(/\/$/, '');
    if (!url.startsWith('http')) { setServerTest({ ok: false, msg: t('auth.serverProtocolHint') }); return; }
    setServerBusy(true); setServerTest(null);
    try {
      await fetch(`${url}/health`, { signal: timeoutSignal(6000) });
      setServerTest({ ok: true, msg: t('auth.connectSuccess') });
    } catch {
      setServerTest({ ok: false, msg: t('auth.connectFail') });
    } finally { setServerBusy(false); }
  };

  const saveServer = () => {
    const url = serverInput.trim().replace(/\/$/, '');
    if (!url.startsWith('http')) { setServerTest({ ok: false, msg: t('auth.serverProtocolHint') }); return; }
    localStorage.setItem('touliao_server_url', url);
    axios.defaults.baseURL = url;
    window.location.reload();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // 防连点/回车重复提交
    setError(''); setLoading(true);
    try {
      const { data } = await axios.post('/api/auth/login', {
        phone, password,
        ...(captchaRequired ? { captchaId, captchaText } : {}),
      });
      // 登录成功后按勾选保存/清除用户名；密码绝不落盘。
      if (remember) await saveCred(phone);
      else removeCred(phone);
      login(data.user, data.token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || t('auth.loginFailed'));
      // 验证码一次核销即失效（不管猜对猜错），报错后旧图必然已经作废，直接换一张，
      // 不然用户会对着同一张失效的图片再试一次，永远拿到同一个错误。
      if (captchaRequired && /验证码/.test(err.response?.data?.error || '')) loadCaptcha();
    } finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      {/* 装饰性背景圆 */}
      <div className="auth-bg-circle auth-bg-circle-1" />
      <div className="auth-bg-circle auth-bg-circle-2" />
      <div className="auth-bg-circle auth-bg-circle-3" />

      <div className="auth-container">
        {/* Logo区域 */}
        <div className="auth-brand">
          <div className="auth-brand-icon" style={{background:'none',boxShadow:'none',padding:0,overflow:'hidden'}}>
            <picture>
              <source srcSet="/icon.webp" type="image/webp" />
              <img src="/icon.png" alt={t('common.appName')} width="68" height="68" style={{borderRadius:'var(--radius-2xl)',display:'block',objectFit:'cover'}} />
            </picture>
          </div>
          <h1 className="auth-brand-name auth-brand-name--brand">{t('common.appName')}</h1>
          <p className="auth-brand-desc">{t('auth.slogan')}</p>
        </div>

        {/* 最近登录：点击仅回填手机号。 */}
        {accounts.length > 0 && (
          <div className="auth-accounts">
            <div className="auth-accounts-header">
              <span className="auth-accounts-title">{t('auth.recentLogins')}</span>
              <span className="auth-accounts-count">{accounts.length}/{maxAccounts}</span>
            </div>
            {accounts.map(account => (
              <div key={account.id} className="auth-account-row">
                <button
                  type="button"
                  className="auth-account-btn"
                  onClick={() => fillAccount(account)}
                  title={t('auth.fillPhone')}
                >
                  <div className="auth-account-avatar">
                    {(account.user?.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="auth-account-info">
                    <span className="auth-account-name">{account.user?.username || t('auth.unnamed')}</span>
                    <span className="auth-account-id">{t('auth.touliaoId')} {account.user?.wechat_id || account.user?.phone}</span>
                  </div>
                </button>
                <button
                  type="button"
                  className="auth-account-remove"
                  onClick={() => { removeCred(account.user?.phone || ''); removeAccount(account.id); }}
                  title={t('auth.removeRecord')}
                  aria-label={t('auth.removeRecord')}
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* 登录表单 */}
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className={`auth-field ${focusedField === 'phone' ? 'focused' : ''} ${phone ? 'has-value' : ''}`}>
            <label className="auth-field-label" htmlFor="login-phone">{t('auth.phone')}</label>
            <div className="auth-field-input-wrap">
              <svg className="auth-field-icon" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="1" width="14" height="18" rx="3"/>
                <line x1="8" y1="15" x2="12" y2="15"/>
              </svg>
              <input
                id="login-phone"
                data-testid="login-phone-input"
                className="auth-field-input"
                type="tel"
                inputMode="tel"
                autoComplete="username"
                placeholder={t('auth.phonePlaceholder')}
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onFocus={() => setFocusedField('phone')}
                onBlur={() => setFocusedField(null)}
                required
              />
            </div>
          </div>

          <div className={`auth-field ${focusedField === 'password' ? 'focused' : ''} ${password ? 'has-value' : ''}`}>
            <label className="auth-field-label" htmlFor="login-password">{t('auth.password')}</label>
            <div className="auth-field-input-wrap">
              <svg className="auth-field-icon" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="9" width="14" height="10" rx="2"/>
                <path d="M6 9V6a4 4 0 018 0v3"/>
              </svg>
              <input
                id="login-password"
                data-testid="login-password-input"
                className="auth-field-input"
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder={t('auth.passwordPlaceholder')}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                required
              />
              <button type="button" className="auth-pwd-toggle" onClick={() => setShowPwd(v => !v)} aria-label={showPwd ? t('auth.hidePassword') : t('auth.showPassword')}>
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
            </div>
          </div>

          {captchaRequired && (
            <div className="auth-field">
              <label className="auth-field-label" htmlFor="login-captcha">{t('auth.captchaLabel')}</label>
              <div className="auth-captcha-row">
                <input
                  id="login-captcha"
                  data-testid="login-captcha-input"
                  className="auth-field-input auth-captcha-input"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t('auth.captchaPlaceholder')}
                  value={captchaText}
                  onChange={e => setCaptchaText(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="auth-captcha-img-btn"
                  onClick={loadCaptcha}
                  title={t('auth.captchaRefreshTitle')}
                  data-testid="login-captcha-refresh"
                >
                  {captchaSvg
                    ? <img src={captchaSvg} alt={t('auth.captchaAlt')} className="auth-captcha-img" />
                    : <span className="auth-captcha-loading">{t('common.loading')}</span>}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="auth-error" role="alert" data-testid="auth-error-text">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 5h2v4H7V5zm0 5h2v2H7v-2z"/>
              </svg>
              {error}
            </div>
          )}

          <div className="auth-remember-row">
            <label className="auth-remember">
              <input
                type="checkbox"
                className="auth-remember-box"
                data-testid="login-remember-checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
              />
              {t('auth.rememberUsername')}
            </label>
            <Link to="/forgot-password" className="auth-link" style={{ fontSize: 'var(--text-sm2)' }}>{t('auth.forgotPasswordLink')}</Link>
          </div>

          <button type="submit" className="auth-submit" data-testid="login-submit-btn" disabled={loading || !phone || !password || (captchaRequired && !captchaText)}>
            {loading ? (
              <span className="auth-spinner" />
            ) : (
              t('auth.loginBtn')
            )}
          </button>
        </form>

        <p className="auth-footer">
          {t('auth.noAccountYet')}<Link to="/register" className="auth-link">{t('auth.registerNew')}</Link>
        </p>

        {/* 下载客户端 — 仅网页端显示 */}
        {!isElectron && (
          <div className="auth-download">
            <p className="auth-download-label">{t('auth.downloadClient')}</p>
            <div className="auth-download-row">
              <a href="/downloads/touliao-windows-latest-setup.exe" download className="auth-download-btn">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                  <path d="M3 5.48l7.2-.98v6.96H3V5.48zm0 13.04l7.2.98v-6.86H3v5.88zm8.04 1.09L21 21V12.6h-9.96v6.0zM11.04 3L21 3.6V11.4h-9.96V3z"/>
                </svg>
                {t('auth.windowsVersion')}
              </a>
              <a href="/downloads/touliao-android-latest.apk" download className="auth-download-btn">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                  <path d="M17.6 9.48l1.84-3.18a.39.39 0 00-.14-.53.39.39 0 00-.53.14l-1.86 3.22a11.46 11.46 0 00-9.82 0L5.23 5.91a.39.39 0 00-.53-.14.39.39 0 00-.14.53L6.4 9.48A10.78 10.78 0 001 18h22a10.78 10.78 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z"/>
                </svg>
                {t('auth.androidVersion')}
              </a>
            </div>
          </div>
        )}

        {/* 服务器切换 — 仅桌面端 */}
        {isElectron && (
          <div className="auth-server">
            {!showServer ? (
              <button type="button" className="auth-server-toggle" onClick={() => setShowServer(true)}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style={{ marginRight: 5, verticalAlign: '-2px' }}>
                  <path d="M4 1h16a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm0 8h16a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4a1 1 0 011-1zm2-5a1 1 0 100 2 1 1 0 000-2zm0 8a1 1 0 100 2 1 1 0 000-2z"/>
                </svg>
                {t('auth.currentServerLabel')}{currentServer.replace(/^https?:\/\//, '')} · {t('auth.switchServer')}
              </button>
            ) : (
              <div className="auth-server-panel">
                <div className="auth-server-title">{t('auth.serverAddressLabel')}</div>
                <input
                  className="auth-server-input"
                  aria-label={t('auth.serverAddressLabel')}
                  value={serverInput}
                  onChange={e => { setServerInput(e.target.value); setServerTest(null); }}
                  placeholder={t('auth.serverPlaceholder')}
                  autoCapitalize="none"
                  spellCheck={false}
                />
                {serverTest && (
                  <div className="auth-server-result" role="alert" style={{ color: serverTest.ok ? 'var(--green)' : 'var(--color-danger)' }}>
                    {serverTest.msg}
                  </div>
                )}
                <div className="auth-server-btns">
                  <button type="button" onClick={testServer} disabled={serverBusy} className="auth-server-btn ghost">
                    {serverBusy ? t('auth.testing') : t('auth.testConnection')}
                  </button>
                  <button type="button" onClick={saveServer} className="auth-server-btn primary">{t('auth.saveAndSwitch')}</button>
                </div>
                <button type="button" className="auth-server-cancel" onClick={() => { setShowServer(false); setServerInput(currentServer); setServerTest(null); }}>{t('common.cancel')}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
