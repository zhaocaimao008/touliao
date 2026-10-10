import TouliaoIcon from '../ui-kit/Icon';
import useFocusTrap, { isTopFocusLayer } from '../hooks/useFocusTrap';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { downloadFile } from '../utils/download';
import { shareMessage, canShare } from '../utils/share';
import { useI18n } from '../contexts/I18nContext';
import { mediaUrl, useMediaCredentials } from '../utils/url';
import useMediaLoadState from '../hooks/useMediaLoadState';
import MediaPreviewStatus from './MediaPreviewStatus';
import './MediaPreview.css';

// 从(可能带 ?token= 的)图片地址里抽一个像样的下载文件名
function filenameFromUrl(u) {
  try {
    const path = String(u).split('?')[0].split('#')[0];
    const base = path.substring(path.lastIndexOf('/') + 1);
    return decodeURIComponent(base) || `image_${Date.now()}.jpg`;
  } catch { return `image_${Date.now()}.jpg`; }
}

export default function ImagePreview({ url, urls = null, initialIdx = 0, onClose }) {
  useMediaCredentials();
  const { t } = useI18n();
  const modalRef = useFocusTrap(true, { onEscape: onClose, lockScroll: true, initialFocus: '[data-testid="lightbox-close"]' });
  // Gallery mode: urls array + current index; single mode: just url
  const gallery = urls && urls.length > 1;
  const [idx, setIdx] = useState(initialIdx);
  const sourceUrl = gallery ? urls[idx] : url;
  const currentUrl = mediaUrl(sourceUrl);
  const media = useMediaLoadState(currentUrl);

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });

  const resetTransform = () => { setScale(1); setPosition({ x: 0, y: 0 }); };

  const prev = useCallback(() => { setIdx(i => i > 0 ? i - 1 : urls.length - 1); resetTransform(); }, [urls]);
  const next = useCallback(() => { setIdx(i => i < urls.length - 1 ? i + 1 : 0); resetTransform(); }, [urls]);

  const handleKeyDown = useCallback((e) => {
    if (!isTopFocusLayer(modalRef.current) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (gallery && e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    if (gallery && e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (media.status !== 'ready') return;
    // 键盘缩放：+/= 放大、-/_ 缩小、0 复位(对齐通用图片查看器)
    if (e.key === '+' || e.key === '=') { setScale(s => Math.min(5, s + 0.25)); }
    if (e.key === '-' || e.key === '_') { setScale(s => { const ns = Math.max(0.5, s - 0.25); if (ns <= 1) setPosition({ x: 0, y: 0 }); return ns; }); }
    if (e.key === '0') { setScale(1); setPosition({ x: 0, y: 0 }); }
  }, [modalRef, gallery, prev, next, media.status]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    if (media.status !== 'ready' || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale(s => {
      const ns = Math.max(0.5, Math.min(5, s + delta));
      // 缩回到 1 倍及以下时复位平移,避免图片停留在偏移位置(缩小后"跑偏")
      if (ns <= 1) setPosition({ x: 0, y: 0 });
      return ns;
    });
  }, [media.status]);
  useEffect(() => {
    const node = modalRef.current;
    node?.addEventListener('wheel', handleWheel, { passive: false });
    return () => node?.removeEventListener('wheel', handleWheel);
  }, [handleWheel, modalRef]);

  // Pinch zoom (touch)
  const lastPinchDist = useRef(null);
  const touchStartX = useRef(null);
  const handleTouchStart = (e) => {
    if (e.target.closest('button') || media.status !== 'ready') return;
    if (e.touches.length === 2) {
      touchStartX.current = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    } else if (e.touches.length === 1 && scale === 1) {
      touchStartX.current = e.touches[0].clientX;
    }
  };
  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && lastPinchDist.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = (dist - lastPinchDist.current) / 100;
      setScale(s => {
        const ns = Math.max(0.5, Math.min(5, s + delta));
        if (ns <= 1) setPosition({ x: 0, y: 0 });   // 捏合缩回 1 倍复位平移,与滚轮一致
        return ns;
      });
      lastPinchDist.current = dist;
    }
  };
  const handleTouchEnd = (e) => {
    lastPinchDist.current = null;
    if (gallery && scale === 1 && touchStartX.current !== null && e.changedTouches.length === 1) {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      if (Math.abs(dx) > 50) dx < 0 ? next() : prev();
    }
    touchStartX.current = null;
  };

  // Drag to pan (when zoomed in)
  const handleMouseDown = (e) => {
    if (e.target.closest('button') || media.status !== 'ready') return;
    if (scale > 1) {
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      posStart.current = { ...position };
    }
  };
  // 平移边界：放大后可移动范围约为 (scale-1) × 半个视口,超出即钳住,防止把图拖出屏幕丢失
  const clampPan = (x, y) => {
    const maxX = Math.max(0, (scale - 1) * window.innerWidth * 0.5);
    const maxY = Math.max(0, (scale - 1) * window.innerHeight * 0.5);
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };
  const handleMouseMove = (e) => {
    if (dragging && scale > 1) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPosition(clampPan(posStart.current.x + dx, posStart.current.y + dy));
    }
  };
  const handleMouseUp = () => setDragging(false);

  return (
    <div data-testid="lightbox" className="media-preview"
      ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('imagePreview.title')}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
      onTouchCancel={() => { lastPinchDist.current = null; touchStartX.current = null; }}
      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      <div className="media-preview-header">
        <div className="media-preview-heading">{t('imagePreview.title')}
          {gallery && <span className="media-preview-count" aria-live="polite">{idx + 1} / {urls.length}</span>}
        </div>
        <button type="button" data-testid="lightbox-close" className="media-preview-close" onClick={onClose} aria-label={t('common.close')}>
          <TouliaoIcon name="close" size="sm" />
        </button>
      </div>
      <div className="media-preview-stage" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        <img data-testid="lightbox-image" key={media.key} src={currentUrl}
          data-load-state={media.status} aria-hidden={media.status === 'error' || undefined}
          alt={gallery ? t('imagePreview.imageAltTemplate').replace('{n}', idx + 1).replace('{total}', urls.length) : t('imagePreview.title')}
          draggable={false} onLoad={media.ready} onError={media.fail}
          onClick={event => event.stopPropagation()}
          onDoubleClick={event => { event.stopPropagation(); if (scale > 1) resetTransform(); else setScale(2); }}
          style={{ transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            transition: dragging ? 'none' : 'transform .15s ease', cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in' }} />
        <MediaPreviewStatus state={media} errorKey="imagePreview.loadFailed" />
        {gallery && <>
          <button type="button" data-testid="lightbox-prev" className="media-preview-arrow media-preview-arrow--prev" onClick={prev} aria-label={t('imagePreview.prev')}><TouliaoIcon name="previous" size="md" /></button>
          <button type="button" data-testid="lightbox-next" className="media-preview-arrow media-preview-arrow--next" onClick={next} aria-label={t('imagePreview.next')}><TouliaoIcon name="disclosure" size="md" /></button>
        </>}
      </div>
      <div className="media-preview-footer">
        <div className="media-preview-zoom" role="group" aria-label={t('imagePreview.zoomControls')}>
          <button type="button" onClick={() => { setScale(value => Math.max(.5, value - .25)); setPosition({ x: 0, y: 0 }); }} disabled={media.status !== 'ready' || scale <= .5} aria-label={t('imagePreview.zoomOut')}><TouliaoIcon name="minimize" size="sm" /></button>
          <button type="button" className="media-preview-scale" onClick={resetTransform} disabled={media.status !== 'ready'} aria-label={t('imagePreview.resetZoom')}>{Math.round(scale * 100)}%</button>
          <button type="button" onClick={() => setScale(value => Math.min(5, value + .25))} disabled={media.status !== 'ready' || scale >= 5} aria-label={t('imagePreview.zoomIn')}><TouliaoIcon name="add" size="sm" /></button>
        </div>
        <p className="media-preview-hint media-preview-hint--desktop">{t(gallery ? 'imagePreview.galleryHint' : 'imagePreview.zoomHint')}</p>
        <p className="media-preview-hint media-preview-hint--touch">{t('imagePreview.touchHint')}</p>
        <div className="media-preview-actions">
          <button type="button" onClick={() => downloadFile(sourceUrl, filenameFromUrl(sourceUrl))} aria-label={t('imagePreview.download')}>
            <TouliaoIcon name="download" tone="onDark" size="xs" />{t('videoPreview.downloadShort')}
          </button>
          {canShare() && <button type="button" data-testid="lightbox-share" onClick={() => shareMessage({ fileUrl: sourceUrl, filename: filenameFromUrl(sourceUrl), title: t('imagePreview.share') })} aria-label={t('imagePreview.share')}>
            <TouliaoIcon name="share" tone="onDark" size="xs" />{t('videoPreview.shareShort')}
          </button>}
        </div>
      </div>
    </div>
  );
}
