import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import UserProfile from './UserProfile';
import { GroupAvatar } from './GroupInfo';
import { useSocket } from '../contexts/SocketContext';
import AddFriendModal from './AddFriendModal';

/* ── 主组件 ── */
export default function ContactList({ onStartChat, searchQuery = '', addFriendRequest = 0 }) {
  const [contacts, setContacts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [tab, setTab] = useState('contacts');
  const [requestsSubTab, setRequestsSubTab] = useState('received');
  const [onlineIds, setOnlineIds] = useState(new Set());
  const [activeChar, setActiveChar] = useState(null);
  const [viewProfile, setViewProfile] = useState(null);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const listRef = useRef(null);
  const { socket } = useSocket();

  // 统一兜底成数组：若接口异常返回非数组，避免下方 .filter/.map 抛错导致整页白屏
  const fetchContacts = useCallback(() =>
    axios.get('/api/users/contacts').then(r => setContacts(Array.isArray(r.data) ? r.data : [])).catch(() => setContacts([])), []);
  const fetchRequests = useCallback(() =>
    axios.get('/api/users/friend-requests').then(r => setRequests(Array.isArray(r.data) ? r.data : [])).catch(() => setRequests([])), []);
  const fetchSent = useCallback(() =>
    axios.get('/api/users/friend-requests/sent').then(r => setSentRequests(Array.isArray(r.data) ? r.data : [])).catch(() => setSentRequests([])), []);
  const fetchBlocked = useCallback(() =>
    axios.get('/api/users/me/blocked').then(r => setBlockedUsers(Array.isArray(r.data) ? r.data : [])).catch(() => setBlockedUsers([])), []);
  const fetchGroups = useCallback(() =>
    axios.get('/api/messages/my-groups').then(r => setGroups(Array.isArray(r.data) ? r.data : [])).catch(() => setGroups([])), []);

  useEffect(() => {
    fetchContacts(); fetchRequests(); fetchSent(); fetchGroups();
  }, [fetchContacts, fetchRequests, fetchSent, fetchGroups]);

  useEffect(() => {
    if (!socket) return;
    const onOnline = ({ userId }) => setOnlineIds(prev => new Set([...prev, userId]));
    const onOffline = ({ userId }) => setOnlineIds(prev => { const s = new Set(prev); s.delete(userId); return s; });
    const onFriendReq = (req) => setRequests(prev => [req, ...prev]);
    const onAccepted = () => { fetchContacts(); fetchRequests(); fetchSent(); };
    const onNewConv = () => fetchGroups();
    socket.on('user_online', onOnline);
    socket.on('user_offline', onOffline);
    socket.on('new_friend_request', onFriendReq);
    socket.on('friend_request_accepted', onAccepted);
    socket.on('new_conversation', onNewConv);
    socket.on('group_updated', onNewConv);
    return () => {
      socket.off('user_online', onOnline);
      socket.off('user_offline', onOffline);
      socket.off('new_friend_request', onFriendReq);
      socket.off('friend_request_accepted', onAccepted);
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
    window.addEventListener('vxin:remark-changed', handler);
    return () => window.removeEventListener('vxin:remark-changed', handler);
  }, [fetchContacts]);

  // 从顶栏"添加朋友"入口触发
  useEffect(() => {
    if (!addFriendRequest) return;
    setShowAddFriend(true);
  }, [addFriendRequest]);

  const handleRequest = async (id, action) => {
    await axios.post(`/api/users/friend-request/${id}/handle`, { action });
    setRequests(prev => prev.filter(r => r.id !== id));
    if (action === 'accepted') fetchContacts();
  };

  const unblock = async (userId) => {
    await axios.delete(`/api/users/block/${userId}`);
    setBlockedUsers(prev => prev.filter(u => u.id !== userId));
  };

  const startChat = (contact) => {
    axios.post('/api/messages/conversation/private', { userId: contact.id }).then(({ data }) => {
      onStartChat({ id: data.conversationId, type: 'private', name: contact.remark || contact.username, avatar: contact.avatar, otherUser: contact });
    });
  };

  // 按首字母分组联系人
  const grouped = {};
  const filtered = contacts.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (c.remark || c.username || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
  });
  filtered.forEach(c => {
    const name = c.remark || c.username || '';
    const first = name[0]?.toUpperCase() || '#';
    const letter = /[A-Z]/.test(first) ? first : '#';
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push(c);
  });
  const letters = Object.keys(grouped).sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b));

  const scrollToLetter = (l) => {
    const el = listRef.current?.querySelector(`[data-letter="${l}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="cl-panel">
      <div className="wc-list" ref={listRef}>

        {/* 联系人主列表 */}
        {tab === 'contacts' && (
          <>
            {/* 功能入口 */}
            <EntryRow
              icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-inverse)"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>}
              color="#FA9D3B" label="新的朋友" badge={requests.length}
              onClick={() => setTab('requests')}
            />
            <EntryRow
              icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-inverse)"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>}
              color="#07C160" label="群聊" badge={0}
              onClick={() => setTab('groups')}
            />
            <EntryRow
              icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-inverse)"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>}
              color="#4A8CFF" label="添加好友" badge={0}
              onClick={() => setShowAddFriend(true)}
            />
            <EntryRow
              icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-inverse)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>}
              color="#8A93A6" label="黑名单" badge={0}
              onClick={() => { fetchBlocked(); setTab('blocked'); }}
            />
            <EntryRow
              icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-inverse)"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>}
              color="#10AEFF" label="文件传输助手" badge={0}
              onClick={async () => {
                try {
                  const { data } = await axios.get('/api/messages/file-helper');
                  onStartChat({ id: data.conversationId, type: 'filehelper', name: '文件传输助手', avatar: '' });
                } catch {}
              }}
            />

            <div className="cl-divider" />

            {/* 字母分组联系人 */}
            {letters.map(letter => (
              <div key={letter}>
                <div className="wc-contacts-alpha" data-letter={letter}>{letter}</div>
                {grouped[letter].map(c => (
                  <div key={c.id} className="wc-contact-item" onClick={() => setViewProfile(c.id)}
                    role="button" tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && setViewProfile(c.id)}>
                    <div className="cl-avatar-wrap">
                      <Avatar src={c.avatar} name={c.remark || c.username} size={40}
                        style={{ borderRadius: 6 }}
                        online={onlineIds.has(c.id)} />
                    </div>
                    <div className="cl-contact-info">
                      <div className="wc-contact-item-name">{c.remark || c.username}</div>
                      {c.remark && <div className="wc-contact-item-sub">{c.username}</div>}
                    </div>
                    {onlineIds.has(c.id) && (
                      <span className="cl-online-tag">在线</span>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {contacts.length === 0 && !searchQuery && (
              <div className="cl-empty" role="status">
                <svg viewBox="0 0 48 48" width="48" height="48" fill="none" className="cl-empty-icon">
                  <circle cx="24" cy="20" r="10" fill="#E8ECF0"/>
                  <path d="M8 40c0-8.84 7.16-16 16-16s16 7.16 16 16" stroke="#D0D7E3" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <div className="cl-empty-text">暂无联系人</div>
                <div className="cl-empty-sub">通过搜索添加好友</div>
                <button className="cl-add-btn" onClick={() => setShowAddFriend(true)}>+ 添加好友</button>
              </div>
            )}
            {searchQuery && filtered.length === 0 && (
              <div className="cl-empty" role="status">
                <div className="cl-empty-text">未找到「{searchQuery}」</div>
              </div>
            )}
          </>
        )}

        {/* 新的朋友 */}
        {tab === 'requests' && (
          <>
            <SectionHeader title="新的朋友" onBack={() => setTab('contacts')} />
            <div className="cl-subtabs">
              <button className={`cl-subtab${requestsSubTab === 'received' ? ' active' : ''}`}
                onClick={() => setRequestsSubTab('received')}>
                收到{requests.length > 0 ? ` (${requests.length})` : ''}
              </button>
              <button className={`cl-subtab${requestsSubTab === 'sent' ? ' active' : ''}`}
                onClick={() => { setRequestsSubTab('sent'); fetchSent(); }}>
                已发送
              </button>
            </div>

            {requestsSubTab === 'received' && (
              <>
                {requests.length === 0 && (
                  <div className="cl-empty" role="status">
                    <svg viewBox="0 0 24 24" width="40" height="40" fill="#D0D7E3" className="cl-empty-icon">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                    </svg>
                    <div className="cl-empty-text">暂无新申请</div>
                  </div>
                )}
                {requests.map(r => (
                  <div key={r.id} className="req-item">
                    <Avatar src={r.avatar || r.from?.avatar} name={r.username || r.from?.username} size={46} className="cl-avatar-rounded" />
                    <div className="req-info">
                      <div className="req-name">{r.username || r.from?.username}</div>
                      <div className="req-msg">{r.message || '请求添加您为好友'}</div>
                    </div>
                    <div className="req-btns">
                      <button className="req-accept" onClick={() => handleRequest(r.id, 'accepted')}>接受</button>
                      <button className="req-reject" onClick={() => handleRequest(r.id, 'rejected')}>拒绝</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {requestsSubTab === 'sent' && (
              <>
                {sentRequests.length === 0 && (
                  <div className="cl-empty" role="status">
                    <div className="cl-empty-text">暂无已发送申请</div>
                  </div>
                )}
                {sentRequests.map(r => (
                  <div key={r.id} className="req-item">
                    <Avatar src={r.avatar} name={r.username} size={46} className="cl-avatar-rounded" />
                    <div className="req-info">
                      <div className="req-name">{r.username}</div>
                      <div className="req-msg">{r.message || '请求添加对方为好友'}</div>
                    </div>
                    <span className={`req-status req-status-${r.status}`}>
                      {r.status === 'pending' ? '等待验证' : r.status === 'accepted' ? '已添加' : '已拒绝'}
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* 黑名单 */}
        {tab === 'blocked' && (
          <>
            <SectionHeader title="黑名单" onBack={() => setTab('contacts')} />
            {blockedUsers.length === 0 && (
              <div className="cl-empty" role="status">
                <div className="cl-empty-text">黑名单为空</div>
              </div>
            )}
            {blockedUsers.map(u => (
              <div key={u.id} className="req-item">
                <Avatar src={u.avatar} name={u.username} size={46} className="cl-avatar-rounded" />
                <div className="req-info">
                  <div className="req-name">{u.username}</div>
                </div>
                <button className="req-reject" onClick={() => unblock(u.id)}>移除</button>
              </div>
            ))}
          </>
        )}

        {/* 群聊列表 */}
        {tab === 'groups' && (
          <>
            <SectionHeader title={`群聊 (${groups.length})`} onBack={() => setTab('contacts')} />
            {groups.map(g => (
              <div key={g.id} className="wc-contact-item"
                onClick={() => onStartChat({ id: g.id, type: 'group', name: g.name, avatar: g.avatar || '', members: [] })}
                role="button" tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && onStartChat({ id: g.id, type: 'group', name: g.name, avatar: g.avatar || '', members: [] })}>
                <GroupAvatar members={g.members || []} avatar={g.avatar} size={40} />
                  <div className="cl-contact-info">
                  <div className="wc-contact-item-name">{g.name}</div>
                  <div className="wc-contact-item-sub">{g.memberCount} 人</div>
                </div>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--text-tertiary)">
                  <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                </svg>
              </div>
            ))}
            {groups.length === 0 && (
              <div className="cl-empty" role="status">
                <div className="cl-empty-groups">还没有群聊</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 字母索引 */}
      {tab === 'contacts' && letters.length > 0 && (
        <div className="wc-alpha-index">
          {letters.map(l => (
            <span key={l} className="wc-alpha-char"
              onClick={() => { scrollToLetter(l); setActiveChar(l); setTimeout(() => setActiveChar(null), 800); }}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && (scrollToLetter(l), setActiveChar(l), setTimeout(() => setActiveChar(null), 800))}>
              {l}
            </span>
          ))}
        </div>
      )}
      {activeChar && <div className="wc-alpha-bubble">{activeChar}</div>}

      {/* 添加好友弹窗 */}
      {showAddFriend && <AddFriendModal onClose={() => setShowAddFriend(false)} />}

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

function EntryRow({ icon, color, label, badge, onClick }) {
  return (
    <div className="wc-contact-item gi-cp" onClick={onClick}
      role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick?.(e)}>
      <div className="cl-entry-icon-box" style={{ background: color }}>
        {icon}
      </div>
      <div className="cl-entry-name">
        <span className="wc-contact-item-name">{label}</span>
      </div>
      {badge > 0 && (
        <span className="cl-entry-badge">
          {badge}
        </span>
      )}
      <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--text-tertiary)" className="cl-entry-arrow">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
      </svg>
    </div>
  );
}

function SectionHeader({ title, onBack }) {
  return (
    <div className="cl-section-header">
      <button onClick={onBack} className="cl-section-back">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg>
        返回
      </button>
      <span className="cl-section-title">{title}</span>
    </div>
  );
}
