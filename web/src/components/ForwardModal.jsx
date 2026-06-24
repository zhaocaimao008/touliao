import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { GroupAvatar } from './GroupInfo';
import { showToast } from '../utils/toast';
import './ForwardModal.css';

export default function ForwardModal({ message, onClose }) {
  const [tab, setTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [friendConvMap, setFriendConvMap] = useState({});
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [sentCount, setSentCount] = useState(0);

  useEffect(() => {
    axios.get('/api/users/contacts').then(r => setFriends(r.data));
    axios.get('/api/messages/my-groups').then(r => setGroups(r.data));
  }, []);

  const filteredFriends = useMemo(() =>
    friends.filter(f => (f.remark || f.username).toLowerCase().includes(search.toLowerCase())),
    [friends, search]
  );
  const filteredGroups = useMemo(() =>
    groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase())),
    [groups, search]
  );

  const isFriendSelected = (friend) => {
    const convId = friendConvMap[friend.id];
    return convId ? selected.has(convId) : false;
  };

  const toggleFriend = async (friend) => {
    if (friendConvMap[friend.id]) {
      const convId = friendConvMap[friend.id];
      setSelected(prev => { const s = new Set(prev); s.has(convId) ? s.delete(convId) : s.add(convId); return s; });
      return;
    }
    const { data } = await axios.post('/api/messages/conversation/private', { userId: friend.id });
    const convId = data.conversationId;
    setFriendConvMap(prev => ({ ...prev, [friend.id]: convId }));
    setSelected(prev => { const s = new Set(prev); s.add(convId); return s; });
  };

  const selectAllFriends = async () => {
    const allSelected = filteredFriends.every(f => isFriendSelected(f));
    if (allSelected) {
      const toRemove = filteredFriends.map(f => friendConvMap[f.id]).filter(Boolean);
      setSelected(prev => { const s = new Set(prev); toRemove.forEach(id => s.delete(id)); return s; });
    } else {
      const promises = filteredFriends.filter(f => !friendConvMap[f.id]).map(f =>
        axios.post('/api/messages/conversation/private', { userId: f.id }).then(r => ({ uid: f.id, convId: r.data.conversationId }))
      );
      const results = await Promise.all(promises);
      const newMap = { ...friendConvMap };
      results.forEach(({ uid, convId }) => { newMap[uid] = convId; });
      setFriendConvMap(newMap);
      setSelected(prev => {
        const s = new Set(prev);
        filteredFriends.forEach(f => { const id = newMap[f.id]; if (id) s.add(id); });
        return s;
      });
    }
  };

  const toggleGroup = (group) => {
    setSelected(prev => { const s = new Set(prev); s.has(group.id) ? s.delete(group.id) : s.add(group.id); return s; });
  };

  const selectAllGroups = () => {
    const allSelected = filteredGroups.every(g => selected.has(g.id));
    setSelected(prev => {
      const s = new Set(prev);
      if (allSelected) { filteredGroups.forEach(g => s.delete(g.id)); }
      else { filteredGroups.forEach(g => s.add(g.id)); }
      return s;
    });
  };

  const forward = async () => {
    if (selected.size === 0) return;
    setSending(true);
    try {
      const { data } = await axios.post('/api/messages/forward', {
        msgId: message.id,
        conversationIds: [...selected]
      });
      setSentCount(data.sent);
      setDone(true);
      setTimeout(onClose, 3000);
    } catch (e) {
      showToast(e.response?.data?.error || '转发失败', 'error');
    }
    setSending(false);
  };

  const msgPreview = () => {
    if (!message) return '';
    if (message.type === 'image') return '[图片]';
    if (message.type === 'file') return `[文件] ${message.content}`;
    if (message.type === 'voice') return '[语音]';
    if (message.type === 'video') return '[视频]';
    if (message.type === 'red_packet') return '[红包]';
    return message.content?.slice(0, 50) + (message.content?.length > 50 ? '...' : '');
  };

  const allFriendsSelected = filteredFriends.length > 0 && filteredFriends.every(f => isFriendSelected(f));
  const allGroupsSelected = filteredGroups.length > 0 && filteredGroups.every(g => selected.has(g.id));

  return (
    <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="wc-modal fwd-modal">

        {/* 标题栏 */}
        <div className="fwd-header">
          <span className="wc-modal-title">转发消息</span>
          <button className="wc-modal-close" onClick={onClose}>✕</button>
        </div>

        {done ? (
          <div className="fwd-done-wrap">
            <div className="fwd-done-icon">
              <svg viewBox="0 0 24 24" style={{ width: 28, height: 28, fill: 'none', stroke: 'var(--text-inverse)', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="fwd-done-title">转发成功</div>
            <div className="fwd-done-sub">已发送给 <span>{sentCount}</span> 个会话</div>
            <button className="wc-modal-btn primary" style={{ width: '100%' }} onClick={onClose}>完成</button>
          </div>
        ) : (
          <>
            {/* 消息预览 */}
            <div className="fwd-preview">
              <span className="fwd-preview-label">转发内容：</span>
              <span className="fwd-preview-text">{msgPreview()}</span>
            </div>

            {/* 搜索栏 */}
            <div className="fwd-search-wrap">
              <div className="wc-search" style={{ height: 30 }}>
                <span className="wc-search-icon">
                  <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: 'var(--text-tertiary)' }}>
                    <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                  </svg>
                </span>
                <input placeholder="搜索" value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 13 }} />
              </div>
            </div>

            {/* Tab 切换 */}
            <div className="fwd-tabs-wrap">
              <div className="fwd-tabs">
                {[['friends','好友'], ['groups','群聊']].map(([key, label]) => (
                  <button key={key} className={`fwd-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                    {label} ({key === 'friends' ? filteredFriends.length : filteredGroups.length})
                  </button>
                ))}
              </div>
            </div>

            {/* 列表 */}
            <div className="fwd-list">
              {/* 全选行 */}
              {tab === 'friends' && filteredFriends.length > 0 && (
                <div className="fwd-select-all" onClick={selectAllFriends}>
                  <div className={`wc-group-check${allFriendsSelected ? ' checked' : ''}`}>{allFriendsSelected ? '✓' : ''}</div>
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>全选好友（{filteredFriends.length}人）</span>
                </div>
              )}
              {tab === 'groups' && filteredGroups.length > 0 && (
                <div className="fwd-select-all" onClick={selectAllGroups}>
                  <div className={`wc-group-check${allGroupsSelected ? ' checked' : ''}`}>{allGroupsSelected ? '✓' : ''}</div>
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>全选群聊（{filteredGroups.length}个）</span>
                </div>
              )}

              {/* 好友列表 */}
              {tab === 'friends' && filteredFriends.map(f => (
                <div key={f.id} className="fwd-item" onClick={() => toggleFriend(f)}>
                  <div className={`wc-group-check${isFriendSelected(f) ? ' checked' : ''}`}>{isFriendSelected(f) ? '✓' : ''}</div>
                  <Avatar src={f.avatar} name={f.remark || f.username} size={36} />
                  <span className="fwd-item-name">{f.remark || f.username}</span>
                </div>
              ))}
              {tab === 'friends' && filteredFriends.length === 0 && (
                <div className="fwd-empty">暂无好友</div>
              )}

              {/* 群聊列表 */}
              {tab === 'groups' && filteredGroups.map(g => (
                <div key={g.id} className="fwd-item" onClick={() => toggleGroup(g)}>
                  <div className={`wc-group-check${selected.has(g.id) ? ' checked' : ''}`}>{selected.has(g.id) ? '✓' : ''}</div>
                  <GroupAvatar members={g.members || []} avatar={g.avatar || g.groupAvatar} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="fwd-item-name">{g.name}</div>
                    <div className="fwd-item-sub">{g.memberCount}人</div>
                  </div>
                </div>
              ))}
              {tab === 'groups' && filteredGroups.length === 0 && (
                <div className="fwd-empty">暂无群聊</div>
              )}
            </div>

            {/* 底部确认栏 */}
            <div className="fwd-footer">
              <span className="fwd-footer-count">已选 {selected.size} 个</span>
              <div className="fwd-footer-btns">
                <button className="wc-modal-btn secondary" style={{ padding: '7px 20px', flex: 'none' }} onClick={onClose}>取消</button>
                <button
                  className="wc-modal-btn primary"
                  style={{ padding: '7px 24px', flex: 'none', opacity: selected.size === 0 ? 0.5 : 1 }}
                  onClick={forward}
                  disabled={selected.size === 0 || sending}
                >
                  {sending ? '发送中...' : `发送${selected.size > 0 ? `（${selected.size}）` : ''}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
