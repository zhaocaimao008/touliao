import React, { useState, useEffect, useCallback, useRef } from 'react';
import { showConfirm } from '../utils/toast';
import axios from 'axios';
import ChatList from '../components/ChatList';
import ChatWindow from '../components/ChatWindow';
import ErrorBoundary from '../components/ErrorBoundary';
import ChatWindowBoundary from '../components/ChatWindowBoundary';
import ContactList from '../components/ContactList';
import Profile from '../components/Profile';
import Moments from '../components/Moments';
import CallHistory from '../components/CallHistory';
import Collections from '../components/Collections';
import GlobalSearch from '../components/GlobalSearch';
import AddFriendModal from '../components/AddFriendModal';
import Avatar from '../components/Avatar';
import AuthImage from '../components/AuthImage';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { usePushNotification } from '../hooks/usePushNotification';
import { mediaUrl, goLogin } from '../utils/url';

function WcEmpty() {
  return (
    <div className="we-empty">
      <svg className="we-empty-svg" viewBox="0 0 80 64">
        <rect x="4" y="8" width="50" height="34" rx="8" fill="#EEF2F8"/>
        <rect x="8" y="15" width="30" height="3" rx="1.5" fill="#B8C4D4"/>
        <rect x="8" y="22" width="22" height="3" rx="1.5" fill="#B8C4D4"/>
        <rect x="8" y="29" width="26" height="3" rx="1.5" fill="#B8C4D4"/>
        <path d="M4 42l8-8" stroke="#EEF2F8" strokeWidth="2"/>
        <circle cx="60" cy="46" r="16" fill="#1A2033"/>
        <path d="M53 46l5 5 9-9" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <p className="we-empty-title">选择一个会话开始聊天</p>
      <p className="we-empty-desc">安全、高效的企业级通讯</p>
    </div>
  );
}

/* ── SVG Icons ── */
const IcoChat = () => (
  <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>
);
const IcoContacts = () => (
  <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
);
const IcoSearch = () => (
  <svg className="ico-sm" viewBox="0 0 24 24">
    <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
  </svg>
);
const IcoQR = () => (
  <svg className="ico-md" viewBox="0 0 24 24">
    <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM13 13h2v2h-2zM15 15h2v2h-2zM13 17h2v2h-2zM17 13h2v2h-2zM19 15h2v2h-2zM17 17h2v2h-2zM19 19h2v2h-2zM15 19h2v2h-2z"/>
  </svg>
);
const IcoAdd = () => (
  <svg className="ico-md" viewBox="0 0 24 24">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
  </svg>
);
const IcoAddAccount = () => (
  <svg viewBox="0 0 24 24"><path d="M13 8c0-2.21-1.79-4-4-4S5 5.79 5 8s1.79 4 4 4 4-1.79 4-4zm-2 0c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-4 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm8 0v3h3v3h2v-3h3v-2h-3v-3h-2v3h-3z"/></svg>
);
const IcoSettings = () => (
  <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.03-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
);

const IcoMoments = () => (
  <svg viewBox="0 0 24 24"><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>
);
const IcoCall = () => (
  <svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
);
const IcoStar = () => (
  <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
);

const TABS = [
  { key: 'chats',     Icon: IcoChat,     label: '消息' },
  { key: 'contacts',  Icon: IcoContacts, label: '通讯录' },
  { key: 'moments',   Icon: IcoMoments,  label: '朋友圈', feature: 'moments' },
  { key: 'calls',     Icon: IcoCall,     label: '通话' },
  { key: 'favorites', Icon: IcoStar,     label: '收藏',   feature: 'collect' },
  { key: 'settings',  Icon: IcoSettings, label: '设置' },
];

// 朋友圈 / 通话记录 / 收藏：功能代码保留，暂在前端隐藏。
// 需恢复入口时把对应 key 从此集合移除即可。
const HIDDEN_TABS = new Set(['moments', 'calls', 'favorites']);
const visibleTabs = (features) =>
  TABS.filter(t => !HIDDEN_TABS.has(t.key) && (!t.feature || features[t.feature] !== false));


/* ── 左上角头像 — 点击展开账号切换/添加下拉面板 ── */
function AccountSwitcher() {
  const { user, accounts, login, switchAccount, removeAccount, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [form, setForm] = useState({ phone: '', password: '' });
  const [switchTarget, setSwitchTarget] = useState(null); // 非空=正在切换到某个已登录账号(显示其昵称)
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const phoneRef = useRef(null);
  const passwordRef = useRef(null);
  const containerRef = useRef(null);
  const letter = (user?.username || '?')[0].toUpperCase();

  /* 点外部关闭，不用全屏遮罩（遮罩会挡住头像按钮本身） */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) { setShowForm(false); setErr(''); setForm({ phone: '', password: '' }); setSwitchTarget(null); }
  }, [open]);

  // 切换账号：优先丝滑切换（后端凭 wallet cookie 免密重签发）。
  // 仅当本设备没切换凭证（如缓存被清/换了浏览器/旧会话）才回退到密码登录。
  const [switching, setSwitching] = useState(false);
  const doSwitch = async (id) => {
    if (id === user?.id || switching) return;
    const acct = accounts.find(a => a.id === id);
    if (!acct) return;
    setErr(''); setSwitching(true);
    try {
      await switchAccount(id);   // 成功会 reload
    } catch (ex) {
      // 免密切换不可用 → 回退：填入手机号，要求输密码
      setSwitching(false);
      setSwitchTarget(acct.user || null);
      setForm({ phone: acct.user?.phone || '', password: '' });
      setShowForm(true);
      setTimeout(() => passwordRef.current?.focus(), 80);
    }
  };

  // 删除账号：当前账号→退出登录；其他账号→从本设备移除(最近登录+免密切换凭证)
  const doRemove = async (e, id) => {
    e.stopPropagation();
    const acct = accounts.find(a => a.id === id);
    const name = acct?.user?.username || '该账号';
    if (id === user?.id) {
      if (!(await showConfirm(`退出当前账号「${name}」？`))) return;
      await logout();                 // 清会话+CSRF+从钱包移除当前账号
      goLogin();
    } else {
      if (!(await showConfirm(`从本设备删除账号「${name}」？删除后切换需重新输密码。`))) return;
      removeAccount(id);              // 移除最近登录记录 + 钱包凭证
    }
  };

  const doAdd = async (e) => {
    e.preventDefault();
    if (!form.phone || !form.password) { setErr('请填写手机号和密码'); return; }
    setErr(''); setSubmitting(true);
    try {
      const { data } = await axios.post('/api/auth/login', form);
      login(data.user);
      window.location.reload();
    } catch (ex) {
      setErr(ex.response?.data?.error || '手机号或密码错误');
      setSubmitting(false);
    }
  };

  const toggleForm = (e) => {
    e.stopPropagation();
    setShowForm(v => !v);
    setErr('');
    setSwitchTarget(null);   // 走"添加账户"入口，不是切换
    setForm({ phone: '', password: '' });
    if (!showForm) setTimeout(() => phoneRef.current?.focus(), 80);
  };

  return (
    <div ref={containerRef} className="as-container">
      {/* 头像按钮 */}
      <div className="as-avatar-btn" onClick={() => setOpen(v => !v)} title="账号切换">
        <div className="as-avatar-inner"
          style={{ outlineColor: open ? 'rgba(255,255,255,.9)' : 'transparent' }}>
          {user?.avatar
            ? <img src={mediaUrl(user.avatar)} alt="" loading="lazy" className="as-avatar-img" />
            : letter
          }
        </div>
      </div>

      {/* 下拉面板（fixed 定位，不受 sidebar overflow 影响） */}
      {open && (
        <div className="as-dropdown">

          {/* 账号列表 */}
          {accounts.map((a) => {
            const active = a.id === user?.id;
            return (
              <div key={a.id} onClick={() => { if (!active) doSwitch(a.id); }}
                className={`wc-account-row${active ? ' active' : ''}`}
                role="button" tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && !active && doSwitch(a.id)}>
                <div className="as-avatar-wrap">
                  <Avatar src={a.user?.avatar} name={a.user?.username} size={38} />
                  {active && (
                    <div className="as-active-badge">
                      <svg className="as-check-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    </div>
                  )}
                </div>
                <div className="as-name-wrap">
                  <div className={`as-name${active ? ' active' : ''}`}>
                    {a.user?.username || '未命名'}
                  </div>
                  {a.user?.phone && <div className="as-phone">{a.user.phone}</div>}
                </div>
                {active
                  ? <span className="as-current-badge">当前</span>
                  : <span className="as-switch-text">切换</span>
                }
                {/* 删除/退出账号 */}
                <button
                  onClick={(e) => doRemove(e, a.id)}
                  title={active ? '退出登录' : '从本设备删除'}
                  className="as-remove-btn">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              </div>
            );
          })}

          {/* 添加账户行 */}
          <div onClick={toggleForm}
            className={`wc-add-row${showForm ? ' open' : ''}`}
            role="button" tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && toggleForm(e)}>
            <div className={`wc-add-icon-wrap${showForm ? ' open' : ''}`}>
              <svg viewBox="0 0 24 24" className={`wc-add-icon-svg${showForm ? ' open' : ''}`}>
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
            </div>
            <span className={`wc-add-label${showForm ? ' open' : ''}`}>添加账户</span>
            <svg viewBox="0 0 24 24" className={`wc-add-chevron${showForm ? ' open' : ''}`}>
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
            </svg>
          </div>

          {/* 登录表单：切换已有账号 或 添加新账号 */}
          {showForm && (
            <div className="as-form-pad">
              <div className="wc-add-info">
                <span className="wc-add-info-text">
                  {switchTarget
                    ? `切换到「${switchTarget.username || '该账号'}」，请输入密码`
                    : '添加后旧账号不会退出，可随时切换'}
                </span>
              </div>
              <form onSubmit={doAdd} className="wc-add-form-inner">
                <input ref={phoneRef} type="tel" placeholder="手机号" value={form.phone}
                  readOnly={!!switchTarget}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="wc-add-form-input"
                  aria-label="手机号"
                  style={{ background: switchTarget ? 'var(--bg-panel, #f0f0f0)' : 'var(--bg-search)', color: switchTarget ? 'var(--text-secondary)' : 'var(--text-primary)' }} />
                <input ref={passwordRef} type="password" placeholder="密码" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="wc-add-form-input"
                  aria-label="密码" />
                {err && <div className="wc-add-form-error" role="alert">{err}</div>}
                <button type="submit" disabled={submitting}
                  className="wc-add-form-submit">
                  {submitting ? '登录中...' : (switchTarget ? '登录并切换' : '登录并添加')}
                </button>
              </form>
            </div>
          )}

          {/* 个人资料卡片 */}
          <div onClick={() => setShowProfile(v => !v)}
            className="as-profile-row"
            role="button" tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && setShowProfile(v => !v)}>
            <svg className="as-profile-icon" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            <span className="as-profile-label">个人资料</span>
            <svg viewBox="0 0 24 24" className={`as-profile-arrow${showProfile ? ' open' : ''}`}>
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
            </svg>
          </div>

          {/* 资料详情（展开时显示） */}
          {showProfile && (
            <div className="as-profile-detail">
              {/* v信号 */}
              {user?.wechat_id && (
                <div className="as-profile-item">
                  <span className="as-profile-label-text">v信号</span>
                  <span className="as-profile-value">{user.wechat_id}</span>
                </div>
              )}
              {/* 手机号 */}
              {user?.phone && (
                <div className="as-profile-item">
                  <span className="as-profile-label-text">手机号</span>
                  <span className="as-profile-value">{user.phone}</span>
                </div>
              )}
              {/* 二维码 */}
              {user?.id && (
                <div className="as-qr-section">
                  <div className="as-qr-label">二维码</div>
                  <div className="as-qr-content">
                    <AuthImage src="/api/users/me/qrcode" alt="我的二维码" className="as-qr-img" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 群成员行（带 hover） ── */
function CgMemberRow({ contact: c, checked, onToggle }) {
  return (
    <div onClick={onToggle}
      className="cg-row">
      <div className={`cg-checkbox${checked ? ' checked' : ''}`}>
        {checked && <svg className="cg-check-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
      </div>
      <Avatar src={c.avatar} name={c.remark || c.username} size={40} className="as-avatar-img" />
      <div className="cg-info">
        <div className={`cg-name${checked ? ' checked' : ''}`}>{c.remark || c.username}</div>
        {c.remark && <div className="cg-username">{c.username}</div>}
      </div>
    </div>
  );
}

/* ── Create Group Modal ── */
function CreateGroupModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef(null);

  useEffect(() => {
    axios.get('/api/users/contacts').then(r => setContacts(r.data)).catch(() => {});
    setTimeout(() => nameRef.current?.focus(), 80);
  }, []);

  const toggle = (id) => setSelected(prev => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  const create = async () => {
    if (!name.trim()) { setError('请输入群名称'); return; }
    if (selected.size === 0) { setError('请至少选择一位成员'); return; }
    setLoading(true); setError('');
    try {
      const { data } = await axios.post('/api/messages/conversation/group', { name: name.trim(), memberIds: [...selected] });
      onCreated({ id: data.conversationId, type: 'group', name: name.trim(), avatar: '', members: [] });
    } catch (err) {
      setError(err.response?.data?.error || '创建失败，请重试');
      setLoading(false);
    }
  };

  const filtered = contacts.filter(c => {
    if (!contactSearch.trim()) return true;
    const q = contactSearch.toLowerCase();
    return (c.remark || c.username || '').toLowerCase().includes(q);
  });

  const selectedContacts = contacts.filter(c => selected.has(c.id));

  return (
    <div className="cgm-overlay"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="cgm-content"
        onClick={e => e.stopPropagation()}>

        {/* 标题栏 */}
        <div className="cgm-header">
          <span className="cgm-title">发起群聊</span>
          <button onClick={onClose} className="cgm-close" aria-label="关闭">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        {/* 群名称输入 */}
        <div className="cgm-name-section">
          <div className="cgm-name-label">群名称</div>
          <input
            ref={nameRef}
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="请输入群名称"
            aria-label="群名称"
            maxLength={30}
            className="cgm-name-input"
          />
        </div>

        {/* 已选成员 chips */}
        {selectedContacts.length > 0 && (
          <div className="cgm-chips">
            {selectedContacts.map(c => (
              <div key={c.id} onClick={() => toggle(c.id)}
                className="cgm-chip">
                <Avatar src={c.avatar} name={c.remark || c.username} size={20} className="as-avatar-img" />
                <span className="cgm-chip-text">{c.remark || c.username}</span>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="var(--green)"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </div>
            ))}
          </div>
        )}

        {/* 联系人搜索 */}
        <div className="cgm-search-bar">
          <svg className="cgm-search-icon" viewBox="0 0 24 24">
            <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            value={contactSearch}
            onChange={e => setContactSearch(e.target.value)}
            placeholder="搜索联系人"
            aria-label="搜索联系人"
            className="cgm-search-input"
          />
        </div>

        {/* 联系人列表 */}
        <div className="cgm-member-count">
          选择成员（已选 {selected.size} 人）
        </div>
        <div className="cgm-contact-list">
          {filtered.length === 0 && (
            <div className="cgm-empty">
              {contacts.length === 0 ? '暂无联系人' : '未找到相关联系人'}
            </div>
          )}
          {filtered.map(c => {
            const isChecked = selected.has(c.id);
            return (
              <CgMemberRow key={c.id} contact={c} checked={isChecked} onToggle={() => toggle(c.id)} />
            );
          })}
        </div>

        {/* 底部操作 */}
        <div className="cgm-footer">
          {error && (
            <div className="cgm-error" role="alert">
              {error}
            </div>
          )}
          <div className="cgm-btn-row">
            <button onClick={onClose}
              className="cgm-cancel">
              取消
            </button>
            <button onClick={create} disabled={loading || selected.size === 0}
              className="cgm-create">
              {loading ? '创建中…' : `创建群聊${selected.size > 0 ? `（${selected.size}人）` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState('chats');
  const [features, setFeatures] = useState({ moments: true, collect: true });
  const [netSearchQ, setNetSearchQ] = useState(null); // null=关闭；字符串=带词打开网络搜索
  const [activeConv, setActiveConv] = useState(null);
  const [unread, setUnread] = useState({});
  const [friendReqCount, setFriendReqCount] = useState(0);
  const [search, setSearch] = useState('');
  const [showQR, setShowQR] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [addFriendRequest, setAddFriendRequest] = useState(0);
  const { socket, reconnectCount, registerUnreadCleared } = useSocket();
  const { user, updateUser } = useAuth();
  usePushNotification(user);
  const activeConvIdRef = useRef(null);
  const addBtnRef = useRef(null);
  useEffect(() => { activeConvIdRef.current = activeConv?.id ?? null; }, [activeConv?.id]);

  useEffect(() => {
    const handler = (e) => {
      const { conversationId } = e.detail || {};
      if (!conversationId) return;
      axios.get('/api/messages/conversations').then(r => {
        const conv = r.data.find(c => c.id === conversationId);
        if (conv) handleSelectConv(conv);
      }).catch(() => {});
    };
    window.addEventListener('vxin:open-conversation', handler);
    return () => window.removeEventListener('vxin:open-conversation', handler);
  }, []);

  useEffect(() => {
    axios.get('/api/users/friend-requests').then(r => setFriendReqCount(r.data.length));
  }, []);

  // 功能开关：后台可隐藏朋友圈/收藏。若当前所在 tab 被关闭则退回消息页
  useEffect(() => {
    axios.get('/api/config').then(r => {
      const f = r.data?.features || {};
      setFeatures(f);
      setTab(prev => ((prev === 'moments' && f.moments === false) || (prev === 'favorites' && f.collect === false)) ? 'chats' : prev);
    }).catch(() => {});
  }, []);

  const fetchUnreadCounts = useCallback(() => {
    axios.get('/api/messages/unread-counts').then(({ data }) => setUnread(data)).catch(() => {});
  }, []);

  useEffect(() => { fetchUnreadCounts(); }, [fetchUnreadCounts]);
  useEffect(() => { if (reconnectCount === 0) return; fetchUnreadCounts(); }, [reconnectCount, fetchUnreadCounts]);
  useEffect(() => {
    window.addEventListener('focus', fetchUnreadCounts);
    return () => window.removeEventListener('focus', fetchUnreadCounts);
  }, [fetchUnreadCounts]);

  useEffect(() => {
    registerUnreadCleared(({ conversationId }) => {
      setUnread(prev => {
        if (!prev[conversationId]) return prev;
        const next = { ...prev }; delete next[conversationId]; return next;
      });
    });
  }, [registerUnreadCleared]);

  // 通知权限由 usePushNotification 统一申请，此处无需重复请求

  const showNotification = useCallback((title, body, icon) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification(title, {
        body,
        icon: icon || '/favicon.ico',
        badge: '/favicon.ico',
        tag: title,
        renotify: true,
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onMsg = (msg) => {
      const isActiveConv = msg.conversation_id === activeConvIdRef.current;
      setUnread(prev => {
        if (isActiveConv) return prev;
        return { ...prev, [msg.conversation_id]: (prev[msg.conversation_id] || 0) + 1 };
      });
      // 不在当前会话 或 窗口不可见时，推送浏览器通知
      if (!isActiveConv || document.hidden) {
        const bodyText =
          msg.type === 'image' ? '[图片]' :
          msg.type === 'voice' ? '[语音消息]' :
          msg.type === 'file'  ? '[文件]' :
          msg.type === 'video' ? '[视频]' :
          (msg.content || '').slice(0, 80) || '发来了一条消息';
        showNotification(msg.senderName || '新消息', bodyText, msg.senderAvatar);
      }
    };
    const onFriendReq = (data) => {
      setFriendReqCount(prev => prev + 1);
      const name = data?.from?.username || data?.username || '有人';
      showNotification('新的好友申请', `${name} 请求添加您为好友`);
    };
    const onFriendAccepted = (data) => {
      const name = data?.accepter?.username || '对方';
      showNotification('好友申请已通过', `${name} 已通过你的好友申请`);
    };
    const onMsgBatch = (arr) => { if (Array.isArray(arr)) for (const m of arr) onMsg(m); };
    socket.on('new_message', onMsg);
    socket.on('new_message_batch', onMsgBatch);
    socket.on('new_friend_request', onFriendReq);
    socket.on('friend_request_accepted', onFriendAccepted);
    return () => {
      socket.off('new_message', onMsg);
      socket.off('new_message_batch', onMsgBatch);
      socket.off('new_friend_request', onFriendReq);
      socket.off('friend_request_accepted', onFriendAccepted);
    };
  }, [socket, showNotification]);

  // 被踢出群时：清除当前活跃会话 + 清零未读（ChatWindow 可能未挂载，需在此兜底）
  useEffect(() => {
    if (!socket) return;
    const onGroupKicked = ({ conversationId }) => {
      setActiveConv(prev => (prev?.id === conversationId ? null : prev));
      setUnread(prev => { const n = { ...prev }; delete n[conversationId]; return n; });
    };
    socket.on('group_kicked', onGroupKicked);
    return () => socket.off('group_kicked', onGroupKicked);
  }, [socket]);

  const handleSelectConv = useCallback((conv) => {
    setActiveConv(conv);
    setUnread(prev => ({ ...prev, [conv.id]: 0 }));
    setTab('chats');
  }, []);

  const handleTabChange = (t) => {
    setTab(t);
    setSearch('');
    if (t !== 'chats') setActiveConv(null);
    if (t === 'contacts') setFriendReqCount(0);
  };

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const badges = { chats: totalUnread, contacts: friendReqCount };

  const [isMobile, setIsMobile] = useState(() =>
    window.innerWidth < 768 || !!window.Capacitor?.isNativePlatform?.());
  const [showPanel, setShowPanel] = useState(true);   // 桌面布局保留
  const [showChat, setShowChat] = useState(false);

  const handleMobileSelectConv = useCallback((conv) => { handleSelectConv(conv); }, [handleSelectConv]);
  const handleMobileBack = useCallback(() => { setActiveConv(null); }, []);

  useEffect(() => {
    const onResize = () =>
      setIsMobile(window.innerWidth < 768 || !!window.Capacitor?.isNativePlatform?.());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const renderMain = () => {
    switch (tab) {
      case 'chats':
        return <ChatList onSelectConv={isMobile ? handleMobileSelectConv : handleSelectConv} activeConvId={activeConv?.id} unread={unread} searchQuery={search} />;
      case 'contacts':
        return <ContactList onStartChat={(conv) => handleSelectConv(conv)} searchQuery={search} addFriendRequest={addFriendRequest} />;
      case 'moments':
        return <Moments />;
      case 'calls':
        return <CallHistory />;
      case 'favorites':
        return <Collections />;
      case 'profile':
      case 'settings':
        return <Profile />;
      default:
        return null;
    }
  };

  const toggleAddMenu = () => {
    if (showAddMenu) {
      setShowAddMenu(false);
      setAddMenuPos(null);
    } else {
      const rect = addBtnRef.current?.getBoundingClientRect();
      if (rect) setAddMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
      setShowAddMenu(true);
    }
  };
  const closeAddMenu = () => { setShowAddMenu(false); setAddMenuPos(null); };

  const handleCreateGroup = () => {
    closeAddMenu();
    setShowCreateGroup(true);
  };

  const handleAddFriend = () => {
    closeAddMenu();
    if (tab !== 'contacts') handleTabChange('contacts');
    setAddFriendRequest(n => n + 1);
  };

  // 各端共用的浮层（二维码 / 添加菜单 / 建群 / 网络搜索）
  const overlays = (
    <>
      {showQR && (
        <div className="wc-modal-overlay" onClick={() => setShowQR(false)}>
          <div className="wc-modal home-qr-modal" onClick={e => e.stopPropagation()}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">我的二维码</span>
              <button className="wc-modal-close" aria-label="关闭二维码" onClick={() => setShowQR(false)}>✕</button>
            </div>
            <div className="wc-modal-body home-qr-body">
              <AuthImage src="/api/users/me/qrcode" alt="我的二维码" className="home-qr-img" />
              <p className="home-qr-text">扫描二维码添加我为好友</p>
            </div>
          </div>
        </div>
      )}
      {showAddMenu && addMenuPos && (
        <>
          <div className="home-add-overlay" onClick={closeAddMenu} />
          <div className="home-add-dropdown" style={{ top: addMenuPos.top, right: addMenuPos.right }}>
            <AddDropItem icon={<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>}
              label="发起群聊" onClick={handleCreateGroup} />
            <div className="home-add-divider" />
            <AddDropItem icon={<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>}
              label="添加朋友" onClick={handleAddFriend} />
          </div>
        </>
      )}
      {showCreateGroup && (
        <CreateGroupModal onClose={() => setShowCreateGroup(false)}
          onCreated={(conv) => { setShowCreateGroup(false); handleSelectConv(conv); }} />
      )}
      {netSearchQ !== null && (
        <AddFriendModal initialQuery={netSearchQ} onClose={() => setNetSearchQ(null)} />
      )}
    </>
  );

  // ── 移动端布局（宽度 < 768 或原生 App）：底部 TabBar + 全屏页 + 全屏聊天 ──
  if (isMobile) {
    const M_LABEL = { chats: '消息', contacts: '通讯录', moments: '发现', settings: '我的' };
    const mobileTabs = ['chats', 'contacts', 'moments', 'settings']
      .map(k => TABS.find(t => t.key === k))
      .filter(t => t && !HIDDEN_TABS.has(t.key) && (!t.feature || features[t.feature] !== false));

    return (
      <div className="m-shell">
        {activeConv ? (
          <div className="m-chat-page">
            <ChatWindowBoundary convId={activeConv.id}>
              <ChatWindow key={activeConv.id} conversation={activeConv} onClose={handleMobileBack} />
            </ChatWindowBoundary>
          </div>
        ) : (
          <>
            <div className="m-page">
              {(tab === 'chats' || tab === 'contacts') && (
                <>
                  <div className="m-topbar">
                    <span className="m-title">{M_LABEL[tab]}</span>
                    {tab === 'chats' && (
                      <button ref={addBtnRef} className="m-topbar-add" onClick={toggleAddMenu} aria-label="发起">
                        <IcoAdd />
                      </button>
                    )}
                  </div>
                  <div className="m-search">
                    <span className="m-search-icon"><IcoSearch /></span>
                    <input placeholder="搜索" aria-label="搜索" value={search}
                      onChange={e => setSearch(e.target.value)} />
                    {search && <button className="m-search-clear" aria-label="清除" onClick={() => setSearch('')}>✕</button>}
                  </div>
                </>
              )}
              <div className="m-content">
                {search.trim() ? (
                  <GlobalSearch query={search}
                    onSelectConv={(conv) => { handleMobileSelectConv(conv); setSearch(''); }}
                    onNetworkSearch={(q) => setNetSearchQ(q || search)} />
                ) : tab === 'chats' ? (
                  <ChatList onSelectConv={handleMobileSelectConv} activeConvId={activeConv?.id}
                    unread={unread} searchQuery={search} />
                ) : renderMain()}
              </div>
            </div>

            <nav className="m-tabbar">
              {mobileTabs.map(({ key, Icon }) => {
                const count = badges[key] || 0;
                return (
                  <button key={key} className={`m-tab${tab === key ? ' active' : ''}`}
                    onClick={() => handleTabChange(key)}>
                    <span className="m-tab-ico"><Icon /></span>
                    <span className="m-tab-label">{M_LABEL[key]}</span>
                    {count > 0 && <span className="m-tab-badge">{count > 99 ? '99+' : count}</span>}
                  </button>
                );
              })}
            </nav>
          </>
        )}
        {overlays}
      </div>
    );
  }

  return (
    <div className={`wc-app${isMobile ? ' wc-mobile' : ''}`}>

      {/* 左侧导航栏 */}
      <div className="wc-sidebar">
        <AccountSwitcher />
        {/* Tab 按钮紧跟头像，不用 spacer 下推，防止小屏被裁切 */}
        <div className="wc-sidebar-btns">
          {visibleTabs(features).map(({ key, Icon, label }) => {
            const count = badges[key] || 0;
            return (
              <div key={key}
                className={`wc-sidebar-btn${tab === key ? ' active' : ''}`}
                onClick={() => handleTabChange(key)} title={label}
                role="tab" tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && handleTabChange(key)}>
                <div className="icon"><Icon /></div>
                <span className="wc-sidebar-label">{label}</span>
                {count > 0 && (
                  <span className="wc-sidebar-badge">{count > 99 ? '99+' : count}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="wc-main">

        {/* 面板区（固定顶栏 + 内容） */}
        {(!isMobile || showPanel) && (
          <div className="wc-panel">

            {/* 固定顶栏：搜索 + 二维码 + 添加 */}
            <div className="wc-panel-topbar">
              <div className="wc-search">
                <span className="wc-search-icon"><IcoSearch /></span>
                <input
                  placeholder="搜索"
                  aria-label="搜索"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && tab === 'contacts' && setAddFriendRequest(n => n + 1)}
                />
                {search && (
                  <button className="home-search-clear" aria-label="清除搜索"
                    onClick={() => setSearch('')}>✕</button>
                )}
              </div>

              {/* 二维码按钮 */}
              <button className="wc-icon-btn" title="我的二维码" onClick={() => setShowQR(true)}>
                <IcoQR />
              </button>

              {/* 添加按钮 */}
              <button ref={addBtnRef} className="wc-icon-btn" title="发起" onClick={toggleAddMenu}>
                <IcoAdd />
              </button>
            </div>

            <div className="wc-panel-content">
              {search.trim() ? (
                <GlobalSearch
                  query={search}
                  onSelectConv={(conv) => { (isMobile ? handleMobileSelectConv : handleSelectConv)(conv); setSearch(''); }}
                  onNetworkSearch={(q) => setNetSearchQ(q || search)}
                />
              ) : renderMain()}
            </div>
          </div>
        )}

        {/* 聊天区 */}
        {(!isMobile || showChat) && (
          <div className="home-chat-area">
            {activeConv
              ? (
                <ChatWindowBoundary convId={activeConv.id}>
                  <ChatWindow key={activeConv.id} conversation={activeConv} onClose={isMobile ? handleMobileBack : () => setActiveConv(null)} />
                </ChatWindowBoundary>
              )
              : <WcEmpty />
            }
          </div>
        )}
      </div>

      {overlays}
    </div>
  );
}

function AddDropItem({ icon, label, onClick }) {
  return (
    <div onClick={onClick}
      className="adi-row">
      <span className="adi-icon">{icon}</span>
      <span className="adi-label">{label}</span>
    </div>
  );
}
