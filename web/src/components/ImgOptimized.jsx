import TouliaoIcon from '../ui-kit/Icon';
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { getThumbUrl } from '../utils/url';

/**
 * ImgOptimized — 聊天图片增强组件
 * - IntersectionObserver 懒加载（react-window 虚拟列表内图片提前加载）
 * - decoding="async" 不阻塞主线程
 * - 加载期间 skeleton 占位，消除布局抖动
 * - 缩略图优先：先请求 getThumbUrl(src)（体积小得多），失败（旧图无缩略图）回退原图 src
 * - 两者都失败才显示破损占位图
 */


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
  const [broken, setBroken] = useState(false);
  const [displaySource, setDisplaySource] = useState(src);
  // A reused message row must not carry its previous image's error placeholder.
  if (displaySource !== src) {
    setDisplaySource(src);
    setBroken(false);
  }
  const thumbSrc = useMemo(() => getThumbUrl(src), [src]);

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

  const handleLoad = useCallback(e => {
    setLoaded(true);
    e.currentTarget.classList.add('loaded');
    onLoadProp?.(e);
  }, [onLoadProp]);

  const handleError = useCallback(e => {
    const el = e.currentTarget;
    // 缩略图加载失败（旧图无缩略图/生成失败）时回退原图
    if (thumbSrc && thumbSrc !== src && el.src !== src) {
      el.src = src;
      return;
    }
    el.onerror = null;
    setBroken(true);
    el.alt = '图片加载失败';
    el.style.cursor = 'default';
    el.style.pointerEvents = 'none';
    el.tabIndex = -1;
    setLoaded(true);
    el.classList.add('loaded');
    onErrorProp?.(e);
  }, [thumbSrc, src, onErrorProp]);

  const containerStyle = {
    display: 'inline-block',
    background: loaded ? 'none' : 'var(--bg-hover, rgba(0,0,0,.06))',
    borderRadius: 'inherit',
    ...(aspectStyle || {}),
    ...(style || {}),
  };

  return (
    <span ref={ref} style={containerStyle} className={loaded ? '' : 'img-skeleton'}>
      {visible && src && !broken && (
        <img
          src={thumbSrc}
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
      {broken && <span role="img" aria-label="图片加载失败" className="tl-icon-placeholder"
        style={{ width: width || '100%', height: height || 'var(--icon-xl)' }}><TouliaoIcon name="image" size="xl" tone="secondary" /></span>}
    </span>
  );
}
