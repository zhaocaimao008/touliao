import TouliaoField from '../ui-kit/Field';
import React, { useState, useEffect, useRef, useId } from 'react';
import axios from 'axios';
import { format } from '../utils/time';
import { useI18n } from '../contexts/I18nContext';
import { IcoClose, IcoSearch } from './Icons';
import { startSearchTask } from '../utils/searchTask';
import './ConvSearchBar.css';

/**
 * 会话内消息搜索栏
 * Props:
 *   convId      — 当前会话 ID
 *   onJump      — (msgId) => void  点击结果后跳转到该消息
 *   onClose     — 关闭搜索栏
 */
export default function ConvSearchBar({ convId, onJump, onClose }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ status: 'idle', data: [] });
  const [retry, setRetry] = useState(0);
  const inputRef = useRef(null);
  const statusId = useId();
  const key = JSON.stringify([convId, query.trim()]);
  const status = search.key === key ? search.status : query.trim() ? 'loading' : 'idle';
  const results = search.key === key ? search.data : [];

  // 自动聚焦
  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  // Escape 关闭
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => startSearchTask({
    key, query,
    load: async (q, signal) => {
      const { data } = await axios.get(`/api/messages/conversation/${convId}/search`, { params: { q }, signal });
      return data;
    },
    onState: setSearch,
  }), [convId, key, query, retry]);

  const handleJump = (msg) => {
    onJump(msg.id);
  };

  const previewOf = (msg) => {
    switch (msg.type) {
      case 'image': return t('chatlist.previewImage');
      case 'voice': return t('chatlist.previewVoice');
      case 'video': return t('chatlist.previewVideo');
      case 'file':  return t('chatlist.previewFile') + ' ' + (msg.content || '').slice(0, 40);
      default:      return (msg.content || '').slice(0, 80);
    }
  };

  // 高亮命中片段
  const highlight = (text, q) => {
    if (!q || !text) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="conv-search-highlight">
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  return (
    <section className="conv-search" aria-label={t('convSearch.searchPlaceholder')}>
      {/* 搜索输入行 */}
      <div className="conv-search-row">
        <TouliaoField variant="SEARCH" className="tl-field-inline"
          icon={<IcoSearch size="xs" />} ref={inputRef} value={query}
          onChange={event => setQuery(event.target.value)} aria-label={t('convSearch.searchPlaceholder')}
          aria-describedby={statusId}
          onClear={() => { setQuery(''); inputRef.current?.focus(); }}
          placeholder={t('convSearch.searchPlaceholder')} />
        <button
          type="button" className="conv-search-close"
          onClick={onClose}
          aria-label={t('convSearch.closeSearch')}
        >
          <IcoClose size="sm" />
        </button>
      </div>

      <div className="conv-search-status" id={statusId} role="status" aria-live="polite">
        {status === 'idle' && t('convSearch.hint')}
        {status === 'loading' && t('convSearch.searching')}
        {status === 'error' && t('convSearch.failed')}
        {status === 'success' && (results.length ? t('convSearch.resultCount').replace('{count}', results.length) : t('convSearch.noResults'))}
      </div>
      {status === 'error' && <button type="button" className="conv-search-retry" onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button>}
      {status === 'success' && results.length > 0 && (
        <div className="conv-search-results">
          {results.map(msg => (
            <button type="button" className="conv-search-result"
              key={msg.id}
              onClick={() => handleJump(msg)}
            >
              <span className="conv-search-meta">
                <span className="conv-search-sender">
                  {msg.senderName || t('chatlist.unknown')}
                </span>
                <span className="conv-search-time">
                  {format((msg.created_at || 0) * 1000)}
                </span>
              </span>
              <span className="conv-search-preview">
                {highlight(previewOf(msg), query.trim())}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
