import './auth.css';
import React from 'react';
import { Link } from 'react-router-dom';

/**
 * P1-01：公开密码重置通道已禁用。
 * 原「手机号+邀请码」流程存在账号接管风险，平台暂无短信/邮箱验证码能力，
 * 重置密码请通过管理员线下处理（admin 后台 /users/:id/reset-password）。
 */
export default function ForgotPassword() {
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
          <p className="auth-brand-desc">密码重置服务暂时不可用</p>
        </div>

        <div className="auth-note" style={{ marginBottom: 20, lineHeight: 1.7 }}>
          为保护账号安全，当前不支持在线重置密码。<br />
          请联系管理员协助处理。
        </div>

        <p className="auth-footer">
          <Link to="/login" className="auth-link">返回登录</Link>
        </p>
      </div>
    </div>
  );
}
