import React from 'react';

export default function SearchResults({ results, query, searching, onSelect, onClose }) {
  if (!query) return null;

  return (
    <div style={{
      position: 'absolute',
      top: '100%', left: 0, right: 0,
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderTop: 'none',
      borderRadius: '0 0 8px 8px',
      boxShadow: '0 8px 24px rgba(0,0,0,.12)',
      zIndex: 200,
      maxHeight: 360,
      overflowY: 'auto',
    }}>
      {searching && (
        <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
          搜索中…
        </div>
      )}
      {!searching && results.length === 0 && (
        <div role="status" style={{ textAlign: 'center', padding: '16px 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
          未找到相关消息
        </div>
      )}
      {results.map((msg) => {
        const q = query.toLowerCase();
        const idx = msg.content?.toLowerCase().indexOf(q);
        return (
          <div
            key={msg.id}
            style={{
              display: 'flex', gap: 10, padding: '10px 14px',
              cursor: 'pointer', borderBottom: '1px solid rgba(0,0,0,.04)',
              alignItems: 'flex-start',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,.04)'}
            onMouseLeave={e => e.currentTarget.style.background = ''}
            onClick={() => {
              onSelect?.(msg);
              onClose?.();
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 4, flexShrink: 0,
              background: 'var(--green)',
              color: 'var(--text-inverse)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 13, fontWeight: 600,
            }}>
              {(msg.senderName || '?')[0]}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--link-color)' }}>
                  {msg.senderName}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {msg.created_at ? new Date(msg.created_at * 1000).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : ''}
                </span>
              </div>
              <div style={{
                fontSize: 13, color: 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {msg.type === 'image' ? (
                  <span>[图片]</span>
                ) : msg.type === 'voice' ? (
                  <span>[语音]</span>
                ) : idx >= 0 ? (
                  <>
                    {msg.content.slice(0, idx)}
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                      {msg.content.slice(idx, idx + query.length)}
                    </span>
                    {msg.content.slice(idx + query.length)}
                  </>
                ) : msg.content}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
