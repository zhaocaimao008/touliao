import React, { useEffect, useState, useRef, useCallback } from 'react';
import { downloadFile } from '../utils/download';

// 从(可能带 ?token= 的)图片地址里抽一个像样的下载文件名
function filenameFromUrl(u) {
  try {
    const path = String(u).split('?')[0].split('#')[0];
    const base = path.substring(path.lastIndexOf('/') + 1);
    return decodeURIComponent(base) || `image_${Date.now()}.jpg`;
  } catch { return `image_${Date.now()}.jpg`; }
}

export default function ImagePreview({ url, urls = null, initialIdx = 0, onClose }) {
  // Gallery mode: urls array + current index; single mode: just url
  const gallery = urls && urls.length > 1;
  const [idx, setIdx] = useState(initialIdx);
  const currentUrl = gallery ? urls[idx] : url;

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);   // 当前大图是否已加载(未加载时显示转圈)
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });

  // 切换到新图 → 复位加载态，重新显示转圈直到 onLoad。
  // render 期派生（存上一次 currentUrl）替代 effect，避免多一帧旧图残留。
  const [loadedUrl, setLoadedUrl] = useState(currentUrl);
  if (currentUrl !== loadedUrl) {
    setLoadedUrl(currentUrl);
    setLoaded(false);
  }

  const resetTransform = () => { setScale(1); setPosition({ x: 0, y: 0 }); };

  const prev = useCallback(() => { setIdx(i => i > 0 ? i - 1 : urls.length - 1); resetTransform(); }, [urls]);
  const next = useCallback(() => { setIdx(i => i < urls.length - 1 ? i + 1 : 0); resetTransform(); }, [urls]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
    if (gallery && e.key === 'ArrowLeft') prev();
    if (gallery && e.key === 'ArrowRight') next();
    // 键盘缩放：+/= 放大、-/_ 缩小、0 复位(对齐通用图片查看器)
    if (e.key === '+' || e.key === '=') { setScale(s => Math.min(5, s + 0.25)); }
    if (e.key === '-' || e.key === '_') { setScale(s => { const ns = Math.max(0.5, s - 0.25); if (ns <= 1) setPosition({ x: 0, y: 0 }); return ns; }); }
    if (e.key === '0') { setScale(1); setPosition({ x: 0, y: 0 }); }
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
    setScale(s => {
      const ns = Math.max(0.5, Math.min(5, s + delta));
      // 缩回到 1 倍及以下时复位平移,避免图片停留在偏移位置(缩小后"跑偏")
      if (ns <= 1) setPosition({ x: 0, y: 0 });
      return ns;
    });
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
    <div
      data-testid="lightbox"
      role="dialog" aria-modal="true" aria-label="图片预览"
      style={{
        position: 'fixed', inset: 0, zIndex: "var(--z-top)",
        background: 'rgba(0,0,0,.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: scale > 1 ? 'grab' : 'zoom-out',
        userSelect: 'none',
        animation: 'fadeIn .18s ease-out',   // 遮罩淡入，避免生硬弹出
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
      {!loaded && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', width: 40, height: 40, borderRadius: '50%',
            border: '3px solid rgba(255,255,255,.25)', borderTopColor: '#fff',
            animation: 'wc-spin .8s linear infinite', pointerEvents: 'none',
          }}
        />
      )}
      <img
        data-testid="lightbox-image"
        key={currentUrl}
        src={currentUrl}
        alt={gallery ? `图片 ${idx + 1} / ${urls.length}` : '图片预览'}
        loading="lazy"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={e => { setLoaded(true); e.currentTarget.style.opacity = '.25'; e.currentTarget.alt = '图片加载失败'; }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          // 双击缩放切换：已放大→复位;原始大小→放大到 2x(对齐图片查看器通用手势)
          e.stopPropagation();
          if (scale > 1) resetTransform();
          else setScale(2);
        }}
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 'var(--radius-button-sm)',
          boxShadow: '0 8px 40px rgba(0,0,0,.5)',
          transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
          transition: dragging ? 'none' : 'transform .15s ease',
          cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
          animation: 'fadeIn .22s ease-out',   // 图片淡入(仅 opacity,不碰 transform 以免与缩放/平移冲突)；切换图片时随 key 重播
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

      {/* Download button：走统一 downloadFile,桌面/移动端与跨域云图也能可靠落盘(裸 <a download> 跨域失效) */}
      <button
        onClick={(e) => { e.stopPropagation(); downloadFile(currentUrl, filenameFromUrl(currentUrl)); }}
        aria-label="下载图片"
        style={{
          border: 'none', cursor: 'pointer',
          position: 'absolute', bottom: 30, left: '50%',
          transform: 'translateX(-50%)',
          color: 'var(--text-inverse)', fontSize: 13,
          background: 'rgba(255,255,255,.18)',
          padding: '8px 20px', borderRadius: 'var(--radius-2xl)',
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
      </button>

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
    width: 48, height: 80, borderRadius: 'var(--radius-input)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', cursor: 'pointer', zIndex: 10,
    backdropFilter: 'blur(6px)',
    transition: 'background .15s',
  };
}
