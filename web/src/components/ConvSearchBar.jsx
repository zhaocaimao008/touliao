import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { format } from '../utils/time';

/**
 * 会话内消息搜索栏
 * Props:
 *   convId      — 当前会话 ID
 *   onJump      — (msgId) => void  点击结果后跳转到该消息
 *   onClose     — 关闭搜索栏
 */
export default function ConvSearchBar({ convId, onJump, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  // 自动聚焦
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Escape 关闭
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const doSearch = useCallback((q) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); setSearched(false); return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await axios.get(
          `/api/messages/conversation/${convId}/search`,
          { params: { q: trimmed } }
        );
        setResults(Array.isArray(data) ? data : []);
        setSearched(true);
      } catch {
        setResults([]);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    }, 280);
  }, [convId]);

  const handleChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    doSearch(v);
  };

  const handleJump = (msg) => {
    onJump(msg.id);
    // 不关闭搜索栏，方便用户跳转多条结果
  };

  const previewOf = (msg) => {
    switch (msg.type) {
      case 'image': return '[图片]';
      case 'voice': return '[语音]';
      case 'video': return '[视频]';
      case 'file':  return '[文件] ' + (msg.content || '').slice(0, 40);
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
        <mark style={{ background: 'rgba(109,90,230,.2)', color: 'var(--green)', borderRadius: 2, padding: '0 1px' }}>
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div style={{
      borderBottom: '1px solid var(--border-default)',
      background: 'var(--bg-card)',
    }}>
      {/* 搜索输入行 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
      }}>
        <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: 'var(--text-tertiary)', flexShrink: 0 }}>
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          placeholder="搜索聊天记录…"
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontSize: 14, color: 'var(--text-primary)',
          }}
        />
        {loading && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>搜索中…</span>
        )}
        <button
          onClick={onClose}
          aria-label="关闭搜索"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 4, color: 'var(--text-tertiary)', lineHeight: 0,
            borderRadius: 4,
          }}
        >
          <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: 'currentColor' }}>
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>

      {/* 结果列表 */}
      {query.trim() && (
        <div style={{
          maxHeight: 280, overflowY: 'auto',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          {searched && results.length === 0 && !loading && (
            <div style={{
              padding: '16px 16px',
              fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center',
            }}>
              未找到相关消息
            </div>
          )}
          {results.map(msg => (
            <div
              key={msg.id}
              role="button"
              tabIndex={0}
              onClick={() => handleJump(msg)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleJump(msg)}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                padding: '9px 16px', cursor: 'pointer',
                borderBottom: '1px solid var(--border-subtle)',
                transition: 'background .1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = ''; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {msg.senderName || '未知'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {format((msg.created_at || 0) * 1000)}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {highlight(previewOf(msg), query.trim())}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
