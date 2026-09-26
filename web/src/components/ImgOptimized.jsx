import TouliaoIcon from '../ui-kit/Icon';
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { getThumbUrl } from '../utils/url';

/**
 * ImgOptimized — 聊天图片增强组件
 * - IntersectionObserver 懒加载（react-window 虚拟列表内图片提前加载）
 * - decoding="async" 不阻塞主线程
 * - 加载期间 skeleton 占位，消除布局抖动
 * - 渐进加载（默认开启）：先显示 blur(20px) 模糊缩略图，原图后台到达后交叉淡入；
 *   原图失败时保留缩略图（不显示破损态）。缩略图与原图同 URL 时自动降级为单阶段。
 * - 非渐进模式：缩略图失败（旧图无缩略图）回退原图 src，两者都失败才显示破损占位图
 */


export default function ImgOptimized({
  src, alt = '', className = '', style,
  width, height, aspectStyle,
  onClick, onKeyDown, onLoad: onLoadProp, onError: onErrorProp,
  threshold = 300,   // 提前 300px 开始加载
  progressive = true, // 渐进加载：先显示模糊缩略图，原图到达后交叉淡入
  'data-testid': testId,
  ...rest
}) {
  const ref    = useRef(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded]   = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false); // 原图是否已就绪（渐进第二阶段）
  const [broken, setBroken] = useState(false);
  const [displaySource, setDisplaySource] = useState(src);
  // A reused message row must not carry its previous image's error placeholder.
  if (displaySource !== src) {
    setDisplaySource(src);
    setBroken(false);
    setFullLoaded(false);
  }
  const thumbSrc = useMemo(() => getThumbUrl(src), [src]);
  // 渐进模式：缩略图与原图不同 URL 时才启用双阶段（否则单图直接显示）
  const useProgressive = progressive && thumbSrc && thumbSrc !== src;

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

  // 渐进第二阶段：原图加载完成 → 触发交叉淡入
  const handleFullLoad = useCallback(() => {
    setFullLoaded(true);
  }, []);

  const handleError = useCallback(e => {
    const el = e.currentTarget;
    // 非渐进模式：缩略图加载失败（旧图无缩略图/生成失败）时回退原图
    if (!useProgressive && thumbSrc && thumbSrc !== src && el.src !== src) {
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
  }, [thumbSrc, src, onErrorProp, useProgressive]);

  // 渐进模式原图失败：保留模糊缩略图，不显示破损态
  const handleFullError = useCallback(() => {
    setFullLoaded(false);
  }, []);

  const containerStyle = {
    display: 'inline-block',
    background: loaded ? 'none' : 'var(--bg-hover, rgba(0,0,0,.06))',
    borderRadius: 'inherit',
    position: 'relative',
    overflow: 'hidden',
    ...(aspectStyle || {}),
    ...(style || {}),
  };

  const imgBaseStyle = aspectStyle
    ? { width: '100%', height: '100%', display: 'block' }
    : undefined;

  return (
    <span ref={ref} style={containerStyle} className={loaded ? '' : 'img-skeleton'}>
      {visible && src && !broken && (
        <>
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
            style={{
              ...imgBaseStyle,
              // 渐进第一阶段：模糊缩略图先占位（轻微放大避免模糊边缘露白）
              ...(useProgressive ? {
                filter: 'blur(20px)',
                transform: 'scale(1.08)',
                transition: 'opacity var(--dur-normal, .3s)',
                opacity: fullLoaded ? 0 : 1,
              } : undefined),
            }}
            {...rest}
          />
          {/* 渐进第二阶段：原图后台加载，完成后淡入覆盖 */}
          {useProgressive && (
            <img
              src={src}
              alt=""
              aria-hidden="true"
              decoding="async"
              loading="lazy"
              onLoad={handleFullLoad}
              onError={handleFullError}
              onClick={onClick}
              style={{
                ...imgBaseStyle,
                position: 'absolute',
                inset: 0,
                transition: 'opacity var(--dur-normal, .3s)',
                opacity: fullLoaded ? 1 : 0,
                pointerEvents: fullLoaded ? undefined : 'none',
              }}
            />
          )}
        </>
      )}
      {broken && <span role="img" aria-label="图片加载失败" className="tl-icon-placeholder"
        style={{ width: width || '100%', height: height || 'var(--icon-xl)' }}><TouliaoIcon name="image" size="xl" tone="secondary" /></span>}
    </span>
  );
}
