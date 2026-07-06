import React, { useEffect, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import AuthImage from './AuthImage';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useI18n, SUPPORTED_LANGS } from '../contexts/I18nContext';
import { goLogin } from '../utils/url';
import { showConfirm, showToast } from '../utils/toast';
import { copyToClipboard } from '../utils/clipboard';

/* ─── 小工具 ─── */
// role="button" 的 div 应同时支持 Enter 和空格触发（空格默认会滚动页面，需 preventDefault）
const activateOnKey = (fn) => (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
};

const ChevronRight = () => (
  <svg className="wc-chevron" viewBox="0 0 24 24">
    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
  </svg>
);

function Toggle({ checked, onChange, disabled }) {
  return (
    <button type="button" className={`wc-switch${checked ? ' on' : ''}`}
      onClick={e => { e.stopPropagation(); if (!disabled) onChange?.(!checked); }}
      disabled={disabled}
      aria-pressed={checked}>
      <span />
    </button>
  );
}

/* ─── SVG icons ─── */
const Ico = ({ d }) => <svg className="wc-ico" viewBox="0 0 24 24"><path d={d}/></svg>;
const IcoUser    = () => <Ico d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>;
const IcoID      = () => <Ico d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h12v2H6zm0-4h6v2H6zm0 8h9v2H6z"/>;
const IcoPhone   = () => <Ico d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>;
const IcoDesktop = () => <Ico d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zm-8-1c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm8-3H4V6h16v8z"/>;
const IcoMoon    = () => <Ico d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>;
const IcoBell    = () => <Ico d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>;
const IcoShield  = () => <Ico d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>;
const IcoGear    = () => <Ico d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>;
const IcoServer  = () => <Ico d="M4 1h16a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm0 8h16a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4a1 1 0 011-1zm0 8h16a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4a1 1 0 011-1zM6 4a1 1 0 100 2 1 1 0 000-2zm0 8a1 1 0 100 2 1 1 0 000-2zm0 8a1 1 0 100 2 1 1 0 000-2z"/>;
const IcoEdit    = () => <Ico d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>;
const IcoQR      = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM13 13h2v2h-2zM15 15h2v2h-2zM13 17h2v2h-2zM17 13h2v2h-2zM19 15h2v2h-2zM17 17h2v2h-2zM19 19h2v2h-2zM15 19h2v2h-2z"/>
  </svg>
);

/* ─── 通用 UI 零件 ─── */
function PageBg({ children }) {
  return <div className="wc-page-bg">{children}</div>;
}

function PageHeader({ title, onBack, right }) {
  return (
    <div className="wc-page-header">
      <button className="wc-page-header-back" onClick={onBack}>‹ 返回</button>
      <span className="wc-page-header-title">{title}</span>
      <div className="wc-page-header-right">{right}</div>
    </div>
  );
}

function SLabel({ children }) {
  return <div className="wc-slabel">{children}</div>;
}

function Card({ children, style, className }) {
  return <div className={`wc-card${className ? ' ' + className : ''}`} style={style}>{children}</div>;
}

function CRow({ icon, bg, label, value, desc, onClick, right, danger }) {
  return (
    <div className={`wc-crow${onClick ? ' wc-crow-clickable' : ''}`}
      onClick={onClick}
      role="button" tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? activateOnKey(onClick) : undefined}>
      {icon && (
        <div className="wc-crow-icon" style={{ background: bg }}>
          {icon}
        </div>
      )}
      <div className="wc-crow-body">
        <div className={danger ? 'wc-crow-label wc-crow-label-danger' : 'wc-crow-label'}>{label}</div>
        {desc && <div className="wc-crow-desc">{desc}</div>}
      </div>
      {value != null && <span className={`wc-crow-value${onClick ? ' wc-crow-value-gap' : ''}`}>{value}</span>}
      {right}
      {onClick && !right && <ChevronRight />}
    </div>
  );
}

/* ── 修改昵称 ── */
function EditName({ user, updateUser, onBack }) {
  const [username, setUsername] = useState(user?.username || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const MAX = 20;

  const save = async () => {
    if (saving) return; // 防连点：回车提交会绕过 disabled 按钮
    const trimmed = username.trim();
    if (!trimmed) { setError('昵称不能为空'); return; }
    if (trimmed.length > MAX) { setError(`昵称最多 ${MAX} 个字符`); return; }
    setSaving(true);
    setError('');
    try {
      const { data } = await axios.put('/api/users/profile', { username: trimmed });
      updateUser(data);
      onBack();
    } catch (err) {
      setError(err.response?.data?.error || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageBg>
      <PageHeader title="修改昵称" onBack={onBack}
        right={
          <button className="wc-save-btn" onClick={save} disabled={saving}>
            {saving ? '保存中' : '保存'}
          </button>
        }
      />
      <div className="wc-edit-pad">
        <Card>
          <div className="wc-edit-wrap">
            <input
              value={username}
              onChange={e => { setUsername(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && save()}
              maxLength={MAX}
              autoFocus
              placeholder="请输入昵称"
              aria-label="修改昵称"
              className="wc-edit-input"
            />
            <span className="wc-edit-counter">{username.length}/{MAX}</span>
          </div>
        </Card>
        {error && <div className="wc-edit-error" role="alert">{error}</div>}
        <div className="wc-edit-hint">昵称会对所有联系人显示</div>
      </div>
    </PageBg>
  );
}

/* ── 修改个性签名 ── */
function EditBio({ user, updateUser, onBack }) {
  const [bio, setBio] = useState(user?.bio || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const MAX = 100;

  const save = async () => {
    if (saving) return; // 防连点：回车提交会绕过 disabled 按钮
    const trimmed = bio.trim();
    if (trimmed.length > MAX) { setError(`签名最多 ${MAX} 个字符`); return; }
    setSaving(true);
    setError('');
    try {
      const { data } = await axios.put('/api/users/profile', { bio: trimmed });
      updateUser(data);
      onBack();
    } catch (err) {
      setError(err.response?.data?.error || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageBg>
      <PageHeader title="修改个性签名" onBack={onBack}
        right={
          <button className="wc-save-btn" onClick={save} disabled={saving}>
            {saving ? '保存中' : '保存'}
          </button>
        }
      />
      <div className="wc-edit-pad">
        <Card>
          <div className="wc-edit-wrap">
            <textarea
              value={bio}
              onChange={e => { setBio(e.target.value); setError(''); }}
              maxLength={MAX}
              autoFocus
              placeholder="请输入个性签名"
              aria-label="修改个性签名"
              className="wc-edit-input wc-edit-textarea"
              rows={3}
            />
            <span className="wc-edit-counter">{bio.length}/{MAX}</span>
          </div>
        </Card>
        {error && <div className="wc-edit-error" role="alert">{error}</div>}
        <div className="wc-edit-hint">个性签名会在好友资料中显示</div>
      </div>
    </PageBg>
  );
}

/* ── 修改密码 ── */
function ChangePassword({ onBack }) {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const backTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(backTimerRef.current), []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const save = async () => {
    if (saving || done) return; // 防连点：避免重复提交改密请求
    if (!oldPassword || !newPassword) { setError('请填写完整'); return; }
    if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(newPassword)) { setError('新密码至少8位且需包含字母和数字'); return; }
    if (newPassword !== confirm) { setError('两次输入的新密码不一致'); return; }
    setSaving(true); setError('');
    try {
      await axios.put('/api/auth/change-password', { oldPassword, newPassword });
      setDone(true);
      backTimerRef.current = setTimeout(onBack, 1200);
    } catch (err) {
      setError(err.response?.data?.error || '修改失败，请重试');
    } finally { setSaving(false); }
  };

  return (
    <PageBg>
      <PageHeader title="修改密码" onBack={onBack}
        right={<button className="wc-save-btn" onClick={save} disabled={saving || done}>{saving ? '保存中' : '保存'}</button>}
      />
      <div className="wc-edit-pad">
        <Card>
          <div className="wc-edit-wrap">
            <input type="password" value={oldPassword} onChange={e => { setOld(e.target.value); setError(''); }}
              autoFocus placeholder="当前密码" aria-label="当前密码" className="wc-edit-input" />
          </div>
        </Card>
        <Card>
          <div className="wc-edit-wrap">
            <input type="password" value={newPassword} onChange={e => { setNew(e.target.value); setError(''); }}
              placeholder="新密码（≥8位，含字母和数字）" aria-label="新密码" className="wc-edit-input" />
          </div>
          <div className="wc-edit-wrap">
            <input type="password" value={confirm} onChange={e => { setConfirm(e.target.value); setError(''); }}
              placeholder="确认新密码" aria-label="确认新密码" className="wc-edit-input" />
          </div>
        </Card>
        {error && <div className="wc-edit-error" role="alert">{error}</div>}
        {done && <div className="wc-edit-hint">✓ 密码已修改</div>}
        <div className="wc-edit-hint">修改后其它设备需重新登录</div>
      </div>
    </PageBg>
  );
}

/* ── 我的钱包（余额 + 流水 + 充值）── */
function Wallet({ onBack }) {
  const [balance, setBalance] = useState(null);
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recharging, setRecharging] = useState(false);
  const [error, setError] = useState('');
  const [rechargeInput, setRechargeInput] = useState('');
  const [showRecharge, setShowRecharge] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [b, t] = await Promise.all([
        axios.get('/api/wallet'),
        axios.get('/api/wallet/transactions', { params: { limit: 50 } }),
      ]);
      setBalance(b.data?.balance ?? 0);
      setTxns(Array.isArray(t.data) ? t.data : []);
    } catch { /* 静默：余额显示为 — */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const recharge = async () => {
    if (recharging) return; // 防连点：回车提交会绕过 disabled 按钮，避免重复充值
    const amt = parseInt(rechargeInput, 10);
    if (!Number.isInteger(amt) || amt < 1 || amt > 100000) { setError('请输入 1-100000 的整数'); return; }
    setRecharging(true); setError('');
    try {
      const { data } = await axios.post('/api/wallet/recharge', { amount: amt });
      setBalance(data?.balance ?? balance);
      setRechargeInput('');
      setShowRecharge(false);
      load();
    } catch (e) { setError(e.response?.data?.error || '充值失败'); }
    setRecharging(false);
  };

  const TYPE_LABEL = { recharge: '充值', red_packet: '发红包', red_packet_refund: '红包退回', red_packet_claim: '领红包' };
  const fmtTime = (s) => { try { return new Date(s * 1000).toLocaleString(); } catch { return ''; } };

  return (
    <PageBg>
      <PageHeader title="我的钱包" onBack={onBack}
        right={<button className="wc-save-btn" onClick={() => { setShowRecharge(v => !v); setError(''); }}>{showRecharge ? '取消' : '充值'}</button>} />
      <div className="wc-section-pad">
        <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px', gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>金币余额</div>
          <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--green)' }}>{loading ? '…' : (balance ?? '—')}</div>
        </Card>
        {showRecharge && (
          <Card style={{ marginTop: 12, padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="number" min="1" max="100000"
              placeholder="充值金币数量（1-100000）"
              aria-label="充值金币数量"
              value={rechargeInput}
              onChange={e => { setRechargeInput(e.target.value); setError(''); }}
              className="wc-server-input"
              style={{ marginTop: 0, flex: 1 }}
              onKeyDown={e => e.key === 'Enter' && recharge()}
            />
            <button className="wc-save-btn" onClick={recharge} disabled={recharging || !rechargeInput}>
              {recharging ? '充值中' : '确认'}
            </button>
          </Card>
        )}
        {error && <div className="wc-edit-error" role="alert">{error}</div>}
      </div>
      <SLabel>交易记录</SLabel>
      <div className="wc-section-pad">
        <Card>
          {loading ? (
            <CRow label="加载中…" />
          ) : txns.length === 0 ? (
            <CRow label="暂无交易记录" />
          ) : txns.map(t => (
            <CRow key={t.id}
              label={TYPE_LABEL[t.type] || t.memo || t.type}
              desc={fmtTime(t.created_at)}
              right={<span style={{ color: t.amount >= 0 ? 'var(--green)' : 'var(--text-primary)', fontWeight: 600 }}>
                {t.amount >= 0 ? '+' : ''}{t.amount}
              </span>} />
          ))}
        </Card>
      </div>
    </PageBg>
  );
}

/* ── 邀请好友（专属邀请码 + 裂变战绩）── */
function InviteFriends({ onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');   // '' | 'code' | 'link'

  useEffect(() => {
    let alive = true;
    axios.get('/api/users/me/invite')
      .then(r => { if (alive) setData(r.data); })
      .catch(() => { if (alive) setData({ code: '', invitedCount: 0, invitees: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // 浏览器端才有可分享的公网链接；桌面端 file:// 无意义，只给复制邀请码。
  const origin = window.location.origin;
  const inviteLink = /^https?:/.test(origin) && data?.code ? `${origin}/register?invite=${data.code}` : '';

  const copyText = async (text, which) => {
    if (!text) return;
    if (await copyToClipboard(text)) {
      setCopied(which);
      setTimeout(() => setCopied(''), 1500);
    } else {
      showToast('复制失败，请长按手动复制', 'error');
    }
  };

  const fmtTime = (s) => { try { return new Date(s * 1000).toLocaleDateString(); } catch { return ''; } };

  return (
    <PageBg>
      <PageHeader title="邀请好友" onBack={onBack} />
      <div className="wc-section-pad">
        <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>我的专属邀请码</div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 6, color: 'var(--green)', userSelect: 'text' }}>
            {loading ? '……' : (data?.code || '—')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="wc-save-btn" onClick={() => copyText(data?.code, 'code')} disabled={!data?.code}>
              {copied === 'code' ? '已复制' : '复制邀请码'}
            </button>
            {inviteLink && (
              <button className="wc-save-btn" onClick={() => copyText(inviteLink, 'link')}>
                {copied === 'link' ? '已复制' : '复制邀请链接'}
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 4 }}>
            把邀请码或链接发给好友，Ta 注册后即成为你邀请的用户
          </div>
        </Card>
      </div>

      <div className="wc-section-pad">
        <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px', gap: 4 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>已成功邀请</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{loading ? '…' : (data?.invitedCount ?? 0)} 人</div>
        </Card>
      </div>

      <SLabel>邀请记录</SLabel>
      <div className="wc-section-pad">
        <Card>
          {loading ? (
            <CRow label="加载中…" />
          ) : (data?.invitees?.length ? data.invitees.map(u => (
            <CRow key={u.id}
              icon={<Avatar src={u.avatar} name={u.username} size={28} />} bg="transparent"
              label={u.username}
              desc={u.wechat_id ? `v信号：${u.wechat_id}` : ''}
              right={<span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtTime(u.created_at)}</span>} />
          )) : <CRow label="还没有邀请记录，快去分享你的邀请码吧" />)}
        </Card>
      </div>
    </PageBg>
  );
}

/* ── 设备列表 ── */
function DeviceList({ onBack }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/auth/sessions')
      .then(({ data }) => setSessions(data))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const removeSession = async (id) => {
    // 安全动作：仅在后端确实删除成功后才从 UI 移除，避免"已下线"的虚假安全感
    try {
      await axios.delete(`/api/auth/sessions/${id}`);
      setSessions(s => s.filter(x => x.id !== id));
    } catch (e) {
      showToast(e.response?.data?.error || '退出该设备失败，请重试', 'error');
    }
  };

  const removeAllSessions = async () => {
    if (!(await showConfirm('确定将此账号从其他所有设备退出？'))) return;
    try {
      await axios.delete('/api/auth/sessions');
      setSessions(s => s.filter(x => x.current));
    } catch (e) {
      showToast(e.response?.data?.error || '操作失败，请重试', 'error');
    }
  };

  const icon = (p = '') => {
    const pl = p.toLowerCase();
    if (pl.includes('windows')) return '🖥️';
    if (pl.includes('mac')) return '💻';
    if (pl.includes('iphone') || pl.includes('ipad') || pl.includes('android')) return '📱';
    return '🌐';
  };

  return (
    <PageBg>
      <PageHeader title="设备管理" onBack={onBack} />
      <div className="wc-device-pad">
        {loading ? (
          <div role="status" className="wc-loading">加载中…</div>
        ) : (
          <Card>
            {sessions.length === 0
              ? <div role="status" className="wc-empty">暂无设备记录</div>
              : sessions.map((s, i) => (
                <div key={s.id} className="wc-device-item">
                  <span className="wc-device-icon">{icon(s.platform)}</span>
                  <div className="wc-crow-body">
                    <div className="wc-device-name">{s.device || '未知设备'}</div>
                    <div className="wc-device-info">
                      {s.ip ? `${s.ip} · ` : ''}
                      {s.current ? '当前设备' : `最近活跃 ${new Date(s.last_seen * 1000).toLocaleDateString('zh-CN')}`}
                    </div>
                  </div>
                  {s.current
                    ? <span className="wc-badge-current">当前</span>
                    : <button className="wc-btn-exit" onClick={() => removeSession(s.id)}>退出</button>
                  }
                </div>
              ))
            }
          </Card>
        )}
        <div className="wc-device-hint">点击"退出"可远程下线该设备</div>
        {sessions.some(s => !s.current) && (
          <div className="wc-section-pad" style={{ marginTop: 8 }}>
            <button className="wc-btn-exit-all" onClick={removeAllSessions}>一键退出其他全部设备</button>
          </div>
        )}
      </div>
    </PageBg>
  );
}

/* ── 外观 ── */
function AppearanceSettings({ onBack }) {
  const { themeMode, setThemeMode, fontSize, setFontSize } = useSettings();
  const { lang, setLang } = useI18n();
  const FONT_OPTIONS = [
    { key: 'small',  label: '小',   size: 12 },
    { key: 'normal', label: '标准', size: 14 },
    { key: 'large',  label: '大',   size: 16 },
    { key: 'xlarge', label: '特大', size: 18 },
  ];
  return (
    <PageBg>
      <PageHeader title="外观" onBack={onBack} />
      <div className="wc-appearance-pad">
        <div className="wc-appearance-row">
          {[
            { label: '日间模式', mode: 'light', emoji: '☀️', bg: '#FFFFFF', border: '#E5E5EA', textColor: '#333' },
            { label: '夜间模式', mode: 'dark',  emoji: '🌙', bg: '#1C1C1E', border: '#48484A', textColor: '#EBEBF5' },
            { label: '跟随系统', mode: 'auto',  emoji: '🌗', bg: 'linear-gradient(105deg,#FFFFFF 50%,#1C1C1E 50%)', border: '#B0B4BC', textColor: '#888' },
          ].map(({ label, mode, emoji, bg, border, textColor }) => (
            <button key={mode} type="button"
              className="wc-appearance-btn"
              aria-pressed={themeMode === mode}
              style={{
                background: bg,
                border: `2.5px solid ${themeMode === mode ? 'var(--green)' : border}`,
                boxShadow: themeMode === mode ? '0 0 0 4px rgba(7,193,96,.15)' : '0 2px 8px rgba(0,0,0,.08)',
              }}
              onClick={() => setThemeMode(mode)}>
              <span className="wc-appearance-emoji">{emoji}</span>
              <span style={{ fontSize: 13.5, color: textColor, fontWeight: themeMode === mode ? 600 : 400 }}>{label}</span>
            </button>
          ))}
        </div>
      </div>
      <SLabel>字体大小</SLabel>
      <div className="wc-section-pad">
        <Card>
          <div className="wc-font-size-row">
            {FONT_OPTIONS.map(({ key, label, size }) => (
              <button key={key} type="button"
                className={`wc-font-btn${fontSize === key ? ' active' : ''}`}
                aria-pressed={fontSize === key}
                onClick={() => setFontSize(key)}>
                <span className="wc-font-preview" style={{ fontSize: size }}>A</span>
                <span className="wc-font-label">{label}</span>
              </button>
            ))}
          </div>
          <div className="wc-font-demo">
            <span style={{ fontSize: 'var(--font-msg, 14px)' }}>消息示例：今天天气真好！</span>
          </div>
        </Card>
      </div>
      <SLabel>语言</SLabel>
      <div className="wc-section-pad">
        <Card>
          {SUPPORTED_LANGS.map(({ code, name }) => (
            <CRow key={code} label={name} onClick={() => setLang(code)}
              right={lang === code ? <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--green)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> : null}
            />
          ))}
        </Card>
      </div>
    </PageBg>
  );
}

/* ── 通知 ── */
function NotificationSettings({ onBack }) {
  const { notifySound, setNotifySound } = useSettings();
  const [messageNotify, setMessageNotify] = useState(true);
  const [preview, setPreview]             = useState(true);
  const [vibrate, setVibrate]             = useState(false);
  const [saving, setSaving]               = useState(false);
  const [loaded, setLoaded]               = useState(false);

  // 初始化：从后端读取用户设置
  useEffect(() => {
    axios.get('/api/users/me/settings').then(r => {
      const s = r.data || {};
      setMessageNotify(s.message_notify !== 0);
      setPreview(s.detail_preview !== 0);
      setVibrate(s.vibrate === 1);
      // 同步 localStorage（向后兼容老版本）
      localStorage.setItem('wc_lock_screen', s.message_notify !== 0 ? '1' : '0');
      localStorage.setItem('wc_notify_preview', s.detail_preview !== 0 ? '1' : '0');
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const saveSettings = async (key, value) => {
    setSaving(true);
    try {
      await axios.put('/api/users/me/settings', { [key]: value ? 1 : 0 });
      localStorage.setItem(key === 'message_notify' ? 'wc_lock_screen' : 'wc_notify_preview', value ? '1' : '0');
    } catch {
      // 回滚 UI 状态
      if (key === 'message_notify') setMessageNotify(!value);
      else if (key === 'detail_preview') setPreview(!value);
      else if (key === 'vibrate') setVibrate(!value);
    }
    setSaving(false);
  };

  if (!loaded) return <PageBg><PageHeader title="通知设置" onBack={onBack} /></PageBg>;

  return (
    <PageBg>
      <PageHeader title="通知设置" onBack={onBack} />
      <SLabel>消息通知</SLabel>
      <div className="wc-notif-pad">
        <Card>
          <CRow label="锁屏通知" desc="关闭后不会收到消息推送"
            right={<Toggle checked={messageNotify} onChange={v => { setMessageNotify(v); saveSettings('message_notify', v); }} disabled={saving} />} />
          <CRow label="消息详情预览" desc={'关闭后通知只显示"收到新消息"'}
            right={<Toggle checked={preview} onChange={v => { setPreview(v); saveSettings('detail_preview', v); }} disabled={saving} />} />
          <CRow label="通知声音"
            right={<Toggle checked={notifySound} onChange={setNotifySound} />} />
          <CRow label="通知震动"
            right={<Toggle checked={vibrate} onChange={v => { setVibrate(v); saveSettings('vibrate', v); }} disabled={saving} />} />
        </Card>
      </div>
    </PageBg>
  );
}

/* ── 隐私与安全 ── */
function PrivacySettings({ user, onBack }) {
  const [page, setPage] = useState('main');
  const [settings, setSettings] = useState({
    addByVxinId: true, addByPhone: true, addByQRCode: true, addByUsername: true, requireVerify: true,
  });

  useEffect(() => {
    axios.get('/api/users/me/settings')
      .then(({ data }) => setSettings(s => ({ ...s, ...data })))
      .catch(() => {});
  }, []);

  const setFlag = async (key, value) => {
    const prev = settings[key];
    setSettings(s => ({ ...s, [key]: value }));
    try {
      const { data } = await axios.put('/api/users/me/settings', { [key]: value });
      setSettings(s => ({ ...s, ...data }));
    } catch {
      setSettings(s => ({ ...s, [key]: prev }));
    }
  };

  if (page === 'change-password') return <ChangePassword onBack={() => setPage('main')} />;

  if (page === 'add-methods') return (
    <PageBg>
      <PageHeader title="添加我的方式" onBack={() => setPage('main')} />
      <div className="wc-privacy-outer">
        <div className="wc-privacy-desc">允许他人通过以下方式添加我</div>
        <Card>
          <CRow label="ID号" desc={user?.wechat_id ? `v信号: ${user.wechat_id}` : '未分配'}
            right={<Toggle checked={settings.addByVxinId} onChange={v => setFlag('addByVxinId', v)} />} />
          <CRow label="手机号" desc={user?.phone || ''}
            right={<Toggle checked={settings.addByPhone} onChange={v => setFlag('addByPhone', v)} />} />
          <CRow label="二维码"
            right={<Toggle checked={settings.addByQRCode} onChange={v => setFlag('addByQRCode', v)} />} />
          <CRow label="用户名"
            right={<Toggle checked={settings.addByUsername} onChange={v => setFlag('addByUsername', v)} />} />
        </Card>
      </div>
    </PageBg>
  );

  return (
    <PageBg>
      <PageHeader title="隐私与安全" onBack={onBack} />
      <div className="wc-privacy-outer">
        <Card className="wc-privacy-card-mt">
          <CRow label="添加我的方式" desc="ID号、手机号、二维码、用户名" onClick={() => setPage('add-methods')} />
          <CRow label="需要验证才能添加好友" desc="关闭后对方可直接添加你"
            right={<Toggle checked={settings.requireVerify} onChange={v => setFlag('requireVerify', v)} />} />
        </Card>
        <Card className="wc-privacy-card-mt">
          <CRow label="修改密码" desc="定期修改可提升账号安全" onClick={() => setPage('change-password')} />
        </Card>
      </div>
    </PageBg>
  );
}

/* ── 注销账号 ── */
function DeleteAccount({ onBack, logout }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (loading) return; // 防连点：确认弹窗是异步的，避免重复弹出/提交
    if (!password) { setError('请输入密码'); return; }
    if (!(await showConfirm('注销后所有数据将清除，且无法恢复。确认注销？'))) return;
    setLoading(true);
    setError('');
    try {
      await axios.post('/api/auth/delete-account', { password });
      doLogout(logout);
    } catch (err) {
      setError(err.response?.data?.error || '注销失败，请重试');
      setLoading(false);
    }
  };

  return (
    <PageBg>
      <PageHeader title="注销账号" onBack={onBack} />
      <div className="wc-section-pad">
        <div style={{ padding: '16px 0 8px', fontSize: 14, color: 'var(--color-badge)', lineHeight: 1.6 }}>
          注销后您的账号信息将被清除，无法登录，且此操作不可撤销。
        </div>
      </div>
      <div className="wc-section-pad">
        <Card>
          <div style={{ padding: '12px 16px' }}>
            <input
              type="password"
              placeholder="请输入当前密码确认"
              aria-label="当前密码"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              className="wc-server-input"
              style={{ marginTop: 0 }}
            />
            {error && <div role="alert" style={{ color: 'var(--color-badge)', fontSize: 13, marginTop: 6 }}>{error}</div>}
          </div>
        </Card>
      </div>
      <div className="wc-section-pad">
        <button
          className="wc-logout-btn"
          style={{ background: 'var(--color-badge)', width: '100%' }}
          onClick={handleDelete}
          disabled={loading}>
          {loading ? '注销中…' : '确认注销账号'}
        </button>
      </div>
    </PageBg>
  );
}

/* ── 账号切换栏（多账号） ── */
function AccountSwitcher({ user, accounts, login, switchAccount }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ phone: '', password: '' });
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const phoneRef = useRef(null);

  const doSwitch = (id) => {
    if (id === user?.id) return;
    if (switchAccount(id)) window.location.reload();
  };

  const doAdd = async (e) => {
    e.preventDefault();
    if (!form.phone || !form.password) { setError('请填写手机号和密码'); return; }
    setError(''); setLoading(true);
    try {
      const { data } = await axios.post('/api/auth/login', form);
      login(data.user, data.token); // 必须传 token:Bearer端(Electron/移动)漏传会清掉鉴权头→reload后被登出
      window.location.reload();
    } catch (err) {
      setError(err.response?.data?.error || '手机号或密码错误');
      setLoading(false);
    }
  };

  const toggleForm = () => {
    setShowForm(v => !v);
    setError('');
    setForm({ phone: '', password: '' });
    if (!showForm) setTimeout(() => phoneRef.current?.focus(), 80);
  };

  /* 只显示非当前账号 */
  const otherAccounts = accounts.filter(a => a.id !== user?.id);

  return (
    <Card>
      {otherAccounts.map((a) => (
          <div key={a.id} onClick={() => doSwitch(a.id)} className="wc-add-row" role="button" tabIndex={0} onKeyDown={activateOnKey(() => doSwitch(a.id))}>
            <div className="wc-add-avatar-wrap">
              <Avatar src={a.user?.avatar} name={a.user?.username} size={40} />
            </div>
            <div className="wc-crow-body">
              <div className="wc-add-name">{a.user?.username || '未命名'}</div>
              {a.user?.phone && <div className="wc-add-phone">{a.user.phone}</div>}
            </div>
            <span className="wc-add-switch">切换</span>
          </div>
      ))}

      <div onClick={toggleForm} className="wc-add-row" role="button" tabIndex={0} onKeyDown={activateOnKey(toggleForm)}>
        <div className="wc-add-icon-wrap" style={{ borderColor: showForm ? 'var(--green)' : undefined }}>
          <svg className="wc-add-icon-svg" style={{ fill: showForm ? 'var(--green)' : undefined }} viewBox="0 0 24 24">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        </div>
        <span className="wc-add-label" style={{ color: showForm ? 'var(--green)' : undefined }}>添加账户</span>
        <svg className="wc-add-chevron" style={{ transform: showForm ? 'rotate(90deg)' : undefined }} viewBox="0 0 24 24">
          <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
        </svg>
      </div>

      {showForm && (
        <div className="wc-add-form">
          <div className="wc-add-info">
            <span className="wc-add-info-text">添加后旧账号不会退出，可随时切换</span>
          </div>
          <form onSubmit={doAdd} className="wc-add-form-inner">
            <input ref={phoneRef} type="tel" placeholder="手机号" aria-label="手机号" value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className="wc-add-form-input" />
            <input type="password" placeholder="密码" aria-label="密码" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="wc-add-form-input" />
            {error && <div className="wc-add-form-error" role="alert">{error}</div>}
            <button type="submit" disabled={loading} className="wc-add-form-submit">
              {loading ? '登录中…' : '登录并切换'}
            </button>
          </form>
        </div>
      )}
    </Card>
  );
}

async function doLogout(logout) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      await axios.delete('/api/notifications/web-subscribe', { data: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch {}
  logout();
  goLogin();
}

/* ── 个人资料详情页 ── */
function ProfileDetail({ user, updateUser, onBack, navigateTo }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleAvatarClick = () => {
    fileRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!ALLOWED.includes(file.type)) {
      showToast('仅支持 JPG、PNG、GIF、WebP 格式', 'error');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('图片大小不能超过 5MB', 'error');
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const { data } = await axios.post('/api/users/avatar', fd);
      if (data?.avatar) {
        updateUser({ ...user, avatar: data.avatar });
      }
    } catch (err) {
      showToast(err.response?.data?.error || '头像上传失败，请重试', 'error');
    } finally {
      e.target.value = ''; // 允许再次选择同一文件重试
    }
    setUploading(false);
  };

  return (
    <PageBg>
      <PageHeader title="个人资料" onBack={onBack} />
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
      <div className="wc-section-pad">
        <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px', gap: 8 }}>
          <div role="button" tabIndex={0} onClick={handleAvatarClick} onKeyDown={activateOnKey(handleAvatarClick)} style={{ cursor: 'pointer', position: 'relative' }}>
            <Avatar src={user?.avatar} name={user?.username} size={80} />
            {uploading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', borderRadius: 14, color: 'var(--text-inverse)', fontSize: 12 }}>上传中</div>}
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{user?.username || '未设置昵称'}</div>
          <div style={{ fontSize: 13, color: 'var(--green)' }}>点击更换头像</div>
        </Card>
      </div>
      <div className="wc-section-pad">
        <Card>
          <CRow label="昵称" value={user?.username || ''} onClick={() => navigateTo?.('edit-name')} />
          <CRow label="个性签名" value={user?.bio || '未设置'} onClick={() => navigateTo?.('edit-bio')} />
        </Card>
      </div>
      <SLabel>账号信息</SLabel>
      <div className="wc-section-pad">
        <Card>
          <CRow label="v信号" value={user?.wechat_id || ''} />
          <CRow label="手机号" value={user?.phone || ''} />
        </Card>
      </div>
    </PageBg>
  );
}

/* ── 设置总览页（二级） ── */
function ServerSettings({ onBack }) {
  const { changeServer } = useAuth();
  const currentUrl = localStorage.getItem('vxin_server_url') || axios.defaults.baseURL || '';
  const [input, setInput] = useState(currentUrl);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const testConn = async () => {
    const url = input.trim().replace(/\/$/, '');
    if (!url.startsWith('http')) { setTestResult({ ok: false, msg: '格式错误，请以 http:// 或 https:// 开头' }); return; }
    setTesting(true); setTestResult(null);
    try {
      await fetch(`${url}/health`, { signal: AbortSignal.timeout(6000) });
      setTestResult({ ok: true, msg: '连接成功 ✓' });
    } catch {
      setTestResult({ ok: false, msg: '无法连接到该服务器，请检查地址' });
    } finally { setTesting(false); }
  };

  const handleSave = async () => {
    const url = input.trim().replace(/\/$/, '');
    if (!url.startsWith('http')) return;
    setSaving(true);
    await changeServer(url);
    setSaving(false);
  };

  return (
    <PageBg>
      <PageHeader title="服务器地址" onBack={onBack} />
      <div className="wc-server-pad">
        <div className="wc-server-label">服务器地址（支持 IP 或域名）</div>
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setTestResult(null); }}
          placeholder="https://example.com"
          aria-label="服务器地址"
          className="wc-server-input"
        />
        {testResult && (
          <div role="status" style={{ marginTop: 8, fontSize: 13, color: testResult.ok ? 'var(--green)' : 'var(--color-badge)' }}>
            {testResult.msg}
          </div>
        )}
      </div>
      <div className="wc-server-btn-row">
        <button onClick={testConn} disabled={testing} className="wc-btn-test">
          {testing ? '检测中…' : '测试连接'}
        </button>
        <button onClick={handleSave} disabled={saving || !input.trim().startsWith('http')} className="wc-btn-save">
          {saving ? '切换中…' : '保存并切换'}
        </button>
      </div>
      <div className="wc-server-hint">
        <div className="wc-server-hint-box">
          切换服务器后当前账号会自动退出，用新服务器的账号重新登录即可，无需重装客户端。
        </div>
      </div>
    </PageBg>
  );
}

function SettingsPage({ user, setSubPage, logout }) {
  return (
    <PageBg>
      <PageHeader title="设置" onBack={() => setSubPage(null)} />

      {/* 设备与安全 */}
      <SLabel>设备与安全</SLabel>
      <div className="wc-section-pad">
        <Card>
          <CRow icon={<IcoDesktop />} bg="#8A93A6" label="设备管理" desc="查看同时登录的设备" onClick={() => setSubPage('devices')} />
          <CRow icon={<IcoShield />} bg="#8A93A6" label="隐私与安全" desc="添加方式和好友权限" onClick={() => setSubPage('privacy')} />
        </Card>
      </div>

      {/* 偏好设置 */}
      <SLabel>偏好设置</SLabel>
      <div className="wc-section-pad">
        <Card>
          <CRow icon={<IcoMoon />} bg="#8A93A6" label="外观" desc="主题与字体大小" onClick={() => setSubPage('appearance')} />
          <CRow icon={<IcoBell />} bg="#8A93A6" label="通知" desc="锁屏通知和声音" onClick={() => setSubPage('notifications')} />
        </Card>
      </div>

      {/* 服务器 — 仅桌面端 */}
      {window.__ELECTRON_CONFIG__ && (
        <>
          <SLabel>连接</SLabel>
          <div className="wc-section-pad">
            <Card>
              <CRow icon={<IcoServer />} bg="#8A93A6" label="服务器地址"
                desc={(localStorage.getItem('vxin_server_url') || '').replace(/^https?:\/\//, '') || '远程配置'}
                onClick={() => setSubPage('server')} />
            </Card>
          </div>
        </>
      )}

      {/* 账号操作 */}
      <div className="wc-logout-div">
        <button className="wc-logout-btn" onClick={() => doLogout(logout)}>退出登录</button>
        <button className="wc-delete-account-btn" onClick={() => setSubPage('delete-account')}>注销账号</button>
      </div>
    </PageBg>
  );
}

/* ── 主页面 ── */
export default function Profile({ isMobile = false }) {
  const { user, updateUser, logout, accounts, login, switchAccount } = useAuth();
  const [subPage, setSubPage] = useState(null);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    if (!showQR) return;
    const handler = e => { if (e.key === 'Escape') setShowQR(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showQR]);

  /* ── 子页 ── */
  if (subPage === 'profile-detail') return <ProfileDetail user={user} updateUser={updateUser} onBack={() => setSubPage(null)} navigateTo={setSubPage} />;
  if (subPage === 'edit-name')     return <EditName user={user} updateUser={updateUser} onBack={() => setSubPage(null)} />;
  if (subPage === 'edit-bio')      return <EditBio user={user} updateUser={updateUser} onBack={() => setSubPage(null)} />;
  if (subPage === 'wallet')        return <Wallet onBack={() => setSubPage(null)} />;
  if (subPage === 'invite')        return <InviteFriends onBack={() => setSubPage(null)} />;
  if (subPage === 'devices')       return <DeviceList onBack={() => setSubPage(null)} />;
  if (subPage === 'appearance')    return <AppearanceSettings onBack={() => setSubPage(null)} />;
  if (subPage === 'notifications') return <NotificationSettings onBack={() => setSubPage(null)} />;
  if (subPage === 'privacy')       return <PrivacySettings user={user} onBack={() => setSubPage(null)} />;
  if (subPage === 'server')        return <ServerSettings onBack={() => setSubPage(null)} />;
  if (subPage === 'delete-account') return <DeleteAccount onBack={() => setSubPage(null)} logout={logout} />;

  return (
    <PageBg>
      {/* ── 个人信息头部 ── */}
      <div className="wc-me-header" role="button" tabIndex={0} onClick={() => setSubPage('profile-detail')} onKeyDown={activateOnKey(() => setSubPage('profile-detail'))}>
        <div className="wc-me-avatar-wrap">
          <Avatar src={user?.avatar} name={user?.username} size={64} />
        </div>
        <div className="wc-me-info">
          <div className="wc-me-name">{user?.username || '未设置昵称'}</div>
          {user?.wechat_id && <div className="wc-me-vid">v信号：{user.wechat_id}</div>}
          {user?.bio && <div className="wc-me-bio">{user.bio}</div>}
        </div>
        <div className="wc-me-actions">
          <button className="wc-me-qr-btn" onClick={e => { e.stopPropagation(); setShowQR(true); }} title="我的二维码" aria-label="我的二维码">
            <IcoQR />
          </button>
          <ChevronRight />
        </div>
      </div>

      {/* ── 二维码弹窗 ── */}
      {showQR && (
        <div className="wc-modal-overlay" onClick={() => setShowQR(false)}>
          <div className="wc-modal home-qr-modal" role="dialog" aria-modal="true" aria-label="我的二维码" onClick={e => e.stopPropagation()}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">我的二维码</span>
              <button className="wc-modal-close" onClick={() => setShowQR(false)} aria-label="关闭">✕</button>
            </div>
            <div className="wc-modal-body home-qr-body">
              <AuthImage src="/api/users/me/qrcode" alt="我的二维码" className="home-qr-img" />
              <p className="home-qr-text">扫描二维码添加我为好友</p>
            </div>
          </div>
        </div>
      )}

      {/* ── 钱包 ── */}
      <div className="wc-section-pad">
        <Card>
          <CRow icon={<Ico d="M21 7H3a1 1 0 00-1 1v9a2 2 0 002 2h14a2 2 0 002-2v-2h-7a2 2 0 010-4h7V8a1 1 0 00-1-1zm-4 6h5v2h-5a1 1 0 010-2zM3 5h13a1 1 0 010 2H3a1 1 0 010-2z" />}
            bg="#F0A020" label="钱包" desc="金币余额与交易记录" onClick={() => setSubPage('wallet')} />
          <CRow icon={<Ico d="M16 11a4 4 0 10-4-4 4 4 0 004 4zm0 2c-3 0-8 1.5-8 4.5V20h12v-1a5.8 5.8 0 00-.3-1.8M6 8V5M4.5 6.5h3" />}
            bg="#07C160" label="邀请好友" desc="我的专属邀请码与邀请战绩" onClick={() => setSubPage('invite')} />
        </Card>
      </div>

      {/* ── 设备与安全 ── */}
      <SLabel>设备与安全</SLabel>
      <div className="wc-section-pad">
        <Card>
          <CRow icon={<IcoDesktop />} bg="#8A93A6" label="设备管理" desc="查看同时登录的设备" onClick={() => setSubPage('devices')} />
          <CRow icon={<IcoShield />}  bg="#8A93A6" label="隐私与安全" desc="添加方式和好友权限" onClick={() => setSubPage('privacy')} />
        </Card>
      </div>

      {/* ── 偏好设置 ── */}
      <SLabel>偏好设置</SLabel>
      <div className="wc-section-pad">
        <Card>
          <CRow icon={<IcoMoon />} bg="#8A93A6" label="外观"  desc="日间和夜间模式"   onClick={() => setSubPage('appearance')} />
          <CRow icon={<IcoBell />} bg="#8A93A6" label="通知"  desc="锁屏通知和声音"   onClick={() => setSubPage('notifications')} />
        </Card>
      </div>

      {/* ── 服务器（仅桌面端） ── */}
      {window.__ELECTRON_CONFIG__ && (
        <>
          <SLabel>连接</SLabel>
          <div className="wc-section-pad">
            <Card>
              <CRow icon={<IcoServer />} bg="#8A93A6" label="服务器地址"
                desc={(localStorage.getItem('vxin_server_url') || '').replace(/^https?:\/\//, '') || '远程配置'}
                onClick={() => setSubPage('server')} />
            </Card>
          </div>
        </>
      )}

      {/* ── 账号管理（仅手机端：桌面端侧边栏已有账号切换器） ── */}
      {isMobile && (
        <>
          <SLabel>账号</SLabel>
          <div className="wc-section-pad">
            <AccountSwitcher user={user} accounts={accounts} login={login} switchAccount={switchAccount} />
          </div>
        </>
      )}

      {/* ── 退出 ── */}
      <div className="wc-logout-div">
        <button className="wc-logout-btn" onClick={() => doLogout(logout)}>退出登录</button>
        <button className="wc-delete-account-btn" onClick={() => setSubPage('delete-account')}>注销账号</button>
      </div>
    </PageBg>
  );
}
