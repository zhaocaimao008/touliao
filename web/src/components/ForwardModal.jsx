import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { GroupAvatar } from './GroupInfo';
import { showToast } from '../utils/toast';
import useFocusTrap from '../hooks/useFocusTrap';
import './ForwardModal.css';

export default function ForwardModal({ message, onClose }) {
  const trapRef = useFocusTrap();
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
    // 兜底成数组：接口异常/返回非数组时避免 filteredFriends/.filter 抛错导致弹窗白屏
    axios.get('/api/users/contacts')
      .then(r => setFriends(Array.isArray(r.data) ? r.data : []))
      .catch(() => setFriends([]));
    axios.get('/api/messages/my-groups')
      .then(r => setGroups(Array.isArray(r.data) ? r.data : []))
      .catch(() => setGroups([]));
  }, []);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // 搜索词只归一化一次;名称兜底空串,避免 remark/username/name 为空时 toLowerCase 抛错致白屏
  const q = search.trim().toLowerCase();
  const filteredFriends = useMemo(() =>
    friends.filter(f => String(f.remark || f.username || '').toLowerCase().includes(q)),
    [friends, q]
  );
  const filteredGroups = useMemo(() =>
    groups.filter(g => String(g.name || '').toLowerCase().includes(q)),
    [groups, q]
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
    try {
      const { data } = await axios.post('/api/messages/conversation/private', { userId: friend.id });
      const convId = data.conversationId;
      setFriendConvMap(prev => ({ ...prev, [friend.id]: convId }));
      setSelected(prev => { const s = new Set(prev); s.add(convId); return s; });
    } catch (e) {
      showToast(e.response?.data?.error || '无法选择该好友，请重试', 'error');
    }
  };

  const selectAllFriends = async () => {
    const allSelected = filteredFriends.every(f => isFriendSelected(f));
    if (allSelected) {
      const toRemove = filteredFriends.map(f => friendConvMap[f.id]).filter(Boolean);
      setSelected(prev => { const s = new Set(prev); toRemove.forEach(id => s.delete(id)); return s; });
    } else {
      // 批量创建私聊会话（单次请求），避免 N 个 POST 并发
      const uncached = filteredFriends.filter(f => !friendConvMap[f.id]);
      const cached = filteredFriends.filter(f => friendConvMap[f.id]);
      let newMap = { ...friendConvMap };
      if (uncached.length > 0) {
        try {
          const { data } = await axios.post('/api/messages/conversation/private/batch', {
            userIds: uncached.map(f => f.id)
          });
          if (data.conversations) {
            data.conversations.forEach(({ userId, conversationId }) => {
              newMap[userId] = conversationId;
            });
          }
        } catch (e) {
          showToast(e.response?.data?.error || '批量选择好友失败', 'error');
          return;
        }
      }
      setFriendConvMap(newMap);
      setSelected(prev => {
        const s = new Set(prev);
        cached.forEach(f => { const id = newMap[f.id]; if (id) s.add(id); });
        uncached.forEach(f => { const id = newMap[f.id]; if (id) s.add(id); });
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
    return message.content?.slice(0, 50) + (message.content?.length > 50 ? '…' : '');
  };

  const allFriendsSelected = filteredFriends.length > 0 && filteredFriends.every(f => isFriendSelected(f));
  const allGroupsSelected = filteredGroups.length > 0 && filteredGroups.every(g => selected.has(g.id));

  return (
    <div className="wc-modal-overlay" ref={trapRef} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="fwd-panel" role="dialog" aria-modal="true" aria-label="转发消息">

        {/* 标题栏 */}
        <div className="fwd-hd">
          <span className="fwd-hd-title">转发消息</span>
          <button className="fwd-hd-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {done ? (
          <div className="fwd-done">
            <div className="fwd-done-ring">
              <svg viewBox="0 0 24 24" style={{ width: 28, height: 28, fill: 'none', stroke: 'var(--text-inverse)', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="fwd-done-title">转发成功</div>
            <div className="fwd-done-sub">已发送给 <strong>{sentCount}</strong> 个会话</div>
            <button className="fwd-done-close" onClick={onClose}>完成</button>
          </div>
        ) : (
          <>
            {/* 消息预览 */}
            <div className="fwd-preview">
              <div className="fwd-preview-bar" />
              <div className="fwd-preview-body">
                <div className="fwd-preview-label">转发内容：</div>
                <div className="fwd-preview-text">{msgPreview()}</div>
              </div>
            </div>

            {/* 搜索栏 */}
            <div className="fwd-search-wrap">
              <div className="fwd-search">
                <span className="fwd-search-ico">
                  <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: 'var(--text-tertiary)' }}>
                    <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                  </svg>
                </span>
                <input className="fwd-search-inp" placeholder="搜索" value={search} autoFocus onChange={e => setSearch(e.target.value)}
                  aria-label="搜索联系人" />
                {search && (
                  <button type="button" className="fwd-search-clr" aria-label="清除搜索" title="清除"
                    onClick={() => setSearch('')}>✕</button>
                )}
              </div>
            </div>

            {/* Tab 切换 */}
            <div className="fwd-tabs" role="tablist">
              {[['friends','好友'], ['groups','群聊']].map(([key, label]) => (
                <button key={key} role="tab" aria-selected={tab === key} className={`fwd-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                  {label}
                  <span className="fwd-tab-cnt">{key === 'friends' ? filteredFriends.length : filteredGroups.length}</span>
                </button>
              ))}
            </div>

            {/* 列表 */}
            <div className="fwd-list" role="tabpanel">
              {/* 全选行 */}
              {tab === 'friends' && filteredFriends.length > 0 && (
                <div className="fwd-sel-all" role="button" tabIndex={0} onClick={selectAllFriends} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAllFriends(); } }}>
                  <div className={`fwd-check${allFriendsSelected ? ' checked' : ''}`}>
                    <span className="fwd-check-icon">
                      <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', color: 'var(--text-inverse)' }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  </div>
                  <span className="fwd-sel-all-txt">全选好友（<em>{filteredFriends.length}</em>人）</span>
                </div>
              )}
              {tab === 'groups' && filteredGroups.length > 0 && (
                <div className="fwd-sel-all" role="button" tabIndex={0} onClick={selectAllGroups} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAllGroups(); } }}>
                  <div className={`fwd-check${allGroupsSelected ? ' checked' : ''}`}>
                    <span className="fwd-check-icon">
                      <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', color: 'var(--text-inverse)' }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  </div>
                  <span className="fwd-sel-all-txt">全选群聊（<em>{filteredGroups.length}</em>个）</span>
                </div>
              )}

              {/* 好友列表 */}
              {tab === 'friends' && filteredFriends.map(f => (
                <div key={f.id} className="fwd-item" role="button" tabIndex={0} onClick={() => toggleFriend(f)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFriend(f); } }}>
                  <div className={`fwd-check${isFriendSelected(f) ? ' checked' : ''}`}>
                    <span className="fwd-check-icon">
                      <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', color: 'var(--text-inverse)' }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  </div>
                  <Avatar src={f.avatar} name={f.remark || f.username} size={36} />
                  <div className="fwd-item-info">
                    <div className="fwd-item-name">{f.remark || f.username}</div>
                  </div>
                </div>
              ))}
              {tab === 'friends' && filteredFriends.length === 0 && (
                <div role="status" className="fwd-empty">暂无好友</div>
              )}

              {/* 群聊列表 */}
              {tab === 'groups' && filteredGroups.map(g => (
                <div key={g.id} className="fwd-item" role="button" tabIndex={0} onClick={() => toggleGroup(g)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(g); } }}>
                  <div className={`fwd-check${selected.has(g.id) ? ' checked' : ''}`}>
                    <span className="fwd-check-icon">
                      <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', color: 'var(--text-inverse)' }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  </div>
                  <GroupAvatar members={g.members || []} avatar={g.avatar || g.groupAvatar} size={36} />
                  <div className="fwd-item-info">
                    <div className="fwd-item-name">{g.name}</div>
                    <div className="fwd-item-sub">{g.memberCount}人</div>
                  </div>
                </div>
              ))}
              {tab === 'groups' && filteredGroups.length === 0 && (
                <div role="status" className="fwd-empty">暂无群聊</div>
              )}
            </div>

            {/* 底部确认栏 */}
            <div className="fwd-footer">
              <span className="fwd-footer-count">已选 <strong>{selected.size}</strong> 个</span>
              <div className="fwd-footer-btns">
                <button className="fwd-btn fwd-btn-cancel" onClick={onClose}>取消</button>
                <button
                  className="fwd-btn fwd-btn-send"
                  onClick={forward}
                  disabled={selected.size === 0 || sending}
                >
                  {sending ? '发送中…' : `发送${selected.size > 0 ? `（${selected.size}）` : ''}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
