import React, { useEffect, useState, useRef, useCallback } from 'react';

export default function ImagePreview({ url, urls = null, initialIdx = 0, onClose }) {
  // Gallery mode: urls array + current index; single mode: just url
  const gallery = urls && urls.length > 1;
  const [idx, setIdx] = useState(initialIdx);
  const currentUrl = gallery ? urls[idx] : url;

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });

  const resetTransform = () => { setScale(1); setPosition({ x: 0, y: 0 }); };

  const prev = useCallback(() => { setIdx(i => i > 0 ? i - 1 : urls.length - 1); resetTransform(); }, [urls]);
  const next = useCallback(() => { setIdx(i => i < urls.length - 1 ? i + 1 : 0); resetTransform(); }, [urls]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
    if (gallery && e.key === 'ArrowLeft') prev();
    if (gallery && e.key === 'ArrowRight') next();
  }, [onClose, gallery, prev, next]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale(s => Math.max(0.5, Math.min(5, s + delta)));
  }, []);

  // Pinch zoom (touch)
  const lastPinchDist = useRef(null);
  const touchStartX = useRef(null);
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
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
      setScale(s => Math.max(0.5, Math.min(5, s + delta)));
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
    if (scale > 1) {
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      posStart.current = { ...position };
    }
  };
  const handleMouseMove = (e) => {
    if (dragging && scale > 1) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPosition({ x: posStart.current.x + dx, y: posStart.current.y + dy });
    }
  };
  const handleMouseUp = () => setDragging(false);

  return (
    <div
      data-testid="lightbox"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: scale > 1 ? 'grab' : 'zoom-out',
        userSelect: 'none',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <img
        data-testid="lightbox-image"
        key={currentUrl}
        src={currentUrl}
        alt=""
        loading="lazy"
        draggable={false}
        onError={e => { e.currentTarget.style.opacity = '.25'; e.currentTarget.alt = '图片加载失败'; }}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 4,
          boxShadow: '0 8px 40px rgba(0,0,0,.5)',
          transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
          transition: dragging ? 'none' : 'transform .15s ease',
          cursor: 'default',
        }}
      />

      {/* Gallery navigation arrows */}
      {gallery && (
        <>
          <button data-testid="lightbox-prev" onClick={(e) => { e.stopPropagation(); prev(); }} style={arrowStyle('left')} aria-label="上一张">‹</button>
          <button data-testid="lightbox-next" onClick={(e) => { e.stopPropagation(); next(); }} style={arrowStyle('right')} aria-label="下一张">›</button>
          <div style={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,.7)', fontSize: 13, zIndex: 10, pointerEvents: 'none' }}>
            {idx + 1} / {urls.length}
          </div>
        </>
      )}

      {/* Download button */}
      <a
        href={currentUrl}
        download
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 30, left: '50%',
          transform: 'translateX(-50%)',
          color: 'var(--text-inverse)', fontSize: 13,
          background: 'rgba(255,255,255,.18)',
          padding: '8px 20px', borderRadius: 20,
          textDecoration: 'none',
          display: 'flex', alignItems: 'center', gap: 6,
          backdropFilter: 'blur(10px)',
          zIndex: 10,
        }}
      >
        <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: 'var(--text-inverse)' }}>
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
        </svg>
        下载
      </a>

      {/* Close button */}
      <button
        data-testid="lightbox-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{
          position: 'absolute', top: 18, right: 18,
          color: 'var(--text-inverse)', fontSize: 24, lineHeight: 1,
          background: 'rgba(255,255,255,.12)',
          width: 36, height: 36, borderRadius: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', cursor: 'pointer', zIndex: 10,
          backdropFilter: 'blur(10px)',
        }}
        aria-label="关闭"
      >
        ✕
      </button>

      {/* Zoom indicator */}
      <div
        style={{
          position: 'absolute', bottom: 80, left: '50%',
          transform: 'translateX(-50%)',
          color: 'rgba(255,255,255,.5)',
          fontSize: 12, zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        {scale !== 1 ? `${Math.round(scale * 100)}%` : gallery ? '← → 切换  滚轮缩放' : '滚轮缩放'}
      </div>
    </div>
  );
}

function arrowStyle(side) {
  return {
    position: 'absolute', [side]: 16, top: '50%', transform: 'translateY(-50%)',
    color: 'var(--text-inverse)', fontSize: 48, lineHeight: 1,
    background: 'rgba(255,255,255,.1)',
    width: 48, height: 80, borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', cursor: 'pointer', zIndex: 10,
    backdropFilter: 'blur(6px)',
    transition: 'background .15s',
  };
}
