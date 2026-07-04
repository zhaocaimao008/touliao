import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import Avatar from './Avatar';
import UserProfile from './UserProfile';
import './AddFriendModal.css';

const GREEN = 'var(--green)';

function AfResultItem({ user: u, onClick }) {
  return (
    <div className="afm-result-item" role="button" tabIndex={0} onClick={onClick} onKeyDown={e => e.key === 'Enter' && onClick()}>
      <Avatar src={u.avatar} name={u.username} size={46}
        style={{ borderRadius: 'var(--radius-avatar-lg)', flexShrink: 0 }} />
      <div className="afm-result-info">
        <div className="afm-result-name">{u.username}</div>
        {(u.wechat_id || u.phone) && (
          <div className="afm-result-sub">
            {u.wechat_id ? `v信号：${u.wechat_id}` : `手机：${u.phone.slice(0, 3)}****${u.phone.slice(-4)}`}
          </div>
        )}
      </div>
      <svg className="afm-result-chevron" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
      </svg>
    </div>
  );
}

export default function AddFriendModal({ onClose, initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [viewId, setViewId] = useState(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);

  // 卸载时清理防抖定时器，避免关闭后仍触发一次搜索（对已卸载组件 setState）
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const doSearch = useCallback((q) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setSearching(true);
    axios.get(`/api/users/search?q=${encodeURIComponent(q.trim())}`)
      .then(({ data }) => { setResults(data); setSearched(true); })
      .catch(() => { setResults([]); setSearched(true); })
      .finally(() => setSearching(false));
  }, []);

  useEffect(() => { if (initialQuery.trim()) doSearch(initialQuery); }, [initialQuery, doSearch]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    if (!v.trim()) { setResults([]); setSearched(false); }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 350);
  };

  const clearSearch = () => {
    setQuery(''); setResults([]); setSearched(false);
    inputRef.current?.focus();
  };

  // ── 全局遮罩 + Portal 逃逸 ──

  const isIdle = !query;
  const isSearchingState = query && (searching || (!searched && results.length === 0));

  return createPortal(
    <>
      {!viewId && (
      <div className="afm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="afm-card" role="dialog" aria-modal="true" aria-label="添加好友" onClick={e => e.stopPropagation()}>

          {/* 标题栏 */}
          <div className="afm-header">
            <span className="afm-header-title">添加好友</span>
            <button onClick={onClose} aria-label="关闭"
              className="afm-close-btn">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>

          {/* 搜索框 */}
          <div className="afm-search-pad">
            <div className={`afm-search-wrap${focused ? ' afm-search-wrap-focused' : ''}`}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none"
                stroke={focused ? GREEN : 'var(--text-tertiary)'} strokeWidth="2" strokeLinecap="round"
                className="afm-search-icon">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                placeholder="搜索 v信号、手机号或昵称"
                aria-label="搜索好友"
                value={query}
                onChange={onChange}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={e => e.key === 'Enter' && doSearch(query)}
                className="afm-search-input"
              />
              {query && (
                <button onClick={clearSearch} aria-label="清空"
                  className="afm-clear-btn">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* 内容区 */}
          <div className="afm-content">

            {/* 空闲态 */}
            {isIdle && (
              <div className="afm-idle">
                <div className="afm-idle-title">
                  输入账号查找朋友
                </div>
                <div className="afm-idle-desc">
                  支持通过 v信号、手机号或昵称<br />精准定位你想添加的联系人
                </div>
                <div className="afm-idle-tags">
                  {['v信号', '手机号', '昵称'].map(t => (
                    <span key={t} className="afm-idle-tag">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* 动态搜索响应条 */}
            {isSearchingState && (
              <div
                onClick={() => doSearch(query)}
                className="afm-search-row"
              >
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" className="afm-search-icon">
                  <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span className="afm-search-text">
                  搜索：<span className="afm-search-hl">{query}</span>
                </span>
                {searching
                  ? <span className="afm-search-hint">搜索中…</span>
                  : <span className="afm-search-hint">回车 ↵</span>}
              </div>
            )}

            {/* 搜索结果 */}
            {!searching && results.map(u => (
              <AfResultItem key={u.id} user={u} onClick={() => setViewId(u.id)} />
            ))}

            {/* 未找到 */}
            {!searching && searched && query && results.length === 0 && (
              <div className="afm-not-found">
                <div className="afm-not-found-title">未找到「{query}」相关用户</div>
                <div className="afm-not-found-sub">换个 v信号或手机号试试</div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {viewId && (
        <UserProfile
          userId={viewId}
          onClose={() => setViewId(null)}
          onStartChat={() => { setViewId(null); onClose(); }}
          onFriendAdded={() => {}}
        />
      )}
    </>,
    document.body
  );
}
