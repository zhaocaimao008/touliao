import TouliaoIcon from '../ui-kit/Icon';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import Avatar from './Avatar';
import UserProfile from './UserProfile';
import useFocusTrap from '../hooks/useFocusTrap';
import { useI18n } from '../contexts/I18nContext';
import './AddFriendModal.css';
import { IcoBack, IcoClose } from './Icons';

const GREEN = 'var(--green)';

function AfResultItem({ user: u, onClick }) {
  const { t } = useI18n();
  return (
    <div className="afm-result-item" role="button" tabIndex={0} onClick={onClick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      <Avatar src={u.avatar} name={u.username} size='lg'
        style={{ borderRadius: 'var(--radius-avatar-lg)', flexShrink: 0 }} />
      <div className="afm-result-info">
        <div className="afm-result-name">{u.username}</div>
        {(u.wechat_id || u.phone) && (
          <div className="afm-result-sub">
            {u.wechat_id
              ? t('profile.touliaoIdColonTemplate').replace('{id}', u.wechat_id)
              : t('addFriend.phoneColonTemplate').replace('{phone}', `${u.phone.slice(0, 3)}****${u.phone.slice(-4)}`)}
          </div>
        )}
      </div>
      <IcoBack className="afm-result-chevron" size="xs" />
    </div>
  );
}

export default function AddFriendModal({ onClose, initialQuery = '', onStartChat }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState(false); // 网络失败 ≠ 查无此人，分别提示
  const [focused, setFocused] = useState(false);
  const [viewId, setViewId] = useState(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const searchAcRef = useRef(null);
  const trapRef = useFocusTrap(!viewId);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);

  // 卸载时清理防抖定时器与进行中的搜索请求，避免关闭后仍触发（对已卸载组件 setState）
  useEffect(() => () => { clearTimeout(timerRef.current); searchAcRef.current?.abort(); }, []);

  const doSearch = useCallback((q) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    // 取消上一次未完成的搜索,防止慢响应覆盖新结果(旧数据竞态)
    searchAcRef.current?.abort();
    const ac = new AbortController();
    searchAcRef.current = ac;
    setSearching(true);
    axios.get(`/api/users/search?q=${encodeURIComponent(q.trim())}`, { signal: ac.signal })
      .then(({ data }) => { setResults(data); setSearched(true); setSearchError(false); })
      .catch(err => {
        if (axios.isCancel?.(err) || err.code === 'ERR_CANCELED') return;
        setResults([]); setSearched(true); setSearchError(true);
      })
      .finally(() => { if (!ac.signal.aborted) setSearching(false); });
  }, []);

  // initialQuery 变化即发起搜索——这是正当的「随 prop 同步到外部系统（网络请求）」副作用，
  // doSearch 内部的 setSearching 属于异步取数流程的一部分，非可派生的同步状态，故此处保留 effect。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：正当的取数副作用
    if (initialQuery.trim()) doSearch(initialQuery);
  }, [initialQuery, doSearch]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    if (!v.trim()) { setResults([]); setSearched(false); setSearchError(false); }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 350);
  };

  const clearSearch = () => {
    setQuery(''); setResults([]); setSearched(false); setSearchError(false);
    inputRef.current?.focus();
  };

  // ── 全局遮罩 + Portal 逃逸 ──

  const isIdle = !query;
  const isSearchingState = query && (searching || (!searched && results.length === 0));

  return createPortal(
    <>
      {!viewId && (
      <div className="afm-overlay" ref={trapRef} onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="afm-card" role="dialog" aria-modal="true" aria-label={t('contacts.addFriend')} onClick={e => e.stopPropagation()}>

          {/* 标题栏 */}
          <div className="afm-header">
            <span className="afm-header-title">{t('contacts.addFriend')}</span>
            <button onClick={onClose} aria-label={t('common.close')}
              className="afm-close-btn">
              <IcoClose size="sm" />
            </button>
          </div>

          {/* 搜索框 */}
          <div className="afm-search-pad">
            <div className={`afm-search-wrap${focused ? ' afm-search-wrap-focused' : ''}`}>
              <TouliaoIcon name="search" className="afm-search-icon" style={{color:focused?GREEN:'var(--text-tertiary)'}} size="sm" />
              <input
                ref={inputRef}
                placeholder={t('addFriend.searchPlaceholder')}
                aria-label={t('addFriend.searchAriaLabel')}
                value={query}
                onChange={onChange}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={e => { if (e.nativeEvent?.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') doSearch(query); }}
                className="afm-search-input"
              />
              {query && (
                <button onClick={clearSearch} aria-label={t('common.clear')}
                  className="afm-clear-btn">
                  <TouliaoIcon name="clear" size="xs" />
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
                  {t('addFriend.idleTitle')}
                </div>
                <div className="afm-idle-desc">
                  {t('addFriend.idleDescPart1')}<br />{t('addFriend.idleDescPart2')}
                </div>
                <div className="afm-idle-tags">
                  {[t('addFriend.tagAccountId'), t('addFriend.tagPhone'), t('addFriend.tagNickname')].map(tag => (
                    <span key={tag} className="afm-idle-tag">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {/* 动态搜索响应条 */}
            {isSearchingState && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => doSearch(query)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doSearch(query); } }}
                className="afm-search-row"
              >
                <TouliaoIcon name="search" className="afm-search-icon" style={{color:GREEN}} size="sm" />
                <span className="afm-search-text">
                  {t('addFriend.searchColon')}<span className="afm-search-hl">{query}</span>
                </span>
                {searching
                  ? <span className="afm-search-hint">{t('convSearch.searching')}</span>
                  : <span className="afm-search-hint">{t('addFriend.pressEnter')}</span>}
              </div>
            )}

            {/* 搜索结果 */}
            {!searching && results.map(u => (
              <AfResultItem key={u.id} user={u} onClick={() => setViewId(u.id)} />
            ))}

            {/* 搜索失败（网络等）：与"查无此人"区分，给重试入口 */}
            {!searching && searchError && query && (
              <div className="afm-not-found">
                <div className="afm-not-found-title">{t('addFriend.searchFailedTitle')}</div>
                <div className="afm-not-found-sub">
                  <button onClick={() => doSearch(query)}
                    style={{ color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>
                    {t('addFriend.retry')}
                  </button>
                </div>
              </div>
            )}

            {/* 未找到 */}
            {!searching && searched && !searchError && query && results.length === 0 && (
              <div className="afm-not-found">
                <div className="afm-not-found-title">{t('addFriend.notFoundTemplate').replace('{query}', query)}</div>
                <div className="afm-not-found-sub">{t('addFriend.notFoundHint')}</div>
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
          onStartChat={(conv) => { setViewId(null); onClose(); onStartChat?.(conv); }}
          onFriendAdded={() => {}}
        />
      )}
    </>,
    document.body
  );
}
