import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { showConfirm } from '../utils/toast';
import { playMessageTone } from '../utils/notifySound';
import { startCallVisualAlert, stopCallVisualAlert } from '../utils/callVisualAlert';
import { setIncomingRingtone, prewarmAudio, stopTone, startIncomingTone } from '../utils/callTones';
import CallSoundGuide from '../components/CallSoundGuide';
import PushPermissionGuide from '../components/PushPermissionGuide';
import './Home.css';
import axios from 'axios';
import ChatList from '../components/ChatList';
import ChatWindowBoundary from '../components/ChatWindowBoundary';
import ContactList from '../components/ContactList';
import { showFriendRequestCard } from '../components/FriendRequestCard';
import Profile from '../components/Profile';
import GlobalSearch from '../components/GlobalSearch';
import PanelBoundary from '../components/PanelBoundary';
import { ChatSkeleton, PanelSkeleton } from '../components/PanelSkeleton';
import { IcoChat, IcoContacts, IcoSearch, IcoAdd, IcoMe, IcoMoments, IcoCall, IcoStar } from '../components/Icons';
// 非常驻的重型面板/模态框懒加载，减小首屏 chunk（各自本地 Suspense 兜底）
// ChatWindow(~2700 行)仅在选中会话后才渲染，懒加载可显著缩小 Home 首屏 chunk。
const ChatWindow    = lazy(() => import('../components/ChatWindow'));
const Moments       = lazy(() => import('../components/Moments'));
const CallHistory   = lazy(() => import('../components/CallHistory'));
const CallModal     = lazy(() => import('../components/CallModal'));
const GroupCallModal = lazy(() => import('../components/GroupCallModal'));
const Collections   = lazy(() => import('../components/Collections'));
const AddFriendModal = lazy(() => import('../components/AddFriendModal'));
const MentionList   = lazy(() => import('../components/MentionList'));
const ScanQR        = lazy(() => import('../components/ScanQR'));
import Avatar from '../components/Avatar';
import AuthImage from '../components/AuthImage';
import ReconnectingBanner from '../components/ReconnectingBanner';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { usePushNotification } from '../hooks/usePushNotification';
import useFocusTrap from '../hooks/useFocusTrap';
import { mediaUrl, goLogin } from '../utils/url';
import { warmupCacheDB } from '../utils/msgCache';
import { saveCred, removeCred } from '../utils/rememberedCreds';
import { useI18n } from '../contexts/I18nContext';

function WcEmpty() {
  // 对齐微信 PC：未选会话时近乎纯净留白，仅一枚极淡的单色图标，无文字、无彩色
  return (
    <div className="we-empty">
      <svg className="we-empty-svg" viewBox="0 0 64 64" aria-hidden="true">
        <rect x="6" y="12" width="44" height="32" rx="9" fill="#E6E9EF"/>
        <path d="M16 50l0-9 9 0z" fill="#E6E9EF"/>
        <rect x="14" y="22" width="28" height="3" rx="1.5" fill="#CFD5DF"/>
        <rect x="14" y="30" width="20" height="3" rx="1.5" fill="#CFD5DF"/>
      </svg>
    </div>
  );
}

/* SVG 图标统一迁入 components/Icons.jsx（2026-08 体系级重构） */

// label 由 i18n key 驱动（labelKey），而非字面量——TABS 是模块级常量，渲染前拿不到 t()，
// 具体文案在使用处用 t(labelKey) 取（见 Home() 内 visibleTabs 消费处 / mLabel）。
const TABS = [
  { key: 'chats',     Icon: IcoChat,     labelKey: 'home.tab.chats' },
  { key: 'contacts',  Icon: IcoContacts, labelKey: 'home.tab.contacts' },
  { key: 'moments',   Icon: IcoMoments,  labelKey: 'home.tab.moments', feature: 'moments' },
  { key: 'calls',     Icon: IcoCall,     labelKey: 'home.tab.calls' },
  { key: 'favorites', Icon: IcoStar,     labelKey: 'home.tab.favorites', feature: 'collect' },
  { key: 'me',        Icon: IcoMe,       labelKey: 'home.tab.me' },
];

// 前端硬隐藏的 tab（此集合为空时全部由后端 features 开关控制）。
// 朋友圈/收藏/通话为完整功能，恢复由后端 features.moments / features.collect 开关决定。
const HIDDEN_TABS = new Set();
const visibleTabs = (features) =>
  TABS.filter(t => !HIDDEN_TABS.has(t.key) && (!t.feature || features[t.feature] !== false));


/* ── 左上角头像 — 点击展开账号切换/添加下拉面板 ── */
function AccountSwitcher() {
  const { t } = useI18n();
  const { user, accounts, login, switchAccount, removeAccount, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [form, setForm] = useState({ phone: '', password: '' });
  const [switchTarget, setSwitchTarget] = useState(null); // 非空=正在切换到某个已登录账号(显示其昵称)
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [avatarErr, setAvatarErr] = useState(false); // 头像加载失败时回退字母，避免显示浏览器碎图
  const phoneRef = useRef(null);
  const passwordRef = useRef(null);
  const containerRef = useRef(null);
  const letter = (user?.username || '?')[0].toUpperCase();
  // 头像地址变化即复位错误态：render 期派生（存上一次 avatar），避免 effect 内同步 setState
  const [prevAvatar, setPrevAvatar] = useState(user?.avatar);
  if (user?.avatar !== prevAvatar) { setPrevAvatar(user?.avatar); setAvatarErr(false); }

  /* 点外部关闭，不用全屏遮罩（遮罩会挡住头像按钮本身） */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 下拉关闭时复位表单：render 期派生（存上一次 open），避免 effect 内同步 setState
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) { setShowForm(false); setErr(''); setForm({ phone: '', password: '' }); setSwitchTarget(null); }
  }

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
    } catch {
      // 免密切换不可用 → 回填手机号，密码始终由用户输入。
      setSwitching(false);
      setSwitchTarget(acct.user || null);
      const phone = acct.user?.phone || '';
      setForm({ phone, password: '' });
      setShowForm(true);
      // 聚焦密码框等待输入。
      setTimeout(() => passwordRef.current?.focus(), 80);
    }
  };

  // 删除账号：当前账号→退出登录；其他账号→从本设备移除(最近登录+免密切换凭证)
  const doRemove = async (e, id) => {
    e.stopPropagation();
    const acct = accounts.find(a => a.id === id);
    const name = acct?.user?.username || t('home.unnamedAccount');
    if (id === user?.id) {
      if (!(await showConfirm(t('home.logoutConfirmTemplate').replace('{name}', name)))) return;
      await logout();                 // 清会话+CSRF+从钱包移除当前账号
      goLogin();
    } else {
      if (!(await showConfirm(t('home.removeAccountConfirmTemplate').replace('{name}', name)))) return;
      removeCred(acct?.user?.phone || '');
      removeAccount(id);              // 移除最近登录记录 + 钱包凭证
    }
  };

  const doAdd = async (e) => {
    e.preventDefault();
    if (submitting) return; // 防连点/回车重复提交
    if (!form.phone || !form.password) { setErr(t('home.fillPhonePassword')); return; }
    setErr(''); setSubmitting(true);
    try {
      const { data } = await axios.post('/api/auth/login', form);
      // 只记住用户名，密码不持久化。
      saveCred(form.phone);
      login(data.user, data.token); // 必须传 token:Bearer端(Electron/移动)漏传会清掉鉴权头→reload后被登出
      window.location.reload();
    } catch (ex) {
      setErr(ex.response?.data?.error || t('home.wrongPhonePassword'));
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
      <div className="as-avatar-btn" data-testid="account-switcher" role="button" tabIndex={0} aria-label={t('home.accountSwitch')} aria-expanded={open} onClick={() => setOpen(v => !v)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}>
        <div className={`as-avatar-inner${open ? ' as-avatar-inner-open' : ''}`}>
          {user?.avatar && !avatarErr
            ? <img src={mediaUrl(user.avatar)} alt="" loading="lazy" className="as-avatar-img" onError={() => setAvatarErr(true)} />
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
                data-testid={`account-row-${a.id}`}
                role="button" tabIndex={0}
                onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !active) { e.preventDefault(); doSwitch(a.id); } }}>
                <div className="as-avatar-wrap">
                  <Avatar src={a.user?.avatar} name={a.user?.username} size={40} />
                  {active && (
                    <div className="as-active-badge">
                      <svg className="as-check-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    </div>
                  )}
                </div>
                <div className="as-name-wrap">
                  <div className={`as-name${active ? ' active' : ''}`}>
                    {a.user?.username || t('auth.unnamed')}
                  </div>
                  {a.user?.phone && <div className="as-phone">{a.user.phone}</div>}
                </div>
                {active
                  ? <span className="as-current-badge">{t('home.currentBadge')}</span>
                  : <span className="as-switch-text">{t('home.switchText')}</span>
                }
                {/* 删除/退出账号 */}
                <button
                  onClick={(e) => doRemove(e, a.id)}
                  title={active ? t('settings.logout') : t('home.removeFromDevice')}
                  data-testid={active ? 'account-logout-btn' : undefined}
                  className="as-remove-btn">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              </div>
            );
          })}

          {/* 个人资料卡片（置于添加账户之上，桌面端优先展示本人资料） */}
          <div onClick={() => setShowProfile(v => !v)}
            className="as-profile-row"
            role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowProfile(v => !v); } }}>
            <svg className="as-profile-icon" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            <span className="as-profile-label">{t('home.profile')}</span>
            <svg viewBox="0 0 24 24" className={`as-profile-arrow${showProfile ? ' open' : ''}`}>
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
            </svg>
          </div>

          {/* 资料详情（展开时显示） */}
          {showProfile && (
            <div className="as-profile-detail">
              {/* 投聊号 */}
              {user?.wechat_id && (
                <div className="as-profile-item">
                  <span className="as-profile-label-text">{t('home.wechatIdLabel')}</span>
                  <span className="as-profile-value">{user.wechat_id}</span>
                </div>
              )}
              {/* 手机号 */}
              {user?.phone && (
                <div className="as-profile-item">
                  <span className="as-profile-label-text">{t('auth.phone')}</span>
                  <span className="as-profile-value">{user.phone}</span>
                </div>
              )}
              {/* 二维码 */}
              {user?.id && (
                <div className="as-qr-section">
                  <div className="as-qr-label">{t('home.qrCode')}</div>
                  <div className="as-qr-content">
                    <AuthImage src="/api/users/me/qrcode" alt={t('home.myQrCode')} className="as-qr-img" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 添加账户行 */}
          <div onClick={toggleForm}
            className={`wc-add-row${showForm ? ' open' : ''}`}
            data-testid="account-add-row"
            role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleForm(e); } }}>
            <div className={`wc-add-icon-wrap${showForm ? ' open' : ''}`}>
              <svg viewBox="0 0 24 24" className={`wc-add-icon-svg${showForm ? ' open' : ''}`}>
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
            </div>
            <span className={`wc-add-label${showForm ? ' open' : ''}`}>{t('home.addAccount')}</span>
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
                    ? t('home.switchToAccountTemplate').replace('{name}', switchTarget.username || t('home.unnamedAccount'))
                    : t('home.addAccountHint')}
                </span>
              </div>
              <form onSubmit={doAdd} className="wc-add-form-inner">
                <input ref={phoneRef} type="tel" placeholder={t('auth.phone')} value={form.phone}
                  readOnly={!!switchTarget}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="wc-add-form-input"
                  aria-label={t('auth.phone')} data-testid="account-add-phone"
                />
                <input ref={passwordRef} type="password" placeholder={t('auth.password')} value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="wc-add-form-input"
                  aria-label={t('auth.password')} data-testid="account-add-password" />
                {err && <div className="wc-add-form-error" role="alert">{err}</div>}
                <button type="submit" disabled={submitting}
                  className="wc-add-form-submit" data-testid="account-add-submit">
                  {submitting ? t('home.loggingIn') : (switchTarget ? t('home.loginAndSwitch') : t('home.loginAndAdd'))}
                </button>
              </form>
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
      data-testid={`group-member-row-${c.id}`}
      className="cg-row"
      role="checkbox" tabIndex={0} aria-checked={checked}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onToggle()}>
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
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [contacts, setContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef(null);
  const trapRef = useFocusTrap();

  useEffect(() => {
    axios.get('/api/users/contacts').then(r => setContacts(r.data)).catch(() => {});
    setTimeout(() => nameRef.current?.focus(), 80);
  }, []);

  // Esc 关闭（创建中不关闭，避免打断建群请求）
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !loading) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [loading, onClose]);

  const toggle = (id) => setSelected(prev => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  const create = async () => {
    if (loading) return; // 防连点重复建群
    if (!name.trim()) { setError(t('home.groupNamePlaceholder')); return; }
    if (selected.size === 0) { setError(t('home.selectAtLeastOne')); return; }
    setLoading(true); setError('');
    try {
      const { data } = await axios.post('/api/messages/conversation/group', { name: name.trim(), memberIds: [...selected] });
      onCreated({ id: data.conversationId, type: 'group', name: name.trim(), avatar: '', members: [] });
    } catch (err) {
      setError(err.response?.data?.error || t('home.createGroupFailed'));
      setLoading(false);
    }
  };

  // 仅在联系人列表或搜索词变化时重算，避免勾选(selected)切换时无谓地整表过滤
  const filtered = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c => (c.remark || c.username || '').toLowerCase().includes(q));
  }, [contacts, contactSearch]);

  const selectedContacts = useMemo(
    () => contacts.filter(c => selected.has(c.id)),
    [contacts, selected],
  );

  return (
    <div className="cgm-overlay" ref={trapRef}
      role="button" tabIndex={0}
      onClick={e => e.target === e.currentTarget && onClose()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClose(); } }}>
      <div className="cgm-content"
        onClick={e => e.stopPropagation()}>

        {/* 标题栏 */}
        <div className="cgm-header">
          <span className="cgm-title">{t('home.createGroupTitle')}</span>
          <button onClick={onClose} className="cgm-close" aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        {/* 群名称输入 */}
        <div className="cgm-name-section">
          <div className="cgm-name-label">{t('home.groupNameLabel')}</div>
          <input
            ref={nameRef}
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder={t('home.groupNamePlaceholder')}
            aria-label={t('home.groupNameLabel')}
            data-testid="group-name-input"
            maxLength={30}
            className="cgm-name-input"
          />
        </div>

        {/* 已选成员 chips */}
        {selectedContacts.length > 0 && (
          <div className="cgm-chips">
            {selectedContacts.map(c => (
              <div key={c.id} role="button" tabIndex={0} aria-label={t('home.removeMemberTemplate').replace('{name}', c.remark || c.username)} onClick={() => toggle(c.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c.id); } }}
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
            placeholder={t('home.searchContacts')}
            aria-label={t('home.searchContacts')}
            className="cgm-search-input"
          />
        </div>

        {/* 联系人列表 */}
        <div className="cgm-member-count">
          {t('home.selectMembersTemplate').replace('{n}', selected.size)}
        </div>
        <div className="cgm-contact-list">
          {filtered.length === 0 && (
            <div className="cgm-empty">
              {contacts.length === 0 ? t('home.noContacts') : t('home.noContactsFound')}
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
              {t('common.cancel')}
            </button>
            <button onClick={create} disabled={loading || selected.size === 0}
              data-testid="group-create-btn"
              className="cgm-create">
              {loading ? t('home.creating') : `${t('home.createGroupBtn')}${selected.size > 0 ? t('home.peopleCountSuffix').replace('{n}', selected.size) : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState('chats');
  const [features, setFeatures] = useState({ moments: true, collect: true });
  const [netSearchQ, setNetSearchQ] = useState(null); // null=关闭；字符串=带词打开网络搜索
  const [showMentions, setShowMentions] = useState(false); // @我的消息聚合面板
  const [showScan, setShowScan] = useState(false);          // 扫一扫入群
  const [activeConv, setActiveConv] = useState(null);
  const [unread, setUnread] = useState({});
  const [friendReqCount, setFriendReqCount] = useState(0);
  const [search, setSearch] = useState('');
  const [showQR, setShowQR] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [addFriendRequest, setAddFriendRequest] = useState(0);
  const [openFriendRequests, setOpenFriendRequests] = useState(0);
  const [convRefreshKey, setConvRefreshKey] = useState(0);
  const { socket, reconnectCount, registerUnreadCleared } = useSocket();
  const { user } = useAuth();
  // 通知权限不再自动申请：permission==='default' 时由 PushPermissionGuide 出软引导，
  // 用户点「开启」（真实手势）才调 enablePush() 走系统权限框。详见 usePushNotification.js。
  const { permission: pushPermission, enablePush } = usePushNotification(user);

  // 上报界面语言，供服务端渲染离线推送文案。
  // 推送是异步发出的，服务端那时没有请求上下文可协商语言，只能靠持久化的用户偏好
  // （user_settings.lang，见 backend-v2/src/utils/pushI18n.js）——不上报的话，
  // 英文用户锁屏收到的推送依然是简体中文。登录后同步一次 + 之后每次切换语言再同步，
  // 失败静默（推送文案回落 zh-CN，不影响任何其他功能）。
  const syncedLangRef = useRef(null);
  useEffect(() => {
    if (!user || syncedLangRef.current === lang) return;
    syncedLangRef.current = lang;
    axios.put('/api/users/me/settings', { lang }).catch(() => { syncedLangRef.current = null; });
  }, [user, lang]);

  // 启动预热 IndexedDB：切会话时消息缓存读取无 openDB 冷启动延迟（防「打开会话空白一下」）
  useEffect(() => { warmupCacheDB(); }, []);
  const activeConvIdRef = useRef(null);
  const addBtnRef = useRef(null);
  useEffect(() => { activeConvIdRef.current = activeConv?.id ?? null; }, [activeConv?.id]);

  const handleSelectConv = useCallback((conv) => {
    setActiveConv(conv);
    setUnread(prev => ({ ...prev, [conv.id]: 0 }));
    setTab('chats');
  }, []);

  // 拒接来电后回复消息：取/建与该用户的私聊会话并打开（来电必已有共同会话，正常命中已存在）。
  // ⚠ 这个接口的返回体是 `{ conversationId }`，既没有 `conversation` 也没有 `id`
  // （见 backend-v2 conversations.service.js getOrCreatePrivate）。此前写成
  // `data?.conversation || data` 直接把整个响应体当会话对象塞给 ChatWindow，
  // conversation.id 恒为 undefined → 会话头像/昵称空白、历史拉 /conversation/undefined、
  // join_conversation 与 typing 全部被服务端的 guardId 拒掉（生产日志里可见连续的
  // 「非法ID被拒绝 field=conversationId type=undefined」），用户看到的是一个能打字
  // 但发不出、也收不到任何东西的死会话。这里改为取 conversationId，并优先用会话列表
  // 里的那一条（带备注名/头像/免打扰等完整字段），取不到再用最小可用对象兜底。
  const handleReplyFromCall = useCallback(async (peerId, peerUser) => {
    try {
      const { data } = await axios.post('/api/messages/conversation/private', { userId: peerId });
      const conversationId = data?.conversationId;
      if (!conversationId) return;
      const list = await axios.get('/api/messages/conversations')
        .then(r => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []);
      const known = list.find(c => c.id === conversationId);
      // 兜底对象用来电方的昵称头像（CallModal 传出），而不是空串——
      // 列表拉取失败或该私聊尚未出现在列表里时，至少标题栏是对的。
      handleSelectConv(known || {
        id: conversationId,
        type: 'private',
        name: peerUser?.name || '',
        avatar: peerUser?.avatar || '',
      });
    } catch { /* 会话打开失败静默（用户仍可手动进入会话） */ }
  }, [handleSelectConv]);

  // @我的消息：点某条 → 拉取会话信息并打开、滚动定位到该消息
  const handleJumpToMention = useCallback(async ({ convId, msgId }) => {
    if (!convId) return;
    setShowMentions(false);
    try {
      const { data } = await axios.get('/api/messages/conversations');
      const conv = Array.isArray(data) ? data.find(c => c.id === convId) : null;
      if (conv) {
        handleSelectConv({ ...conv, scrollToId: msgId });
      } else {
        // 兜底：仅凭 id 打开，ChatWindow 会自行拉取历史并按 scrollToId 定位
        handleSelectConv({ id: convId, type: 'group', name: '', scrollToId: msgId });
      }
    } catch {
      handleSelectConv({ id: convId, type: 'group', name: '', scrollToId: msgId });
    }
  }, [handleSelectConv]);

  useEffect(() => {
    const handler = (e) => {
      const { conversationId, scrollToId } = e.detail || {};
      if (!conversationId) return;
      axios.get('/api/messages/conversations').then(r => {
        const conv = r.data.find(c => c.id === conversationId);
        // scrollToId 存在时透传给 ChatWindow，定位到原消息（收藏跳转用）
        if (conv) handleSelectConv(scrollToId ? { ...conv, scrollToId } : conv);
      }).catch(() => {});
    };
    window.addEventListener('touliao:open-conversation', handler);
    return () => window.removeEventListener('touliao:open-conversation', handler);
  }, [handleSelectConv]);

  useEffect(() => {
    axios.get('/api/users/friend-requests').then(r => setFriendReqCount(r.data.length)).catch(() => {});
  }, []);

  // 功能开关：后台可隐藏朋友圈/收藏/群语音/群视频。若当前所在 tab 被关闭则退回消息页
  const applyFeatures = useCallback((f) => {
    setFeatures(f || {});
    setTab(prev => ((prev === 'moments' && f?.moments === false) || (prev === 'favorites' && f?.collect === false)) ? 'chats' : prev);
  }, []);
  useEffect(() => {
    axios.get('/api/config').then(r => applyFeatures(r.data?.features || {})).catch(() => {});
  }, [applyFeatures]);
  // 后台改动开关 → 服务端广播 config:updated → 在线端实时热更新，无需刷新
  useEffect(() => {
    if (!socket) return;
    const onConfig = ({ features: f }) => applyFeatures(f || {});
    socket.on('config:updated', onConfig);
    return () => socket.off('config:updated', onConfig);
  }, [socket, applyFeatures]);

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
    return registerUnreadCleared(({ conversationId }) => {
      setUnread(prev => {
        if (!prev[conversationId]) return prev;
        const next = { ...prev }; delete next[conversationId]; return next;
      });
    });
  }, [registerUnreadCleared]);

  // 通知权限统一由 PushPermissionGuide 在用户手势下申请（见 usePushNotification.js），
  // 此处只消费结果：未授权就不弹桌面通知，绝不在这里补一次 requestPermission。

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
    } catch { /* notification display failed; non-critical */ }
  }, []);

  // 好友申请轻量卡片「查看」→ 切到通讯录 + 触发 ContactList 跳转「新的朋友」收到列表
  const openFriendRequestsPage = useCallback(() => {
    setTab('contacts');
    setOpenFriendRequests(n => n + 1);
  }, []);
  const handleOpenFriendRequestsConsumed = useCallback(() => setOpenFriendRequests(0), []);

  const myId = user?.id;
  useEffect(() => {
    if (!socket) return;
    // 超大户群降级通知：>500 在线 socket 的房间不推全量消息，只推轻量通知。
    // 会话列表侧：未读数 +1、触发浏览器通知/提示音、并刷新会话列表（置顶/最新消息摘要）。
    // 超大户群降级通知的预览文案：优先用服务端新增的结构化 previewType 自行本地化
    // （同一条广播全房间共用一份 payload，服务端没法按各人语言渲染，见 broadcaster.js），
    // 拿不到 previewType 时才回落服务端渲染好的 preview（旧服务端兼容）。
    const localizedPreview = ({ previewType, previewText, preview }) => {
      const key = {
        image: 'chatlist.previewImage', voice: 'chatlist.previewVoice',
        video: 'chatlist.previewVideo', file: 'chatlist.previewFile',
        sticker: 'chatlist.previewSticker', red_packet: 'chatlist.previewRedPacket',
        contact_card: 'chatlist.previewContact',
      }[previewType];
      if (key) return t(key);
      if (previewType) return previewText || '';
      return preview || '';
    };
    const onNotify = ({ conversationId, senderName, preview, previewType, previewText }) => {
      const isActiveConv = conversationId === activeConvIdRef.current;
      setUnread(prev => {
        if (isActiveConv) return prev;
        return { ...prev, [conversationId]: (prev[conversationId] || 0) + 1 };
      });
      if (!isActiveConv || document.hidden) {
        showNotification(
          senderName || t('home.newMessage'),
          localizedPreview({ previewType, previewText, preview }) || t('home.sentAMessage')
        );
        if (senderName) playMessageTone(); // 大群通知不携带 sender_id，仅在明确有发送者时响铃
      }
      setConvRefreshKey(k => k + 1); // 刷新会话列表（置顶 + lastMessage 摘要）
    };
    const onMsg = (msg) => {
      const isActiveConv = msg.conversation_id === activeConvIdRef.current;
      setUnread(prev => {
        if (isActiveConv) return prev;
        return { ...prev, [msg.conversation_id]: (prev[msg.conversation_id] || 0) + 1 };
      });
      // 不在当前会话 或 窗口不可见时，推送浏览器通知
      if (!isActiveConv || document.hidden) {
        const bodyText =
          msg.type === 'image' ? t('messageItem.replyPreviewImage') :
          msg.type === 'voice' ? t('home.previewVoiceMessage') :
          msg.type === 'file'  ? t('messageItem.replyPreviewFile') :
          msg.type === 'video' ? t('messageItem.replyPreviewVideo') :
          (msg.content || '').slice(0, 80) || t('home.sentAMessage');
        showNotification(msg.senderName || t('home.newMessage'), bodyText, msg.senderAvatar);
        if (msg.sender_id !== myId) playMessageTone(); // 提示音，独立于通知权限
      }
      // 桌面端：他人来消息 → 请求任务栏闪烁。是否真闪由主进程 isFocused() 最终判定。
      // ⚠ 不在渲染层用 document.hidden/hasFocus 门控：Electron 里窗口最小化时 document.hidden
      //   常仍为 false、hasFocus 也不可靠 → 条件永不满足 → 图标从不闪（本次根因）。
      if (msg.sender_id !== myId) {
        try { window.electronAPI?.flashFrame?.(true); } catch { /* 非桌面端忽略 */ }
      }
    };
    const onFriendReq = (data) => {
      setFriendReqCount(prev => prev + 1);
      const name = data?.from?.username || data?.username || t('home.someone');
      const avatar = data?.from?.avatar || data?.avatar || '';
      const message = data?.message || data?.from?.message || '';
      // 2026-08-29 提醒优化：App 前台时用轻量内嵌卡片(不打断当前操作)；
      // 后台/切走标签页时才用系统通知(此时用户看不到页面内容，只能靠系统)。
      if (!document.hidden) {
        showFriendRequestCard({ avatar, name, message, onView: () => openFriendRequestsPage() });
      } else {
        showNotification(t('home.newFriendRequestTitle'), t('home.friendRequestBodyTemplate').replace('{name}', name));
      }
    };
    const onFriendAccepted = (data) => {
      // accepter 存在 = 我是请求方，对方通过了我的申请；newFriend 存在 = 我是接受方，仅触发刷新
      if (data?.accepter?.username) {
        showNotification(t('home.friendRequestAcceptedTitle'), t('home.friendRequestAcceptedBodyTemplate').replace('{name}', data.accepter.username));
      }
      // 刷新会话列表（新好友会话自动置顶）
      setConvRefreshKey(k => k + 1);
    };
    // 批量消息：一次 setState，不是 N 次（防止 N 帧连续渲染）
    const onMsgBatch = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return;
      setUnread(prev => {
        const next = { ...prev };
        let changed = false;
        for (const msg of arr) {
          if (msg.conversation_id !== activeConvIdRef.current) {
            next[msg.conversation_id] = (next[msg.conversation_id] || 0) + 1;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      // 通知：每个会话只取最新一条，避免批量弹多条通知
      const latestByConv = new Map();
      for (const msg of arr) latestByConv.set(msg.conversation_id, msg);
      for (const msg of latestByConv.values()) {
        if (msg.conversation_id !== activeConvIdRef.current || document.hidden) {
          const bodyText =
            msg.type === 'image' ? t('messageItem.replyPreviewImage') :
            msg.type === 'voice' ? t('home.previewVoiceMessage') :
            msg.type === 'file'  ? t('messageItem.replyPreviewFile') :
            msg.type === 'video' ? t('messageItem.replyPreviewVideo') :
            (msg.content || '').slice(0, 80) || t('home.sentAMessage');
          showNotification(msg.senderName || t('home.newMessage'), bodyText, msg.senderAvatar);
          if (msg.sender_id !== myId) playMessageTone();
        }
      }
      // 桌面端：批量里有他人消息 → 请求闪烁（是否真闪由主进程 isFocused 判定，与单条对齐）
      const hasOthers = arr.some(m => m.sender_id !== myId);
      if (hasOthers) {
        try { window.electronAPI?.flashFrame?.(true); } catch { /* 非桌面端忽略 */ }
      }
    };
    socket.on('new_message', onMsg);
    socket.on('new_message_batch', onMsgBatch);
    socket.on('new_message_notify', onNotify);
    socket.on('new_friend_request', onFriendReq);
    socket.on('friend_request_accepted', onFriendAccepted);
    return () => {
      socket.off('new_message', onMsg);
      socket.off('new_message_batch', onMsgBatch);
      socket.off('new_message_notify', onNotify);
      socket.off('new_friend_request', onFriendReq);
      socket.off('friend_request_accepted', onFriendAccepted);
    };
  }, [socket, showNotification, myId, openFriendRequestsPage, t]);

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

  const [activeCall, setActiveCall] = useState(null);

  // 来电铃声：启动时从服务端同步 user_settings.ringtone（未进过设置页的用户也生效）
  useEffect(() => {
    axios.get('/api/users/me/settings').then(r => {
      const key = r.data?.ringtone;
      if (key) setIncomingRingtone(key);
    }).catch(() => {});
  }, []);

  // 来电提醒清理兜底：activeCall 消失（挂断/拒绝/超时/对方取消）时恢复标题/favicon。
  // 来电铃声由 CallModal 内部 stopTone 处理（铃声与通话生命周期绑定，无需在此干预）。
  useEffect(() => {
    if (!activeCall) stopCallVisualAlert();
  }, [activeCall]);

  // 通话记录列表刷新键:任一通话结束(call:end 覆盖挂断/拒绝/超时/断线/重拨替换)
  // 时 +1,传给 CallHistory 静默重新拉取——修"停留在历史页时通话结束列表不自动刷新"
  const [callsRefreshKey, setCallsRefreshKey] = useState(0);
  // 2026-08-31（Task 5）：同账号另一台设备/标签页正在呼叫别人时（call:outgoing），
  // 这个标签页记下对方的 callId——不采集媒体、不弹主叫UI（不复用 activeCall/
  // CallModal 那一整套渲染路径，那套是真参与通话的设备才用的），只用来在这个
  // 标签页自己收到新来电时正确判成"忙"，不会对着一通其实已经在别处进行的通话
  // 又弹一次来电界面。call:end 命中同一个 callId 时清掉（对方已被接听/拒绝/挂断）。
  const [busyElsewhereCallId, setBusyElsewhereCallId] = useState(null);

  useEffect(() => {
    if (!socket) return;
    const onOutgoing = ({ callId }) => { if (callId) setBusyElsewhereCallId(callId); };
    const onEnd = ({ callId }) => {
      setBusyElsewhereCallId(prev => (prev && callId && prev === callId ? null : prev));
      setCallsRefreshKey(k => k + 1); // 通话结束 → 通话记录列表刷新
    };
    socket.on('call:outgoing', onOutgoing);
    socket.on('call:end', onEnd);
    return () => {
      socket.off('call:outgoing', onOutgoing);
      socket.off('call:end', onEnd);
    };
  }, [socket]);

  // 全局来电监听（不论哪个会话打开，都能收到来电）
  useEffect(() => {
    if (!socket) return;
    const onIncoming = ({ from, type, caller, callId }) => {
      setActiveCall(prev => {
        // 通话中（自己接听/正在通话，或者同账号另一台设备正在呼叫别人）忽略新来电（busy）
        if (prev || busyElsewhereCallId) {
          socket.emit('call:response', { to: from, accepted: false, busy: true, callId });
          return prev;
        }
        // 桌面端：来电时若窗口在后台/最小化，拉到前台并闪烁 + 弹原生通知，
        // 否则用户看不到来电界面（Electron 端此前完全无后台来电提醒）。
        if (window.__ELECTRON_CONFIG__ && (document.hidden || !document.hasFocus())) {
          try { window.electronAPI?.focusForCall?.(); } catch { /* 非桌面端忽略 */ }
        }
        const callerName = caller?.name || t('home.defaultFriendName');
        showNotification(callerName, type === 'video' ? t('home.videoCallInvite') : t('home.voiceCallInvite'), caller?.avatar);
        // 标题/favicon 闪烁——仅 Web/桌面端启用：
        // 原生移动端（Capacitor）有原生推送铃声+提醒，且 WebView 无浏览器标签栏，视觉提醒无意义。
        // （来电铃声由 CallModal 内部 startIncomingTone 播放，此处不重复。）
        const isNativeMobile = !!(window.Capacitor && window.Capacitor.isNativePlatform());
        if (!isNativeMobile) startCallVisualAlert(callerName);
        return { type, direction: 'incoming', remoteUser: { id: from, name: caller?.name, avatar: caller?.avatar }, remoteId: from, callId };
      });
    };
    socket.on('call:incoming', onIncoming);
    return () => socket.off('call:incoming', onIncoming);
  }, [socket, showNotification, busyElsewhereCallId, t]);

  // 群通话（进行中 session / 收到的邀请）——提到 Home 顶层是因为 socket 在连接时
  // 就 join 了用户所有会话的房间（backend-v2/src/realtime/index.js），邀请广播不
  // 分你当前打开的是哪个会话；此前监听器挂在 ChatWindow 内部，只有邀请所属的那个
  // 群聊恰好正打开时才收得到，别的会话/标签页收不到任何提醒（真实断点，2026-09-03 修）。
  const [groupCall, setGroupCall] = useState(null);
  const [groupCallInvite, setGroupCallInvite] = useState(null);

  useEffect(() => {
    if (!socket) return;
    const onInvite = (inv) => {
      if (groupCall || activeCall) return; // 已在通话中（1:1 或群）——忽略，加入时后端 registry 会再兜底判忙
      setGroupCallInvite(inv);
    };
    socket.on('group_call:invite', onInvite);
    return () => socket.off('group_call:invite', onInvite);
  }, [socket, groupCall, activeCall]);

  // 群通话被叫来电铃声：收到邀请条(未加入/未拒绝)期间循环;消失即停
  const groupInviteToneRef = useRef(null);
  useEffect(() => {
    if (groupCallInvite && !groupCall) {
      prewarmAudio();
      stopTone();
      groupInviteToneRef.current = startIncomingTone();
    } else {
      groupInviteToneRef.current?.stop();
      groupInviteToneRef.current = null;
    }
    return () => { groupInviteToneRef.current?.stop(); groupInviteToneRef.current = null; };
  }, [groupCallInvite, groupCall]);

  const joinGroupCall = useCallback(() => {
    if (!groupCallInvite) return;
    setGroupCall({ mode: 'join', callId: groupCallInvite.callId, conversationId: groupCallInvite.conversationId, type: groupCallInvite.type });
    setGroupCallInvite(null);
  }, [groupCallInvite]);

  // 从 ChatWindow 发起群通话（仅当前打开的群聊会调用）——session 全局挂载，
  // 与是否切走会话/关闭聊天窗口无关，行为对齐 1:1 通话的 handleStartCall。
  const handleStartGroupCall = useCallback((conversationId, type) => {
    setGroupCallInvite(null);
    setGroupCall({ mode: 'start', conversationId, type });
  }, []);

  const handleTabChange = (t) => {
    setTab(t);
    setSearch('');
    if (t !== 'chats') setActiveConv(null);
    if (t === 'contacts') setFriendReqCount(0);
  };

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const badges = { chats: totalUnread, contacts: friendReqCount };

  // 浏览器标签页标题显示未读总数「(N) 投聊」——切到别的 tab 也能一眼看到有新消息(对齐一线 IM)。
  // N>99 记作 99+；为 0 时恢复纯「投聊」；组件卸载时复位，避免残留角标。
  // 桌面端(Electron)同步把未读总数反映到 Dock/任务栏角标。
  useEffect(() => {
    const base = t('common.appName');
    document.title = totalUnread > 0 ? `(${totalUnread > 99 ? '99+' : totalUnread}) ${base}` : base;
    try { window.electronAPI?.setBadge?.(totalUnread); } catch { /* 非桌面端忽略 */ }
    return () => {
      document.title = base;
      try { window.electronAPI?.setBadge?.(0); } catch { /* noop */ }
    };
  }, [totalUnread, t]);

  const handleStartCall = useCallback((callData) => {
    setActiveCall(callData);
  }, []);

  const [isMobile, setIsMobile] = useState(() =>
    window.innerWidth < 768 || !!window.Capacitor?.isNativePlatform?.());
  const [showPanel] = useState(true);   // 桌面布局保留
  const [showChat] = useState(false);

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
        return <ChatList onSelectConv={isMobile ? handleMobileSelectConv : handleSelectConv} activeConvId={activeConv?.id} unread={unread} searchQuery={search} convRefreshKey={convRefreshKey} onOpenMentions={() => setShowMentions(true)} />;
      case 'contacts':
        return <ContactList onStartChat={(conv) => handleSelectConv(conv)} searchQuery={search} addFriendRequest={addFriendRequest} onAddFriendConsumed={handleAddFriendConsumed} openFriendRequests={openFriendRequests} onOpenFriendRequestsConsumed={handleOpenFriendRequestsConsumed} />;
      case 'moments':
        return <PanelBoundary name={t('home.momentsPanelName')}><Suspense fallback={<PanelSkeleton />}><Moments /></Suspense></PanelBoundary>;
      case 'calls':
        return <PanelBoundary name={t('home.callHistoryPanelName')}><Suspense fallback={<PanelSkeleton />}><CallHistory onOpenChat={isMobile ? handleMobileSelectConv : handleSelectConv} refreshKey={callsRefreshKey} /></Suspense></PanelBoundary>;
      case 'favorites':
        return <PanelBoundary name={t('home.collectionsPanelName')}><Suspense fallback={<PanelSkeleton />}><Collections /></Suspense></PanelBoundary>;
      case 'profile':
      case 'me':
        return <Profile isMobile={isMobile} />;
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

  // Esc 关闭二维码弹窗，与其它弹窗键盘行为一致
  useEffect(() => {
    if (!showQR) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowQR(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showQR]);

  const handleCreateGroup = () => {
    closeAddMenu();
    setShowCreateGroup(true);
  };

  const handleAddFriend = () => {
    closeAddMenu();
    if (tab !== 'contacts') handleTabChange('contacts');
    setAddFriendRequest(n => n + 1);
  };
  const handleScan = () => {
    closeAddMenu();
    setShowScan(true);
  };
  // 扫码入群成功回调：带 convId 则打开该群会话
  const handleScanDone = useCallback((convId) => {
    setShowScan(false);
    if (convId) {
      window.dispatchEvent(new CustomEvent('touliao:open-conversation', {
        detail: { conversationId: convId },
      }));
    }
  }, []);
  // 稳定引用：ContactList 消费"添加朋友"信号后复位为 0（避免 effect 依赖每帧变化）
  const handleAddFriendConsumed = useCallback(() => setAddFriendRequest(0), []);

  // 各端共用的浮层（二维码 / 添加菜单 / 建群 / 网络搜索 / 通话）
  const overlays = (
    <>
      <ReconnectingBanner />
      <CallSoundGuide />
      <PushPermissionGuide permission={pushPermission} onEnable={enablePush} />
      {activeCall && (
        <Suspense fallback={null}>
          <CallModal
            socket={socket}
            user={user}
            call={activeCall}
            onClose={() => setActiveCall(null)}
            onReplyMessage={handleReplyFromCall}
          />
        </Suspense>
      )}
      {groupCall && (
        <Suspense fallback={null}>
          <GroupCallModal
            socket={socket}
            user={user}
            session={groupCall}
            onClose={() => setGroupCall(null)}
          />
        </Suspense>
      )}
      {groupCallInvite && !groupCall && (
        <div style={{ position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: "calc(var(--z-call) + 100)", background: 'var(--bg-ctx-menu)', color: 'var(--text-inverse)', borderRadius: 'var(--radius-lg)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 8px 28px rgba(0,0,0,.4)' }}>
          <span style={{ fontSize: 'var(--text-base)' }}>
            {t('chat.groupCallInviteTemplate').replace('{name}', groupCallInvite.fromName || t('chat.groupMemberDefault')).replace('{type}', groupCallInvite.type === 'video' ? t('chat.callTypeVideo') : t('chat.callTypeVoice'))}
          </span>
          <button onClick={joinGroupCall} style={{ background: 'var(--color-primary,#6D5AE6)', color: 'var(--text-inverse)', border: 0, borderRadius: 'var(--radius-input)', padding: '6px 14px', cursor: 'pointer' }}>{t('chat.join')}</button>
          <button onClick={() => setGroupCallInvite(null)} style={{ background: 'transparent', color: 'rgba(255,255,255,.6)', border: 0, cursor: 'pointer' }}>{t('chat.ignore')}</button>
        </div>
      )}
      {showQR && (
        <div className="wc-modal-overlay" role="button" tabIndex={0} onClick={() => setShowQR(false)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowQR(false); } }}>
          <div className="wc-modal home-qr-modal" role="dialog" aria-modal="true" aria-label={t('home.myQrCode')} onClick={e => e.stopPropagation()}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">{t('home.myQrCode')}</span>
              <button className="wc-modal-close" aria-label={t('home.closeQr')} onClick={() => setShowQR(false)}>✕</button>
            </div>
            <div className="wc-modal-body home-qr-body">
              <AuthImage src="/api/users/me/qrcode" alt={t('home.myQrCode')} className="home-qr-img" />
              <p className="home-qr-text">{t('home.scanToAddFriend')}</p>
            </div>
          </div>
        </div>
      )}
      {showAddMenu && addMenuPos && (
        <>
          <div className="home-add-overlay" role="button" tabIndex={0} onClick={closeAddMenu}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeAddMenu(); } }} />
          <div className="home-add-dropdown" style={{ top: addMenuPos.top, right: addMenuPos.right }}>
            <AddDropItem testid="create-group-entry" icon={<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>}
              label={t('home.createGroupTitle')} onClick={handleCreateGroup} />
            <div className="home-add-divider" />
            <AddDropItem icon={<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>}
              label={t('home.addFriendMenuLabel')} onClick={handleAddFriend} />
            <div className="home-add-divider" />
            <AddDropItem testid="scan-qr-entry" icon={<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h3v2h-3v-2zm-5 0h3v3h-2v-1h-1v-2zm5 5h3v3h-3v-3zm-5 0h3v3h-3v-3z"/></svg>}
              label={t('home.scanMenuLabel')} onClick={handleScan} />
          </div>
        </>
      )}
      {showCreateGroup && (
        <CreateGroupModal onClose={() => setShowCreateGroup(false)}
          onCreated={(conv) => { setShowCreateGroup(false); handleSelectConv(conv); }} />
      )}
      {netSearchQ !== null && (
        <Suspense fallback={null}><AddFriendModal initialQuery={netSearchQ} onClose={() => setNetSearchQ(null)} onStartChat={(conv) => { setNetSearchQ(null); handleSelectConv(conv); }} /></Suspense>
      )}
      {showMentions && (
        <div className="wc-modal-overlay" role="button" tabIndex={0}
          onClick={e => e.target === e.currentTarget && setShowMentions(false)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowMentions(false); } }}>
          <div role="dialog" aria-modal="true" aria-label={t('home.mentionsAriaLabel')}
            style={{ width: 'min(440px, 92vw)', height: 'min(70vh, 640px)', background: 'var(--bg-panel)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 12px 48px rgba(0,0,0,.28)' }}
            onClick={e => e.stopPropagation()}>
            <Suspense fallback={null}>
              <MentionList onClose={() => setShowMentions(false)} onJumpToMsg={handleJumpToMention} />
            </Suspense>
          </div>
        </div>
      )}
      {showScan && (
        <Suspense fallback={null}>
          <ScanQR onClose={handleScanDone} />
        </Suspense>
      )}
    </>
  );

  // ── 移动端布局（宽度 < 768 或原生 App）：底部 TabBar + 全屏页 + 全屏聊天 ──
  if (isMobile) {
    // 底部栏与桌面侧边栏同源（visibleTabs）：tab 集合与文案保持一致，
    // 含「收藏」，moments 统一显示「朋友圈」（不再用 M_LABEL 覆盖成「发现」）。
    const mobileTabs = visibleTabs(features);
    const mLabel = (k) => { const found = TABS.find(tb => tb.key === k); return found ? t(found.labelKey) : ''; };

    return (
      <div className="m-shell">
        {activeConv ? (
          <div className="m-chat-page">
            <ChatWindowBoundary convId={activeConv.id}>
              <Suspense fallback={<ChatSkeleton />}>
                <ChatWindow key={activeConv.id} conversation={activeConv} features={features} onClose={handleMobileBack} onStartCall={handleStartCall} onStartGroupCall={handleStartGroupCall} onStartChat={handleMobileSelectConv} />
              </Suspense>
            </ChatWindowBoundary>
          </div>
        ) : (
          <>
            <div className="m-page">
              {(tab === 'chats' || tab === 'contacts') ? (
                <>
                  <div className="m-topbar">
                    <span className="m-title">{mLabel(tab)}</span>
                    {tab === 'chats' && (
                      <button ref={addBtnRef} className="m-topbar-add" data-testid="add-menu-btn" onClick={toggleAddMenu} aria-label={t('home.launch')}>
                        <IcoAdd className="ico-md" />
                      </button>
                    )}
                  </div>
                  <div className="m-search">
                    <span className="m-search-icon"><IcoSearch className="ico-sm" /></span>
                    <input placeholder={t('common.search')} aria-label={t('common.search')} value={search}
                      onChange={e => setSearch(e.target.value)} />
                    {search && <button className="m-search-clear" aria-label={t('common.clear')} onClick={() => setSearch('')}>✕</button>}
                  </div>
                </>
              ) : (
                <div className="m-topbar">
                  <span className="m-title">{mLabel(tab)}</span>
                </div>
              )}
              <div className="m-content">
                {search.trim() ? (
                  <GlobalSearch query={search}
                    onSelectConv={(conv) => { handleMobileSelectConv(conv); setSearch(''); }}
                    onNetworkSearch={(q) => setNetSearchQ(q || search)} />
                ) : tab === 'chats' ? (
                  <ChatList onSelectConv={handleMobileSelectConv} activeConvId={activeConv?.id}
                    unread={unread} searchQuery={search}
                    convRefreshKey={convRefreshKey} onOpenMentions={() => setShowMentions(true)} />
                ) : renderMain()}
              </div>
            </div>

            <nav className="m-tabbar" aria-label={t('home.mainNav')}>
              {mobileTabs.map(({ key, Icon, labelKey }) => {
                const count = badges[key] || 0;
                const label = t(labelKey);
                return (
                  <button key={key} data-testid={`nav-tab-${key}`} className={`m-tab${tab === key ? ' active' : ''}`}
                    role="tab" aria-selected={tab === key} aria-label={label}
                    onClick={() => handleTabChange(key)}>
                    <span className="m-tab-ico"><Icon /></span>
                    <span className="m-tab-label">{label}</span>
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
        <div className="wc-sidebar-btns" role="tablist" aria-label={t('home.mainNav')}>
          {visibleTabs(features).map(({ key, Icon, labelKey }) => {
            const count = badges[key] || 0;
            const label = t(labelKey);
            return (
              <div key={key}
                data-testid={`nav-tab-${key}`}
                className={`wc-sidebar-btn${tab === key ? ' active' : ''}`}
                onClick={() => handleTabChange(key)} title={label}
                role="tab" tabIndex={0} aria-selected={tab === key} aria-label={label}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTabChange(key); } }}>
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
                <span className="wc-search-icon"><IcoSearch className="ico-sm" /></span>
                <input
                  placeholder={t('common.search')}
                  aria-label={t('common.search')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && tab === 'contacts') { e.preventDefault(); setAddFriendRequest(n => n + 1); } }}
                />
                {search && (
                  <button className="home-search-clear" aria-label={t('common.clear')}
                    onClick={() => setSearch('')}>✕</button>
                )}
              </div>

              {/* 添加按钮 */}
              <button ref={addBtnRef} className="wc-icon-btn" data-testid="add-menu-btn" title={t('home.launch')} aria-label={t('home.launch')} aria-expanded={showAddMenu} onClick={toggleAddMenu}>
                <IcoAdd className="ico-md" />
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
                  <Suspense fallback={<div className="wc-lazy-pane" />}>
                    <ChatWindow key={activeConv.id} conversation={activeConv} features={features} onClose={isMobile ? handleMobileBack : () => setActiveConv(null)} onStartCall={handleStartCall} onStartGroupCall={handleStartGroupCall} onStartChat={handleSelectConv} />
                  </Suspense>
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

function AddDropItem({ icon, label, onClick, testid }) {
  return (
    <div onClick={onClick} data-testid={testid}
      className="adi-row" role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      <span className="adi-icon">{icon}</span>
      <span className="adi-label">{label}</span>
    </div>
  );
}
