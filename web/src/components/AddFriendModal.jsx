import TouliaoIcon from '../ui-kit/Icon';
import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFriendSearch } from '../hooks/useFriendSearch';
import Avatar from './Avatar';
import UserProfile from './UserProfile';
import useFocusTrap from '../hooks/useFocusTrap';
import { useI18n } from '../contexts/I18nContext';
import './AddFriendModal.css';
import { IcoBack, IcoClose } from './Icons';

const GREEN = 'var(--green)';

function AfResultItem({ user: u, onClick, resultRef }) {
  const { t } = useI18n();
  return (
    <div ref={resultRef} className="afm-result-item" role="button" tabIndex={0} onClick={onClick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      <Avatar src={u.avatar} name={u.username} size='lg'
        style={{ borderRadius: 'var(--radius-avatar-lg)', flexShrink: 0 }} />
      <div className="afm-result-info">
        <div className="afm-result-name">{u.username}</div>
        {(u.wechat_id || u.phone) && (
          <div className="afm-result-sub">
            {u.wechat_id
              ? t('profile.touliaoIdColonTemplate').replace('{id}', u.wechat_id)
              : t('addFriend.phoneColonTemplate').replace('{phone}', `${String(u.phone).slice(0, 3)}****${String(u.phone).slice(-4)}`)}
          </div>
        )}
      </div>
      <IcoBack className="afm-result-chevron" size="xs" />
    </div>
  );
}

export default function AddFriendModal({ onClose, initialQuery = '', onStartChat }) {
  const { t } = useI18n();
  const { query, results, status, search } = useFriendSearch(initialQuery);
  const [focused, setFocused] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const inputRef = useRef(null);
  const selectedRef = useRef(null);
  const composing = useRef(false);
  const trapRef = useFocusTrap(!viewId, { onEscape: onClose, lockScroll: true,
    initialFocus: selectedId ? selectedRef : inputRef });
  const doSearch = () => { if (!composing.current) search(query, { immediate: true }); };
  const onChange = e => {
    setSelectedId(null);
    search(e.target.value, { composing: composing.current || e.nativeEvent?.isComposing });
  };
  const clearSearch = () => {
    composing.current = false;
    setSelectedId(null);
    search('');
    inputRef.current?.focus();
  };
  const isIdle = status === 'idle';
  const searching = status === 'loading';
  const searched = status === 'success';
  const searchError = status === 'error';
  const isSearchingState = searching || status === 'composing';

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
                onCompositionStart={() => { composing.current = true; search(query, { composing: true }); }}
                onCompositionEnd={e => { composing.current = false; search(e.currentTarget.value); }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={e => { if (e.nativeEvent?.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); doSearch(); } }}
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
                role="status"
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
              <AfResultItem key={u.id} user={u} resultRef={u.id === selectedId ? selectedRef : undefined} onClick={() => { setSelectedId(u.id); setViewId(u.id); }} />
            ))}

            {/* 搜索失败（网络等）：与"查无此人"区分，给重试入口 */}
            {!searching && searchError && query && (
              <div className="afm-not-found" role="alert">
                <div className="afm-not-found-title">{t('addFriend.searchFailedTitle')}</div>
                <div className="afm-not-found-sub">
                  <button onClick={() => doSearch()}
                    className="afm-retry-btn">
                    {t('addFriend.retry')}
                  </button>
                </div>
              </div>
            )}

            {/* 未找到 */}
            {!searching && searched && !searchError && query && results.length === 0 && (
              <div className="afm-not-found" role="status">
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
