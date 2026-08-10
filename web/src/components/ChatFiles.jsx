import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { mediaUrl } from '../utils/url';
import { downloadFile } from '../utils/download';
import { format } from '../utils/time';
import Avatar from './Avatar';
import ImagePreview from './ImagePreview';
import VideoPreview from './VideoPreview';

/**
 * 聊天文件聚合视图（抽屉面板）
 * Props:  convId — 会话 ID  |  onClose — 关闭回调
 */

const TABS = [
  { key: 'all',   label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'file',  label: '文件' },
];

const IcoFile = () => (
  <svg viewBox="0 0 24 24" style={{ width: 28, height: 28, fill: 'rgba(109,90,230,.50)' }}>
    <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
  </svg>
);
const IcoVideo = () => (
  <svg viewBox="0 0 24 24" style={{ width: 28, height: 28, fill: 'rgba(109,90,230,.50)' }}>
    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
  </svg>
);

export default function ChatFiles({ convId, onClose }) {
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [preview, setPreview] = useState(null);
  const loaderRef = useRef(null);
  const LIMIT = 30;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setTotal(0);
  }, [tab, convId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const load = useCallback(async (currentOffset) => {
    if (loading) return;
    setLoading(true);
    try {
      const { data } = await axios.get(
        `/api/messages/conversation/${convId}/files`,
        { params: { type: tab, offset: currentOffset, limit: LIMIT } }
      );
      setItems(prev => currentOffset === 0 ? data.items : [...prev, ...data.items]);
      setTotal(data.total);
      setHasMore(currentOffset + data.items.length < data.total);
      setOffset(currentOffset + data.items.length);
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, [convId, tab, loading]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, convId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loading) load(offset);
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, offset, load]);

  const handleClick = (item) => {
    if (item.type === 'image' || item.type === 'video') {
      setPreview({ url: mediaUrl(item.fileUrl), type: item.type, name: item.fileName });
    } else {
      downloadFile(mediaUrl(item.fileUrl), item.fileName || 'download');
    }
  };

  return (
    <div
      role="dialog"
      aria-label="聊天文件"
      style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
    >
      {/* 遮罩 */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.28)' }}
      />

      {/* 面板 */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: Math.min(400, window.innerWidth),
        height: '100vh',
        background: 'var(--bg-panel)',
        display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)',
      }}>

        {/* 标题栏 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 16px',
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-default)',
        }}>
          <button
            onClick={onClose}
            aria-label="关闭聊天文件"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 6, borderRadius: 8, color: 'var(--text-secondary)',
              transition: 'background .12s, color .12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 20, height: 20, fill: 'currentColor', display: 'block' }}>
              <path d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1z"/>
            </svg>
          </button>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>聊天文件</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginLeft: 'auto' }}>
            共 {total} 项
          </span>
        </div>

        {/* Tab 栏 */}
        <div style={{
          display: 'flex',
          padding: '6px 8px 0',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-default)',
          gap: 2,
        }}>
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-selected={active}
                style={{
                  flex: 1,
                  padding: '7px 0 9px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm2)',
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--green)' : 'var(--text-tertiary)',
                  position: 'relative',
                  transition: 'color .15s',
                }}
              >
                {t.label}
                {active && (
                  <span style={{
                    position: 'absolute', bottom: 0, left: '50%',
                    transform: 'translateX(-50%)',
                    width: 24, height: 2.5,
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--green)',
                    opacity: .85,
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* 文件列表 */}
        <div style={{
          flex: 1, overflowY: 'auto',
          background: 'var(--bg-messages)',
          padding: '6px 0',
        }}>
          {items.length === 0 && !loading && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '60%',
              color: 'var(--text-secondary)', fontSize: 'var(--text-sm2)', gap: 10,
            }}>
              <svg viewBox="0 0 24 24" style={{ width: 44, height: 44, fill: 'currentColor', opacity: .22 }}>
                <path d="M20 6h-2.18c.07-.44.18-.88.18-1.36C18 2.05 15.96 0 13.5 0c-1.3 0-2.47.6-3.28 1.53L9 3 7.78 1.53C6.97.6 5.8 0 4.5 0 2.04 0 0 2.05 0 4.64c0 .48.11.92.18 1.36H0v2h20v-2zM20 10H4v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8z"/>
              </svg>
              暂无文件
            </div>
          )}

          {items.map(item => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={`打开 ${item.file_name || item.caption || '文件'}`}
              onClick={() => handleClick(item)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleClick(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 16px',
                margin: '0 8px 4px',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: 'var(--bg-card)',
                boxShadow: '0 1px 3px rgba(36,31,56,.06)',
                transition: 'background .1s, box-shadow .1s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--bg-card-hover)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(109,90,230,.10)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--bg-card)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(36,31,56,.06)';
              }}
            >
              {/* 缩略图 / 图标 */}
              <div style={{
                flexShrink: 0, width: 46, height: 46, borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                background: 'rgba(109,90,230,.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {item.type === 'image' ? (
                  <img
                    src={mediaUrl(item.fileUrl)}
                    alt={item.fileName}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                ) : item.type === 'video' ? <IcoVideo /> : <IcoFile />}
              </div>

              {/* 信息 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--text-sm2)', fontWeight: 500,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  color: 'var(--text-primary)',
                }}>
                  {item.fileName || (item.type === 'image' ? '图片' : item.type === 'video' ? '视频' : '文件')}
                </div>
                <div style={{
                  fontSize: 'var(--text-tiny)', color: 'var(--text-tertiary)', marginTop: 3,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <Avatar src={item.senderAvatar} name={item.senderName} size={13}
                    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.senderName} · {format(item.createdAt * 1000)}
                  </span>
                </div>
              </div>
            </div>
          ))}

          <div ref={loaderRef} style={{ height: 1 }} />
          {loading && (
            <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-secondary)', fontSize: 'var(--text-sm2)' }}>
              加载中…
            </div>
          )}
        </div>
      </div>

      {preview && (
        preview.type === 'video'
          ? <VideoPreview url={preview.url} name={preview.name} onClose={() => setPreview(null)} />
          : <ImagePreview url={preview.url} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
