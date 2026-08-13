import React, { useRef, useState, useEffect, useCallback } from 'react';

/**
 * ImgOptimized — 聊天图片增强组件
 * - IntersectionObserver 懒加载（react-window 虚拟列表内图片提前加载）
 * - decoding="async" 不阻塞主线程
 * - 加载期间 skeleton 占位，消除布局抖动
 * - 失败时显示破损占位图
 */

const IMG_BROKEN = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
    <path d="M21 15l-5-5L5 21"/>
  </svg>`
);

// 全局 WebP 支持检测（只检测一次）
let webpSupported = null;
function checkWebP() {
  if (webpSupported !== null) return Promise.resolve(webpSupported);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = img.onerror = () => { webpSupported = img.width === 1; resolve(webpSupported); };
    img.src = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAkA4JZACdAEO/gHOAAA=';
  });
}

// 如果 URL 是本站上传的图片，尝试追加 ?fmt=webp 参数（后端需支持；不支持时原图返回）
function toWebPUrl(src) {
  if (!src || src.startsWith('data:')) return src;
  try {
    const u = new URL(src, location.origin);
    if (u.pathname.startsWith('/uploads/') || u.pathname.startsWith('/api/')) {
      u.searchParams.set('fmt', 'webp');
      return u.toString();
    }
  } catch { /* 外部 URL 不转换 */ }
  return src;
}

export default function ImgOptimized({
  src, alt = '', className = '', style,
  width, height, aspectStyle,
  onClick, onKeyDown, onLoad: onLoadProp, onError: onErrorProp,
  threshold = 300,   // 提前 300px 开始加载
  'data-testid': testId,
  ...rest
}) {
  const ref    = useRef(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded]   = useState(false);
  const [webpSrc, setWebpSrc] = useState(null);

  // IntersectionObserver 探测入视
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } },
      { rootMargin: `${threshold}px` }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  // 入视后检测 WebP，选最优 src
  useEffect(() => {
    if (!visible) return;
    checkWebP().then(ok => setWebpSrc(ok ? toWebPUrl(src) : src));
  }, [visible, src]);

  const handleLoad = useCallback(e => {
    setLoaded(true);
    e.currentTarget.classList.add('loaded');
    onLoadProp?.(e);
  }, [onLoadProp]);

  const handleError = useCallback(e => {
    const el = e.currentTarget;
    // WebP 失败时回退原图
    if (webpSrc && webpSrc !== src && el.src !== src) {
      el.src = src;
      return;
    }
    el.onerror = null;
    el.src = IMG_BROKEN;
    el.alt = '图片加载失败';
    el.style.cursor = 'default';
    el.style.pointerEvents = 'none';
    el.tabIndex = -1;
    setLoaded(true);
    el.classList.add('loaded');
    onErrorProp?.(e);
  }, [webpSrc, src, onErrorProp]);

  const containerStyle = {
    display: 'inline-block',
    background: loaded ? 'none' : 'var(--bg-hover, rgba(0,0,0,.06))',
    borderRadius: 'inherit',
    ...(aspectStyle || {}),
    ...(style || {}),
  };

  return (
    <span ref={ref} style={containerStyle} className={loaded ? '' : 'img-skeleton'}>
      {visible && webpSrc && (
        <img
          src={webpSrc}
          alt={alt}
          className={className}
          width={width}
          height={height}
          decoding="async"
          loading="lazy"
          data-testid={testId}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onLoad={handleLoad}
          onError={handleError}
          style={aspectStyle ? { width: '100%', height: '100%', display: 'block' } : undefined}
          {...rest}
        />
      )}
    </span>
  );
}
