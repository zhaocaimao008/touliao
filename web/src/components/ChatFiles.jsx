import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { mediaUrl, useMediaCredentials } from '../utils/url';
import { downloadFile } from '../utils/download';
import { format } from '../utils/time';
import Avatar from './Avatar';
import Icon from '../ui-kit/Icon';
import ImagePreview from './ImagePreview';
import VideoPreview from './VideoPreview';
import { useI18n } from '../contexts/I18nContext';
import { IcoVideo } from './Icons';

/**
 * 聊天文件聚合视图（抽屉面板）
 * Props:  convId — 会话 ID  |  onClose — 关闭回调
 */

const TABS = [
  { key: 'all',   labelKey: 'chatFiles.tabAll' },
  { key: 'image', labelKey: 'chatFiles.tabImage' },
  { key: 'video', labelKey: 'chatFiles.tabVideo' },
  { key: 'file',  labelKey: 'chatFiles.tabFile' },
];

const IcoFile = () => <Icon name="file-text" className="chatfiles-tab-icon" />;

export default function ChatFiles({ convId, onClose }) {
  useMediaCredentials();
  const { t } = useI18n();
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
      setPreview({ url: item.fileUrl, type: item.type, name: item.fileName });
    } else {
      downloadFile(mediaUrl(item.fileUrl), item.fileName || 'download');
    }
  };

  return (
    <div
      role="dialog"
      aria-label={t('chatFiles.title')}
      className="chatfiles-overlay-root"
    >
      {/* 遮罩 */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="chatfiles-backdrop"
      />

      {/* 面板 */}
      <div className="chatfiles-panel" style={{ width: Math.min(400, window.innerWidth) }}>

        {/* 标题栏 */}
        <div className="chatfiles-header">
          <button
            onClick={onClose}
            aria-label={t('chatFiles.closeAriaLabel')}
            className="chatfiles-close-btn"
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <Icon name="x" className="chatfiles-close-icon" />
          </button>
          <span className="chatfiles-title">{t('chatFiles.title')}</span>
          <span className="chatfiles-count">
            {t('chatFiles.countTemplate').replace('{count}', total)}
          </span>
        </div>

        {/* Tab 栏 */}
        <div className="chatfiles-tabs">
          {TABS.map(tabItem => {
            const active = tab === tabItem.key;
            return (
              <button
                key={tabItem.key}
                onClick={() => setTab(tabItem.key)}
                aria-selected={active}
                className="chatfiles-tab-btn"
                style={{
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--green)' : 'var(--text-tertiary)',
                }}
              >
                {t(tabItem.labelKey)}
                {active && (
                  <span className="chatfiles-tab-indicator" />
                )}
              </button>
            );
          })}
        </div>

        {/* 文件列表 */}
        <div className="chatfiles-list">
          {items.length === 0 && !loading && (
            <div className="chatfiles-empty">
              <Icon name="folder-open" size={40} className="chatfiles-empty-icon" />
              {t('chatFiles.noFiles')}
            </div>
          )}

          {items.map(item => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={t('chatFiles.openFileAriaLabelTemplate').replace('{name}', item.file_name || item.caption || t('chatFiles.tabFile'))}
              onClick={() => handleClick(item)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleClick(item)}
              className="chatfiles-item"
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
              <div className="chatfiles-thumb">
                {item.type === 'image' ? (
                  <img
                    key={mediaUrl(item.fileUrl)}
                    src={mediaUrl(item.fileUrl)}
                    alt={item.fileName}
                    loading="lazy"
                    className="chatfiles-thumb-img"
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                ) : item.type === 'video' ? <IcoVideo className="chatfiles-tab-icon" /> : <IcoFile />}
              </div>

              {/* 信息 */}
              <div className="chatfiles-info">
                <div className="chatfiles-info-name">
                  {item.fileName || (item.type === 'image' ? t('chatFiles.tabImage') : item.type === 'video' ? t('chatFiles.tabVideo') : t('chatFiles.tabFile'))}
                </div>
                <div className="chatfiles-info-meta">
                  <Avatar src={item.senderAvatar} name={item.senderName} size='13'
                    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }} />
                  <span className="chatfiles-info-sender">
                    {item.senderName} · {format(item.createdAt * 1000)}
                  </span>
                </div>
              </div>
            </div>
          ))}

          <div ref={loaderRef} className="chatfiles-loader-sentinel" />
          {loading && (
            <div className="chatfiles-loading-more">
              {t('common.loading')}
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
