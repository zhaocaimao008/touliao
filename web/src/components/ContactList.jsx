import { EmptyState } from './StateViews';
import TouliaoIcon from '../ui-kit/Icon';
import React, { useState, useEffect, useCallback, useRef, useMemo, memo, Suspense } from 'react';
import Avatar from './Avatar';

import UserProfile from './UserProfile';
import './ContactList.css';
import { GroupAvatar } from './GroupAvatar';
import { useSocketCore } from '../contexts/SocketContext'; // 只订阅 socket，重连不触发无关 re-render
// 懒加载：AddFriendModal 仅在点「添加朋友」时才渲染，避免打进 ContactList/Home 首屏 chunk
const AddFriendModal = lazyWithRetry(() => import('./AddFriendModal'));
import { showConfirm } from '../utils/toast';
import { firstLetter, comparePinyin } from '../utils/pinyin';
import { formatLastOnline } from '../utils/time';
import { useI18n } from '../contexts/I18nContext';
import { IcoBack, IcoCheck, IcoPersonAdd } from './Icons';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { useDirectoryResource } from '../hooks/useDirectoryResource';
import DirectoryFeedback from './DirectoryFeedback';
import ConversationOpenFeedback from './ConversationOpenFeedback';
import { useOpenConversation } from '../hooks/useOpenConversation';
import { useDirectoryFocus } from '../hooks/useDirectoryFocus';
import { matchesContact, normalizeContactQuery } from '../utils/contactSearch';
import { useDirectoryAction } from '../hooks/useDirectoryAction';
import DirectoryActionFeedback from './DirectoryActionFeedback';
import { handleFriendRequest, unblockContact, saveFriendLabel, deleteFriendLabel, changeLabelMember } from '../utils/directoryActions';
import { keepSettingFocus } from '../utils/settingFocus';

const selectAiBots = data => data?.features?.aiAssistants;

function formatRequestTime(timestamp, formatter) {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return formatter.format(date);
}

function RequestTime({ timestamp, formatter }) {
  const text = formatRequestTime(timestamp, formatter);
  if (!text) return null;
  return <time className="req-time" dateTime={new Date(Number(timestamp) * 1000).toISOString()}>{text}</time>;
}

/* ── 主组件 ── */
export default function ContactList({ onStartChat, searchQuery = '', addFriendRequest = 0, onAddFriendConsumed, openFriendRequests = 0, onOpenFriendRequestsConsumed }) {
  const { t, lang } = useI18n();
  const requestTimeFormatter = useMemo(() => new Intl.DateTimeFormat(lang, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }), [lang]);
  const contactResource = useDirectoryResource('/api/users/contacts');
  const requestResource = useDirectoryResource('/api/users/friend-requests');
  const sentResource = useDirectoryResource('/api/users/friend-requests/sent');
  const blockedResource = useDirectoryResource('/api/users/me/blocked');
  const groupResource = useDirectoryResource('/api/messages/my-groups');
  const labelResource = useDirectoryResource('/api/friend-labels');
  const aiResource = useDirectoryResource('/api/config', selectAiBots);
  const { data: contacts, setData: setContacts, reload: fetchContacts } = contactResource;
  const { data: requests, commitData: setRequests, reload: fetchRequests } = requestResource;
  const { data: sentRequests, reload: fetchSent } = sentResource;
  const { data: blockedUsers, commitData: setBlockedUsers, reload: fetchBlocked } = blockedResource;
  const { data: groups, reload: fetchGroups } = groupResource;
  const { data: labels, reload: fetchLabels } = labelResource;
  const { data: aiBots, reload: fetchAiBots } = aiResource;
  const normalizedQuery = normalizeContactQuery(searchQuery);
  const [tab, setTab] = useState('contacts');
  const [requestsSubTab, setRequestsSubTab] = useState('received');
  const [onlineIds, setOnlineIds] = useState(new Set());
  const [activeChar, setActiveChar] = useState(null);
  const [viewProfile, setViewProfile] = useState(null);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const directoryAction = useDirectoryAction(JSON.stringify([tab, requestsSubTab, viewProfile, showAddFriend]));
  const listRef = useRef(null);
  const navigation = useOpenConversation(onStartChat, JSON.stringify([tab, normalizedQuery, viewProfile, showAddFriend]));
  useDirectoryFocus(listRef, tab);
  const { socket } = useSocketCore();

  useEffect(() => {
    fetchContacts(); fetchRequests(); fetchSent(); fetchGroups(); fetchLabels(); fetchAiBots();
  }, [fetchContacts, fetchRequests, fetchSent, fetchGroups, fetchLabels, fetchAiBots]);

  useEffect(() => {
    if (!socket) return;
    const onOnline = ({ userId }) => setOnlineIds(prev => new Set([...prev, userId]));
    const onOffline = ({ userId }) => setOnlineIds(prev => { const s = new Set(prev); s.delete(userId); return s; });
    const onFriendReq = () => fetchRequests();
    const onAccepted = () => { fetchContacts(); fetchRequests(); fetchSent(); };
    const onProfile = () => fetchContacts(); // 好友改了昵称/头像
    socket.on('user_profile_updated', onProfile);
    // 2026-08-29 新增：本账号在别的设备拒绝了申请 → 这台设备也刷新，去掉那条已处理的申请，
    // 否则会停留在"接受/拒绝"两个按钮上，点击时后端返回"请求不存在"(该请求已非pending状态)。
    const onRejected = () => fetchRequests();
    const onNewConv = () => fetchGroups();
    socket.on('user_online', onOnline);
    socket.on('user_offline', onOffline);
    socket.on('new_friend_request', onFriendReq);
    socket.on('friend_request_accepted', onAccepted);
    socket.on('friend_request_rejected', onRejected);
    socket.on('new_conversation', onNewConv);
    socket.on('group_updated', onNewConv);
    return () => {
      socket.off('user_profile_updated', onProfile);
      socket.off('user_online', onOnline);
      socket.off('user_offline', onOffline);
      socket.off('new_friend_request', onFriendReq);
      socket.off('friend_request_accepted', onAccepted);
      socket.off('friend_request_rejected', onRejected);
      socket.off('new_conversation', onNewConv);
      socket.off('group_updated', onNewConv);
    };
  }, [socket, fetchContacts, fetchGroups, fetchRequests, fetchSent]);

  useEffect(() => {
    const handler = ({ detail }) => {
      const { userId, remark } = detail || {};
      if (userId) setContacts(prev => prev.map(c => c.id === userId ? { ...c, remark: remark || '' } : c));
      fetchContacts();
    };
    window.addEventListener('touliao:remark-changed', handler);
    return () => window.removeEventListener('touliao:remark-changed', handler);
  }, [fetchContacts, setContacts]);

  // 从顶栏"添加朋友"入口触发（addFriendRequest 为递增触发信号）——
  // 用 render 期上一次值比较替代 effect，避免 effect 内同步 setState。
  // ⚠ 关键修复：seenAddReq 初值必须为 0（而非 addFriendRequest）。
  //   顶栏点"添加朋友"若当前不在通讯录页，会「切 tab + bump 信号」同批发生，
  //   本组件首次挂载时收到的已是自增后的值；若初值取 addFriendRequest，
  //   则挂载即相等 → 首次不弹窗，须点第二次才生效（历史 bug）。
  //   初值取 0 后，任何 >0 的信号在挂载/更新时都会被检测到 → 首次即弹窗。
  const [seenAddReq, setSeenAddReq] = useState(0);
  if (addFriendRequest !== seenAddReq) {
    setSeenAddReq(addFriendRequest);
    if (addFriendRequest) setShowAddFriend(true);
  }
  // 弹窗被触发（信号 >0 且已 seen）后，用 effect 把 Home 信号复位为 0：
  // 放到 commit 之后而非 render 期调用父 setState，避免"渲染子组件时更新父组件"警告；
  // 复位后可防止用户关闭弹窗、再次切回通讯录时被"残留信号"误触发重开。
  useEffect(() => {
    if (addFriendRequest && addFriendRequest === seenAddReq) onAddFriendConsumed?.();
  }, [addFriendRequest, seenAddReq, onAddFriendConsumed]);

  // 2026-08-29 好友申请提醒优化新增：点顶部轻通知卡片「查看」→ 直接跳到「新的朋友」收到列表。
  // 同一递增信号模式（理由同上：初值必须为0，否则挂载时若信号已>0会被判定"已经见过"而不生效）。
  const [seenOpenReq, setSeenOpenReq] = useState(0);
  if (openFriendRequests !== seenOpenReq) {
    setSeenOpenReq(openFriendRequests);
    if (openFriendRequests) { setTab('requests'); setRequestsSubTab('received'); }
  }
  useEffect(() => {
    if (openFriendRequests && openFriendRequests === seenOpenReq) onOpenFriendRequestsConsumed?.();
  }, [openFriendRequests, seenOpenReq, onOpenFriendRequestsConsumed]);

  const handleRequest = (id, action) => keepSettingFocus(() => directoryAction.run({
    key: `request:${id}:${action}`,
    request: config => handleFriendRequest(id, action, config),
    commit: () => {
      setRequests(prev => prev.filter(r => r.id !== id));
      if (action === 'accepted') fetchContacts();
    },
    reconcile: () => Promise.all([fetchRequests(), fetchContacts()]),
  }));

  const unblock = userId => keepSettingFocus(() => directoryAction.run({
    key: `unblock:${userId}`,
    request: config => unblockContact(userId, config),
    commit: () => setBlockedUsers(prev => prev.filter(u => u.id !== userId)),
    reconcile: fetchBlocked,
  }));

  // 按首字母分组联系人（含拼音排序，较贵；仅 contacts/搜索词变化时重算，避免每次渲染都跑）
  const { grouped, filtered, letters } = useMemo(() => {
    const grouped = {};
    const filtered = contacts.filter(c => matchesContact(c, normalizedQuery));
    filtered.forEach(c => {
      const name = c.remark || c.username || '';
      const letter = firstLetter(name); // 汉字按拼音首字母归组（张→Z），而非全部落入 #
      if (!grouped[letter]) grouped[letter] = [];
      grouped[letter].push(c);
    });
    // 组内按拼音升序，让同字母下的中文名有稳定可预期的顺序
    Object.values(grouped).forEach(arr =>
      arr.sort((a, b) => comparePinyin(a.remark || a.username || '', b.remark || b.username || '')));
    const letters = Object.keys(grouped).sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b));
    return { grouped, filtered, letters };
  }, [contacts, normalizedQuery]);

  // 固定引用：传给 memo 的 ContactRow，避免每次渲染新建函数击穿 memo。
  const openProfile = useCallback((id) => setViewProfile(id), [setViewProfile]);

  const scrollToLetter = (l) => {
    const el = listRef.current?.querySelector(`[data-letter="${l}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="cl-panel">
      <div className="wc-list" ref={listRef}>
        <ConversationOpenFeedback navigation={navigation} />

        {/* 联系人主列表 */}
        {tab === 'contacts' && (
          <>
            {/* 功能入口：真实功能保持原有处理函数 */}
            {!normalizedQuery && <div className="tl-contact-actions">
            <div className="tl-contact-shortcuts tl-contact-primary">
            <EntryRow
              icon={<IcoPersonAdd size="sm" />}
              color="var(--icon-bg-newfriend)" label={t('contacts.newFriends')} badge={requests.length}
              section="requests" onClick={() => setTab('requests')} testid="cl-new-friends-entry"
            />
            <EntryRow
              icon={<TouliaoIcon name="group" size="sm" />}
              color="var(--icon-bg-group)" label={t('contacts.groupChats')} badge={0}
              section="groups" onClick={() => setTab('groups')}
            />
            <EntryRow
              icon={<TouliaoIcon name="search" size="sm" />}
              color="var(--brand-500)" label={t('contacts.addFriend')} badge={0}
              onClick={() => setShowAddFriend(true)}
            />
            </div>
            <details className="tl-contact-more">
              <summary>{t('contacts.moreTools')}<TouliaoIcon name="back" size="xs" /></summary>
              <div className="tl-contact-shortcuts tl-contact-secondary">
            <EntryRow
              icon={<TouliaoIcon name="blocked" size="sm" />}
              color="var(--icon-bg-neutral)" label={t('contacts.blacklist')} badge={0}
              section="blocked" onClick={() => { fetchBlocked(); setTab('blocked'); }}
            />
            <EntryRow
              icon={<TouliaoIcon name="tag" size="sm" />}
              color="var(--icon-bg-label)" label={t('contacts.friendLabels')} badge={0}
              section="labels" onClick={() => { fetchLabels(); setTab('labels'); }}
            />
            <EntryRow
              icon={<TouliaoIcon name="chat" size="sm" />}
              color="var(--brand-500)" label={t('contacts.aiAssistant')} badge={aiBots.length}
              section="ai" onClick={() => setTab('ai')}
            />
            <EntryRow
              icon={<TouliaoIcon name="fileContent" size="sm" />}
              color="var(--icon-bg-filehelper)" label={t('contacts.fileHelper')} badge={0}
              busy={navigation.openingKey === 'conversation:filehelper'}
              onClick={() => navigation.openConversation({ type: 'filehelper', name: t('contacts.fileHelper'), avatar: '' })}
            />

              </div>
            </details>
            </div>}
            <div className="cl-divider" />

            <DirectoryFeedback resource={contactResource} />
            {/* 字母分组联系人 */}
            {letters.map(letter => (
              <div key={letter}>
                <div className="wc-contacts-alpha" data-letter={letter}>{letter}</div>
                {grouped[letter].map(c => (
                  <ContactRow key={c.id} contact={c} online={onlineIds.has(c.id)} onOpen={openProfile} />
                ))}
              </div>
            ))}

            {contactResource.emptyReady && contacts.length === 0 && !normalizedQuery && (
              <EmptyState className="cl-empty" icon={<svg viewBox="0 0 48 48" width="48" height="48" fill="none" className="cl-empty-icon">
                  <circle cx="24" cy="20" r="10" fill="#E8ECF0"/>
                  <path d="M8 40c0-8.84 7.16-16 16-16s16 7.16 16 16" stroke="#D0D7E3" strokeWidth="2" strokeLinecap="round"/>
                </svg>} title={<>{t('contacts.noContacts')}</>} desc={<>{t('contacts.searchToAddFriend')}</>} />
            )}
            {normalizedQuery && contactResource.emptyReady && filtered.length === 0 && (
              <EmptyState className="cl-empty" illustration="search" title={<>{t('contacts.notFoundTemplate').replace('{query}', searchQuery.trim())}</>} />
            )}
          </>
        )}

        {/* 新的朋友 */}
        {tab === 'requests' && (
          <>
            <SectionHeader title={t('contacts.newFriends')} onBack={() => setTab('contacts')} />
            <div className="cl-subtabs" role="group" aria-label={t('contacts.newFriends')}>
              <button className={`cl-subtab${requestsSubTab === 'received' ? ' active' : ''}`}
                aria-pressed={requestsSubTab === 'received'} onClick={() => setRequestsSubTab('received')}>
                {t('contacts.received')}{requests.length > 0 ? ` (${requests.length})` : ''}
              </button>
              <button className={`cl-subtab${requestsSubTab === 'sent' ? ' active' : ''}`}
                aria-pressed={requestsSubTab === 'sent'} onClick={() => { setRequestsSubTab('sent'); fetchSent(); }}>
                {t('contacts.sent')}
              </button>
            </div>

            {requestsSubTab === 'received' && (
              <>
                <DirectoryFeedback resource={requestResource} />
                <DirectoryActionFeedback action={directoryAction} />
                {requestResource.emptyReady && requests.length === 0 && (
                  <EmptyState className="cl-empty" icon={<TouliaoIcon name="contact" className="cl-empty-icon" tone="secondary" size="xl" />} title={<>{t('contacts.noNewRequests')}</>} />
                )}
                {requests.map(r => (
                  <div key={r.id} className="req-item" data-testid="friend-request-item">
                    <Avatar src={r.avatar || r.from?.avatar} name={r.username || r.from?.username} size='lg' className="cl-avatar-rounded" />
                    <div className="req-info">
                      <div className="req-name-row">
                        <div className="req-name">{r.username || r.from?.username}</div>
                        <RequestTime timestamp={r.created_at} formatter={requestTimeFormatter} />
                      </div>
                      <div className="req-msg">{r.message || t('contacts.defaultFriendRequestMsg')}</div>
                    </div>
                    <div className="req-btns">
                      <button className="req-accept" data-testid="friend-request-accept" disabled={!!directoryAction.pendingKey} aria-busy={directoryAction.pendingKey === `request:${r.id}:accepted`} onClick={() => handleRequest(r.id, 'accepted')}>{t('contacts.accept')}</button>
                      <button className="req-reject" data-testid="friend-request-reject" disabled={!!directoryAction.pendingKey} aria-busy={directoryAction.pendingKey === `request:${r.id}:rejected`} onClick={() => handleRequest(r.id, 'rejected')}>{t('contacts.reject')}</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {requestsSubTab === 'sent' && (
              <>
                <DirectoryFeedback resource={sentResource} />
                {sentResource.emptyReady && sentRequests.length === 0 && (
                  <EmptyState className="cl-empty" illustration="contacts" title={<>{t('contacts.noSentRequests')}</>} />
                )}
                {sentRequests.map(r => (
                  <div key={r.id} className="req-item">
                    <Avatar src={r.avatar} name={r.username} size='lg' className="cl-avatar-rounded" />
                    <div className="req-info">
                      <div className="req-name-row">
                        <div className="req-name">{r.username}</div>
                        <RequestTime timestamp={r.created_at} formatter={requestTimeFormatter} />
                      </div>
                      <div className="req-msg">{r.message || t('contacts.defaultSentRequestMsg')}</div>
                    </div>
                    <span className={`req-status req-status-${r.status}`}>
                      {r.status === 'pending' ? t('contacts.statusPending') : r.status === 'accepted' ? t('contacts.statusAccepted') : t('contacts.statusRejected')}
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* AI 助手 */}
        {tab === 'ai' && (
          <>
            <SectionHeader title={t('contacts.aiAssistant')} onBack={() => setTab('contacts')} />
            <DirectoryFeedback resource={aiResource} />
            {aiResource.emptyReady && aiBots.length === 0 && (
              <EmptyState className="cl-empty" illustration="chat" title={<>{t('contacts.noAiAssistants')}</>} />
            )}
            {aiBots.map(b => (
              <div key={b.id} className="wc-contact-item"
                onClick={() => navigation.openContact(b)}
                role="button" tabIndex={0} aria-busy={navigation.openingKey === `contact:${b.id}`} aria-disabled={navigation.openingKey === `contact:${b.id}`}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigation.openContact(b); }
                }}>
                <Avatar src={b.avatar || ''} name={b.name} size='md' className="cl-avatar-rounded" />
                <div className="cl-contact-info">
                  <div className="wc-contact-item-name">{b.name}</div>
                  <div className="wc-contact-item-sub">{b.description || t('contacts.aiBotIdTemplate').replace('{id}', b.wechat_id)}</div>
                </div>
                <IcoBack style={{color:"var(--text-tertiary)"}} size="xs" />
              </div>
            ))}
          </>
        )}

        {/* 黑名单 */}
        {tab === 'blocked' && (
          <>
            <SectionHeader title={t('contacts.blacklist')} onBack={() => setTab('contacts')} />
            <DirectoryFeedback resource={blockedResource} />
            <DirectoryActionFeedback action={directoryAction} />
            {blockedResource.emptyReady && blockedUsers.length === 0 && (
              <EmptyState className="cl-empty" illustration="contacts" title={<>{t('contacts.blacklistEmpty')}</>} />
            )}
            {blockedUsers.map(u => (
              <div key={u.id} className="req-item">
                <Avatar src={u.avatar} name={u.username} size='lg' className="cl-avatar-rounded" />
                <div className="req-info">
                  <div className="req-name">{u.username}</div>
                </div>
                <button className="req-reject" disabled={!!directoryAction.pendingKey} aria-busy={directoryAction.pendingKey === `unblock:${u.id}`} onClick={() => unblock(u.id)}>{t('contacts.remove')}</button>
              </div>
            ))}
          </>
        )}

        {/* 好友标签 */}
        {tab === 'labels' && (
          <LabelsTab
            labels={labels}
            contacts={contacts}
            onBack={() => setTab('contacts')}
            resource={labelResource}
            contactResource={contactResource}
          />
        )}

        {/* 群聊列表 */}
        {tab === 'groups' && (
          <>
            <SectionHeader title={t('contacts.groupsCountTemplate').replace('{count}', groups.length)} onBack={() => setTab('contacts')} />
            <DirectoryFeedback resource={groupResource} />
            {groups.map(g => (
              <div key={g.id} className="wc-contact-item"
                onClick={() => navigation.openConversation({ id: g.id, type: 'group', name: g.name, avatar: g.avatar || '', members: g.members || [] })}
                role="button" tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), navigation.openConversation({ id: g.id, type: 'group', name: g.name, avatar: g.avatar || '', members: g.members || [] }))}>
                <GroupAvatar members={g.members || []} avatar={g.avatar} size='md' />
                  <div className="cl-contact-info">
                  <div className="wc-contact-item-name">{g.name}</div>
                  <div className="wc-contact-item-sub">{t('contacts.memberCountTemplate').replace('{count}', g.memberCount)}</div>
                </div>
                <IcoBack style={{color:"var(--text-tertiary)"}} size="xs" />
              </div>
            ))}
            {groupResource.emptyReady && groups.length === 0 && (
              <EmptyState className="cl-empty" illustration="contacts" title={<>{t('contacts.noGroups')}</>} />
            )}
          </>
        )}
      </div>

      {/* 字母索引 */}
      {tab === 'contacts' && letters.length > 0 && (
        <div className="wc-alpha-index">
          {letters.map(l => (
            <span key={l} className="wc-alpha-char" aria-label={t('contacts.jumpToLetterTemplate').replace('{letter}', l)}
              onClick={() => { scrollToLetter(l); setActiveChar(l); setTimeout(() => setActiveChar(null), 800); }}
              role="button" tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), scrollToLetter(l), setActiveChar(l), setTimeout(() => setActiveChar(null), 800))}>
              {l}
            </span>
          ))}
        </div>
      )}
      {activeChar && <div className="wc-alpha-bubble">{activeChar}</div>}

      {/* 添加好友弹窗 */}
      {showAddFriend && <Suspense fallback={null}><AddFriendModal onClose={() => setShowAddFriend(false)} onStartChat={onStartChat} /></Suspense>}

      {/* 查看联系人资料 */}
      {viewProfile && (
        <UserProfile
          userId={viewProfile}
          onClose={() => setViewProfile(null)}
          onStartChat={(conv) => { setViewProfile(null); onStartChat(conv); }}
          onFriendAdded={fetchContacts}
          onFriendDeleted={() => { setViewProfile(null); fetchContacts(); }}
        />
      )}
    </div>
  );
}

/* ── 好友标签 Tab ── */
const getBrandHex = () => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#6D5AE6';
  } catch { return '#6D5AE6'; }
};
const LABEL_COLORS = ['#6D5AE6', '#FA5151', '#17B8A6', '#FF9A00', '#FF6B35', '#8A93A6', '#5B7BF0', '#7D4BF0'];

export function LabelsTab({ labels, contacts, onBack, resource, contactResource }) {
  const { t } = useI18n();
  const [editLabel, setEditLabel] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [colorInput, setColorInput] = useState(getBrandHex);
  const [showMembers, setShowMembers] = useState(null);
  const panelRef = useRef(null);
  const view = editLabel ? `edit:${editLabel === 'new' ? 'new' : editLabel.id}` : showMembers ? `members:${showMembers}` : 'list';
  const action = useDirectoryAction(view);
  const busy = !!action.pendingKey;
  useDirectoryFocus(panelRef, view, 'list');

  const startCreate = () => { setEditLabel('new'); setNameInput(''); setColorInput(getBrandHex()); };
  const startEdit = label => { setEditLabel(label); setNameInput(label.name); setColorInput(label.color || getBrandHex()); };
  const saveLabel = event => {
    event.preventDefault();
    if (!nameInput.trim() || !editLabel) return;
    const id = editLabel === 'new' ? null : editLabel.id;
    const values = { name: nameInput.trim(), color: colorInput };
    return keepSettingFocus(() => action.run({
      key: 'save',
      request: config => saveFriendLabel(id, values, config),
      commit: saved => resource.commitData(previous => id
        ? previous.map(label => label.id === id ? { ...label, ...saved, members: label.members || [] } : label)
        : [...previous.filter(label => label.id !== saved.id), saved]),
      onSuccess: () => setEditLabel(null),
      reconcile: resource.reload,
    }));
  };
  const deleteLabel = id => keepSettingFocus(() => action.run({
    key: `delete:${id}`,
    confirm: () => showConfirm(t('contacts.confirmDeleteLabel')),
    request: config => deleteFriendLabel(id, config),
    commit: () => resource.commitData(previous => previous.filter(label => label.id !== id)),
    reconcile: resource.reload,
  }));
  const toggleMember = (labelId, friendId, remove) => keepSettingFocus(() => action.run({
    key: `member:${friendId}`,
    request: config => changeLabelMember(labelId, friendId, remove, config),
    commit: member => resource.commitData(previous => previous.map(label => label.id !== labelId ? label : {
      ...label,
      members: remove ? (label.members || []).filter(item => item.id !== friendId)
        : [...(label.members || []).filter(item => item.id !== friendId), member],
    })),
    reconcile: resource.reload,
  }));

  let content;
  if (editLabel) {
    const colors = LABEL_COLORS.some(color => color.toLowerCase() === colorInput.toLowerCase())
      ? LABEL_COLORS : [colorInput, ...LABEL_COLORS];
    content = <>
      <SectionHeader title={editLabel === 'new' ? t('contacts.newLabel') : t('contacts.editLabel')} onBack={() => setEditLabel(null)} />
      <DirectoryActionFeedback action={action} />
      {resource.error && <DirectoryFeedback resource={resource} />}
      <form className="lt-edit-pad" onSubmit={saveLabel} aria-busy={busy}>
        <label className="lt-name-label" htmlFor="friend-label-name">{t('contacts.labelName')}</label>
        <input id="friend-label-name" value={nameInput} disabled={busy} data-directory-initial-focus
          onChange={event => setNameInput(event.target.value)} placeholder={t('contacts.labelName')}
          maxLength={20} className="lt-edit-input" autoComplete="off" />
        <div className="lt-name-count" aria-hidden="true">{nameInput.length}/20</div>
        <fieldset className="lt-color-fieldset" disabled={busy}>
          <legend className="lt-edit-label">{t('contacts.color')}</legend>
          <div className="lt-color-grid">
            {colors.map(color => <label className="lt-color-option" key={color}>
              <input type="radio" name="friend-label-color" value={color}
                checked={colorInput.toLowerCase() === color.toLowerCase()}
                aria-label={t('contacts.colorAriaLabelTemplate').replace('{color}', color)}
                onChange={() => setColorInput(color)} />
              <span className="lt-color-swatch" style={{ background: color }} aria-hidden="true">
                {colorInput.toLowerCase() === color.toLowerCase() && <IcoCheck tone="onDark" size="xs" />}
              </span>
            </label>)}
          </div>
        </fieldset>
        <button type="submit" disabled={busy || !nameInput.trim()} className="lt-save-btn">
          {action.pendingKey === 'save' ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </>;
  } else if (showMembers) {
    const label = labels.find(item => item.id === showMembers);
    const memberIds = new Set((label?.members || []).map(member => member.id));
    content = <>
      <SectionHeader title={label ? t('contacts.labelMembersTitleTemplate').replace('{name}', label.name) : t('contacts.friendLabels')} onBack={() => setShowMembers(null)} />
      <DirectoryFeedback resource={resource} />
      <DirectoryActionFeedback action={action} />
      {label ? <>
        <DirectoryFeedback resource={contactResource} />
        <div className="lt-members-pad">
          {contacts.map(contact => {
            const inLabel = memberIds.has(contact.id);
            return <button type="button" key={contact.id} className="wc-contact-item lt-member-row" role="checkbox"
              aria-checked={inLabel} disabled={busy} aria-busy={action.pendingKey === `member:${contact.id}`}
              onClick={() => toggleMember(label.id, contact.id, inLabel)}>
              <Avatar src={contact.avatar} name={contact.remark || contact.username} size="md" />
              <span className="cl-contact-info"><span className="wc-contact-item-name">{contact.remark || contact.username}</span></span>
              <span className={`lt-member-checkbox${inLabel ? ' is-selected' : ''}`} aria-hidden="true">
                {inLabel && <IcoCheck tone="onDark" size="xs" />}
              </span>
            </button>;
          })}
          {contactResource.emptyReady && contacts.length === 0 && <EmptyState className="cl-empty" illustration="contacts" title={t('contacts.noContacts')} />}
        </div>
      </> : resource.emptyReady && <EmptyState className="cl-empty" illustration="contacts" title={t('contacts.labelUnavailable')} />}
    </>;
  } else {
    content = <>
      <SectionHeader title={t('contacts.friendLabels')} onBack={onBack} />
      <DirectoryFeedback resource={resource} />
      <DirectoryActionFeedback action={action} />
      <div className="lt-list-header">
        <button type="button" onClick={startCreate} disabled={busy || !resource.loaded} data-directory-section="edit:new" className="lt-create-btn">
          <TouliaoIcon name="add" size="sm" /> {t('contacts.newLabel')}
        </button>
      </div>
      {resource.emptyReady && labels.length === 0 && <EmptyState className="cl-empty" illustration="contacts" title={t('contacts.noLabels')} desc={t('contacts.noLabelsSub')} />}
      {labels.map(label => <div key={label.id} className="wc-contact-item lt-label-row">
        <div className="lt-label-icon-box" style={{ background: label.color || 'var(--color-primary)' }}><TouliaoIcon name="tag" size="sm" /></div>
        <div className="cl-contact-info">
          <div className="wc-contact-item-name">{label.name}</div>
          <div className="wc-contact-item-sub">{t('contacts.memberCountTemplate').replace('{count}', (label.members || []).length)}</div>
        </div>
        <div className="lt-label-actions" role="group" aria-label={label.name}>
          <button type="button" disabled={busy} onClick={() => setShowMembers(label.id)} data-directory-section={`members:${label.id}`} className="lt-action-btn">{t('contacts.members')}</button>
          <button type="button" disabled={busy} onClick={() => startEdit(label)} data-directory-section={`edit:${label.id}`} className="lt-action-btn">{t('contacts.edit')}</button>
          <button type="button" disabled={busy} aria-busy={action.pendingKey === `delete:${label.id}`} onClick={() => deleteLabel(label.id)} className="lt-delete-btn">{t('contacts.delete')}</button>
        </div>
      </div>)}
    </>;
  }
  return <div ref={panelRef} className="lt-panel">{content}</div>;
}


// 单条联系人行：memo 隔离在线状态抖动。presence(user_online/offline) 事件会频繁改 onlineIds
// 触发 ContactList 整体重渲染——若行不 memo，几百个好友的 vnode 每次都全量 reconcile。
// memo 后仅「在线态真正翻转」或「资料变化」的行会重渲染，其余跳过 DOM diff。
// onOpen 由父层 useCallback 固定引用（否则每次新函数会击穿 memo）。
const ContactRow = memo(function ContactRow({ contact: c, online, onOpen }) {
  const { t } = useI18n();
  const lastOnlineLabel = (c.last_online_at !== undefined && !online)
    ? formatLastOnline(c.last_online_at, false) : '';
  return (
    <div className="wc-contact-item" onClick={() => onOpen(c.id)}
      role="button" tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(c.id))}>
      <div className="cl-avatar-wrap">
        <Avatar src={c.avatar} name={c.remark || c.username} size='md'
          style={{ borderRadius: 'var(--radius-sm)' }}
          online={online} />
      </div>
      <div className="cl-contact-info">
        <div className="wc-contact-item-name">{c.remark || c.username}</div>
        {c.remark && <div className="wc-contact-item-sub">{c.username}</div>}
        {/* 特权账户：精确最后在线时间，在线时不重复显示 */}
        {lastOnlineLabel && <div className="cl-last-online">{lastOnlineLabel}</div>}
      </div>
      {online && (
        <span className="cl-online-tag">{t('contacts.online')}</span>
      )}
    </div>
  );
});

function EntryRow({ icon, color, label, badge, onClick, testid, section, busy = false }) {
  return (
    <button type="button" className="wc-contact-item tl-contact-shortcut gi-cp" onClick={onClick}
      data-testid={testid} data-directory-section={section} aria-busy={busy} aria-disabled={busy}>
      <div className="cl-entry-icon-box" style={{ background: color }}>
        {icon}
      </div>
      <div className="cl-entry-name">
        <span className="wc-contact-item-name">{label}</span>
      </div>
      {badge > 0 && (
        <span className="cl-entry-badge" data-testid={testid ? `${testid}-badge` : undefined}>
          {badge}
        </span>
      )}
      <IcoBack className="cl-entry-arrow" style={{color:"var(--text-tertiary)"}} size="xs" />
    </button>
  );
}

function SectionHeader({ title, onBack }) {
  const { t } = useI18n();
  return (
    <div className="cl-section-header">
      <button onClick={onBack} className="cl-section-back">
        <TouliaoIcon name="back" size="xs" />
        {t('common.back')}
      </button>
      <span className="cl-section-title">{title}</span>
    </div>
  );
}
