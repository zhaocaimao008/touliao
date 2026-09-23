import TouliaoIcon from '../ui-kit/Icon';
import useFocusTrap from '../hooks/useFocusTrap';
import React, { useEffect, useState } from 'react';
import { downloadFile, startDownload, subscribe, getState, cancelDownload, retryDownload } from '../utils/downloadManager';
import { shareMessage, canShare } from '../utils/share';
import { useI18n } from '../contexts/I18nContext';
import { mediaUrl, useMediaCredentials } from '../utils/url';

// 从(可能带 ?token= / #t= 的)视频地址里抽一个像样的下载文件名
function filenameFromUrl(u) {
  try {
    const path = String(u).split('?')[0].split('#')[0];
    const base = path.substring(path.lastIndexOf('/') + 1);
    return decodeURIComponent(base) || `video_${Date.now()}.mp4`;
  } catch { return `video_${Date.now()}.mp4`; }
}

/**
 * 全屏视频预览：点聊天/聊天文件里的视频缩略图后打开。
 * 与 ImagePreview 对齐的全屏遮罩交互：Esc 关闭、点遮罩关闭、底部下载按钮。
 */
export default function VideoPreview({ url: fileUrl, name, onClose }) {
  useMediaCredentials();
  const url = mediaUrl(fileUrl);
  const { t } = useI18n();
  const [downloadSnapshot, setDownload] = useState(() => getState(fileUrl));
  const download = downloadSnapshot?.id === fileUrl ? downloadSnapshot : null;
  const uploading = String(fileUrl).startsWith('blob:');
  const busy = download && ['pending', 'downloading'].includes(download.status);
  useEffect(() => {
    return subscribe(fileUrl, setDownload);
  }, [fileUrl]);
  const handleDownload = () => {
    if (uploading || busy) return;
    if (!window.__ELECTRON_CONFIG__) {
      downloadFile(fileUrl, name || filenameFromUrl(fileUrl));
      return;
    }
    if (download?.status === 'failed' || download?.status === 'cancelled') retryDownload(fileUrl);
    else startDownload({ fileUrl, filename: name || filenameFromUrl(fileUrl) });
  };
  const modalRef = useFocusTrap(true, { onEscape: onClose, lockScroll: true, initialFocus: '[data-testid="video-lightbox-close"]' });

  return (
    <div
      ref={modalRef} tabIndex={-1} data-testid="video-lightbox"
      role="dialog" aria-modal="true" aria-label={t('videoPreview.title')}
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-top)',
        background: 'rgba(0,0,0,.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn .18s ease-out',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <video
        data-testid="video-lightbox-player"
        src={url}
        controls
        controlsList="nodownload"
        autoPlay
        playsInline
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '92vw', maxHeight: '86vh',
          borderRadius: 'var(--radius-button-sm)',
          boxShadow: '0 8px 40px rgba(0,0,0,.5)',
          background: '#000',
        }}
      />

      {/* 底部操作条：下载 + 分享到第三方 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 30, left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
          gap: 12, zIndex: 10, width: 'max-content', maxWidth: '92vw',
        }}
      >
        <button
          onClick={handleDownload}
          disabled={uploading || busy}
          aria-label={t('videoPreview.download')}
          style={{
            border: 'none', cursor: 'pointer',
            color: 'var(--text-inverse)', fontSize: 'var(--text-sm2)',
            background: 'rgba(255,255,255,.18)',
            padding: '8px 20px', borderRadius: 'var(--radius-2xl)',
            display: 'flex', alignItems: 'center', gap: 6,
            backdropFilter: 'blur(10px)',
          }}
        >
          <TouliaoIcon name="download" tone="onDark" size="xs" />
          {t(uploading ? 'videoPreview.uploading' : busy ? 'videoPreview.downloading' : download?.status === 'failed' ? 'filePreview.retry' : 'videoPreview.downloadShort')}
        </button>
        {busy && <button onClick={() => cancelDownload(fileUrl)} style={{
          border: 'none', borderRadius: 'var(--radius-2xl)', padding: '8px 20px',
          color: 'var(--text-inverse)', background: 'rgba(255,255,255,.18)', cursor: 'pointer',
        }}>{t('common.cancel')}</button>}
        <span role="status" style={{ color: '#fff', maxWidth: '80vw', overflowWrap: 'anywhere' }}>
          {busy && (download.progress == null ? '' : `${download.progress}%`)}
          {download?.status === 'completed' && `${t('videoPreview.saved')}${download.savePath ? ': ' + download.savePath : ''}`}
          {download?.status === 'failed' && `${t('filePreview.downloadFailed')}: ${download.error || ''}`}
          {download?.status === 'cancelled' && t('filePreview.cancelledRedownload')}
        </span>
        {!uploading && canShare() && (
          <button
            onClick={(e) => { e.stopPropagation(); shareMessage({ fileUrl, filename: name || filenameFromUrl(fileUrl), title: name || t('videoPreview.share') }); }}
            aria-label={t('videoPreview.share')}
            data-testid="video-lightbox-share"
            style={{
              border: 'none', cursor: 'pointer',
              color: 'var(--text-inverse)', fontSize: 'var(--text-sm2)',
              background: 'rgba(255,255,255,.18)',
              padding: '8px 20px', borderRadius: 'var(--radius-2xl)',
              display: 'flex', alignItems: 'center', gap: 6,
              backdropFilter: 'blur(10px)',
            }}
          >
            <TouliaoIcon name="share" tone="onDark" size="xs" />
            {t('videoPreview.shareShort')}
          </button>
        )}
      </div>

      {/* Close button */}
      <button
        data-testid="video-lightbox-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{
          position: 'absolute', top: 18, right: 18,
          color: 'var(--text-inverse)', fontSize: 24, lineHeight: 1,
          background: 'rgba(255,255,255,.12)',
          width: 36, height: 36, borderRadius: 'var(--radius-full)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', cursor: 'pointer', zIndex: 10,
          backdropFilter: 'blur(10px)',
        }}
        aria-label={t('common.close')}
      ><TouliaoIcon name="close" size="sm" /></button>
    </div>
  );
}
