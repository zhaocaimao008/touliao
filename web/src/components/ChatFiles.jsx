import useFocusTrap from '../hooks/useFocusTrap';
import { EmptyState, ErrorState } from './StateViews';
import { humanFileSize } from '../utils/fileSize';
import TouliaoIcon from '../ui-kit/Icon';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { mediaUrl, useMediaCredentials } from '../utils/url';
import { downloadFile } from '../utils/download';
import { format } from '../utils/time';
import Avatar from './Avatar';

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

const IcoFile = () => <TouliaoIcon name="fileContent" className="chatfiles-tab-icon" />;

export default function ChatFiles({ convId, onClose }) {
  useMediaCredentials();
  const { t } = useI18n();
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [displayQuery, setDisplayQuery] = useState({ convId, tab });
  const requestRef = useRef(null);
  const modalRef = useFocusTrap(true, { onEscape: onClose, lockScroll: true });
  const [preview, setPreview] = useState(null);
  const loaderRef = useRef(null);
  const LIMIT = 30;

  // Reset presentation before rendering a different query. The effect below
  // still owns request cancellation and loading; no old rows flash in a new tab.
  if (displayQuery.convId !== convId || displayQuery.tab !== tab) {
    setDisplayQuery({ convId, tab });
    setItems([]);
    setOffset(0);
    setHasMore(false);
    setLoaded(false);
    setTotal(0);
    setLoading(true);
    setError(false);
  }

  const fetchPage = useCallback((currentOffset) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    return axios.get(
      `/api/messages/conversation/${convId}/files`,
      { params: { type: tab, offset: currentOffset, limit: LIMIT }, signal: controller.signal }
    ).then(({ data }) => {
      if (requestRef.current !== controller) return;
      setItems(prev => currentOffset === 0 ? data.items : [...prev, ...data.items]);
      setTotal(data.total);
      setHasMore(data.items.length > 0 && currentOffset + data.items.length < data.total);
      setOffset(currentOffset + data.items.length);
      setLoaded(true);
    }).catch(() => {
      if (requestRef.current === controller && !controller.signal.aborted) setError(true);
    }).finally(() => {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    });
  }, [convId, tab]);

  const load = useCallback((currentOffset) => {
    if (requestRef.current) return;
    setLoading(true);
    setError(false);
    return fetchPage(currentOffset);
  }, [fetchPage]);

  useEffect(() => {
    fetchPage(0);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [fetchPage]);

  useEffect(() => {
    const el = loaderRef.current;
    if (!el || error || loading || !hasMore) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) load(offset);
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, error, offset, load]);

  const handleClick = (item) => {
    if (item.type === 'image' || item.type === 'video') {
      setPreview({ url: item.fileUrl, type: item.type, name: item.fileName });
    } else {
      downloadFile(mediaUrl(item.fileUrl), item.fileName || 'download');
    }
  };

  return (
    <div
      ref={modalRef} tabIndex={-1} aria-modal="true" role="dialog"
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
      <div className="chatfiles-panel">

        {/* 标题栏 */}
        <div className="chatfiles-header">
          <button
            onClick={onClose}
            aria-label={t('chatFiles.closeAriaLabel')}
            className="chatfiles-close-btn"
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <TouliaoIcon name="close" className="chatfiles-close-icon" />
          </button>
          <span className="chatfiles-title">{t('chatFiles.title')}</span>
          <span className="chatfiles-count">
            {t('chatFiles.countTemplate').replace('{count}', total)}
          </span>
        </div>

        {/* Tab 栏 */}
        <div className="chatfiles-tabs" role="group" aria-label={t('chatFiles.title')}>
          {TABS.map(tabItem => {
            const active = tab === tabItem.key;
            return (
              <button
                key={tabItem.key}
                onClick={() => setTab(tabItem.key)}
                aria-pressed={active} data-selected={active}
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
          {loaded && items.length === 0 && !loading && !error && (
            <EmptyState icon={<TouliaoIcon name="folderOpen" className="chatfiles-empty-icon" size="xl" />} title={t('chatFiles.noFiles')} />
          )}

          {items.map(item => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={t('chatFiles.openFileAriaLabelTemplate').replace('{name}', item.fileName || t('chatFiles.tabFile'))}
              onClick={() => handleClick(item)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(item); } }}
              className="chatfiles-item"

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
                <div className="chatfiles-info-name" title={item.fileName}>
                  {item.fileName || (item.type === 'image' ? t('chatFiles.tabImage') : item.type === 'video' ? t('chatFiles.tabVideo') : t('chatFiles.tabFile'))}
                </div>
                {item.fileSize != null && <div className="chatfiles-info-size">{humanFileSize(item.fileSize)}</div>}
                <div className="chatfiles-info-meta">
                  <Avatar src={item.senderAvatar} name={item.senderName} size='xs' />
                  <span className="chatfiles-info-sender">
                    {item.senderName} · {format(item.createdAt * 1000)}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {error && <ErrorState onRetry={() => load(offset)} />}
          <div ref={loaderRef} className="chatfiles-loader-sentinel" />
          {loading && (
            <div className="chatfiles-loading-more" role="status" aria-live="polite">
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
