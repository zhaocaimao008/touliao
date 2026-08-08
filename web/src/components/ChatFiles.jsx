import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { mediaUrl } from '../utils/url';
import { downloadFile } from '../utils/download';
import { format } from '../utils/time';
import Avatar from './Avatar';
import ImagePreview from './ImagePreview';

/**
 * 聊天文件聚合视图（抽屉面板）
 * 功能：显示会话内全部 image/video/file 消息，支持 tab 分类、分页滚动、
 *       点击图片/视频打开预览，点击文件走下载逻辑。
 *
 * Props:
 *   convId   — 会话 ID
 *   onClose  — 关闭回调
 */

// tab 定义
const TABS = [
  { key: 'all',   label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'file',  label: '文件' },
];

// 文件图标（纯 SVG，不引入额外依赖）
const IcoFile = () => (
  <svg viewBox="0 0 24 24" style={{ width: 40, height: 40, fill: '#8A93A6' }}>
    <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
  </svg>
);
const IcoVideo = () => (
  <svg viewBox="0 0 24 24" style={{ width: 40, height: 40, fill: '#8A93A6' }}>
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
  const [preview, setPreview] = useState(null);   // { url, type } | null
  const loaderRef = useRef(null);
  const LIMIT = 30;

  // 切 tab 时重置列表（有意在 effect 中直接 setState，清空后再触发 load——eslint 规则不适用此正常 data-fetch 模式）
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setTotal(0);
  }, [tab, convId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 加载一页数据
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

  // 首次加载 / tab 切换后加载
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, convId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 滚动到底部自动加载下一页
  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loading) {
        load(offset);
      }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, offset, load]);

  // 点击图片/视频：打开 ImagePreview；点击文件：下载
  const handleClick = (item) => {
    if (item.type === 'image' || item.type === 'video') {
      setPreview({ url: mediaUrl(item.fileUrl), type: item.type });
    } else {
      downloadFile(mediaUrl(item.fileUrl), item.fileName || 'download');
    }
  };

  return (
    <div
      role="dialog"
      aria-label="聊天文件"
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
      }}
    >
      {/* 遮罩 */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)' }}
      />
      {/* 面板 */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: Math.min(400, window.innerWidth),
        height: '100vh',
        background: 'var(--bg-page)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 20px rgba(0,0,0,.15)',
      }}>
        {/* 标题栏 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-default)',
        }}>
          <button
            onClick={onClose}
            aria-label="关闭聊天文件"
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, color: 'var(--text-secondary)' }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 20, height: 20, fill: 'currentColor' }}>
              <path d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1z"/>
            </svg>
          </button>
          <span style={{ fontWeight: 600, fontSize: 15 }}>聊天文件</span>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 13, marginLeft: 'auto' }}>
            共 {total} 项
          </span>
        </div>

        {/* Tab 栏 */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-elevated)',
        }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-selected={tab === t.key}
              style={{
                flex: 1, padding: '10px 0', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 13,
                color: tab === t.key ? 'var(--green)' : 'var(--text-secondary)',
                borderBottom: tab === t.key ? '2px solid var(--green)' : '2px solid transparent',
                fontWeight: tab === t.key ? 600 : 400,
                transition: 'color .15s, border-color .15s',
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* 文件列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {items.length === 0 && !loading && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '60%',
              color: 'var(--text-tertiary)', fontSize: 13,
            }}>
              <svg viewBox="0 0 24 24" style={{ width: 48, height: 48, fill: 'currentColor', opacity: .3, marginBottom: 8 }}>
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
              onClick={() => handleClick(item)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleClick(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 16px', cursor: 'pointer',
                borderBottom: '1px solid var(--border-subtle)',
                transition: 'background .1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = ''; }}
            >
              {/* 缩略图 / 图标 */}
              <div style={{ flexShrink: 0, width: 48, height: 48, borderRadius: 4, overflow: 'hidden',
                background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {item.type === 'image' ? (
                  <img
                    src={mediaUrl(item.fileUrl)}
                    alt={item.fileName}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                ) : item.type === 'video' ? <IcoVideo />
                  : <IcoFile />}
              </div>
              {/* 信息区 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  color: 'var(--text-primary)' }}>
                  {item.fileName || (item.type === 'image' ? '图片' : item.type === 'video' ? '视频' : '文件')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  <Avatar src={item.senderAvatar} name={item.senderName} size={14}
                    style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />
                  {item.senderName} · {format(item.createdAt * 1000)}
                </div>
              </div>
            </div>
          ))}
          {/* 触底自动加载触发器 */}
          <div ref={loaderRef} style={{ height: 1 }} />
          {loading && (
            <div style={{ textAlign: 'center', padding: '16px 0',
              color: 'var(--text-tertiary)', fontSize: 13 }}>
              加载中…
            </div>
          )}
        </div>
      </div>

      {/* 图片/视频预览 */}
      {preview && (
        <ImagePreview
          src={preview.url}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
