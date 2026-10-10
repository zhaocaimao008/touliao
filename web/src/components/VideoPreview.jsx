import TouliaoIcon from '../ui-kit/Icon';
import useFocusTrap from '../hooks/useFocusTrap';
import React, { useEffect, useState } from 'react';
import { downloadFile, startDownload, subscribe, getState, cancelDownload, retryDownload } from '../utils/downloadManager';
import { shareMessage, canShare } from '../utils/share';
import { useI18n } from '../contexts/I18nContext';
import { mediaUrl, useMediaCredentials } from '../utils/url';
import useMediaLoadState from '../hooks/useMediaLoadState';
import MediaPreviewStatus from './MediaPreviewStatus';
import './MediaPreview.css';

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
  const media = useMediaLoadState(url);
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
    <div ref={modalRef} tabIndex={-1} data-testid="video-lightbox" className="media-preview"
      role="dialog" aria-modal="true" aria-label={t('videoPreview.title')}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="media-preview-header">
        <div className="media-preview-heading">{t('videoPreview.title')}</div>
        <button type="button" data-testid="video-lightbox-close" className="media-preview-close" onClick={onClose} aria-label={t('common.close')}>
          <TouliaoIcon name="close" size="sm" />
        </button>
      </div>
      <div className="media-preview-stage" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        <video data-testid="video-lightbox-player" key={media.key} src={url}
          data-load-state={media.status} aria-label={name || t('videoPreview.title')}
          aria-hidden={media.status === 'error' || undefined}
          controls controlsList="nodownload" autoPlay playsInline
          onLoadedData={media.ready} onError={media.fail}
          onClick={event => event.stopPropagation()} />
        <MediaPreviewStatus state={media} errorKey="videoPreview.loadFailed" />
      </div>
      <div className="media-preview-footer">
        <div className="media-preview-actions">
          <button type="button" onClick={handleDownload} disabled={uploading || busy} aria-label={t('videoPreview.download')}>
            <TouliaoIcon name="download" tone="onDark" size="xs" />
            {t(uploading ? 'videoPreview.uploading' : busy ? 'videoPreview.downloading' : download?.status === 'failed' ? 'filePreview.retry' : 'videoPreview.downloadShort')}
          </button>
          {busy && <button type="button" onClick={() => cancelDownload(fileUrl)}>{t('common.cancel')}</button>}
          {!uploading && canShare() && <button type="button" data-testid="video-lightbox-share"
            onClick={() => shareMessage({ fileUrl, filename: name || filenameFromUrl(fileUrl), title: name || t('videoPreview.share') })}
            aria-label={t('videoPreview.share')}>
            <TouliaoIcon name="share" tone="onDark" size="xs" />{t('videoPreview.shareShort')}
          </button>}
        </div>
        <span role="status" className="media-preview-download-state">
          {busy && (download.progress == null ? '' : download.progress + '%')}
          {download?.status === 'completed' && t('videoPreview.saved') + (download.savePath ? ': ' + download.savePath : '')}
          {download?.status === 'failed' && t('filePreview.downloadFailed') + ': ' + (download.error || '')}
          {download?.status === 'cancelled' && t('filePreview.cancelledRedownload')}
        </span>
      </div>
    </div>
  );
}
