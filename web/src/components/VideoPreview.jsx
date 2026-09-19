import TouliaoIcon from '../ui-kit/Icon';
import React, { useEffect, useCallback } from 'react';
import { downloadFile } from '../utils/download';
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
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  return (
    <div
      data-testid="video-lightbox"
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
          display: 'flex', alignItems: 'center', gap: 12, zIndex: 10,
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); downloadFile(url, name || filenameFromUrl(url)); }}
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
          {t('videoPreview.downloadShort')}
        </button>
        {canShare() && (
          <button
            onClick={(e) => { e.stopPropagation(); shareMessage({ fileUrl: url, filename: name || filenameFromUrl(url), title: name || t('videoPreview.share') }); }}
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
