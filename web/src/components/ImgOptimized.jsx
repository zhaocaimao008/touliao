import React, { useLayoutEffect, useRef, useState } from 'react';
import TouliaoIcon from '../ui-kit/Icon';
import { useI18n } from '../contexts/I18nContext';
import { getThumbUrl } from '../utils/url';

// The virtual list already limits mounted rows. Keep real image elements in the
// DOM and let native lazy loading handle visibility; a second observer gate can
// strand a visible row at its placeholder after scrolling or a viewport change.
export default function ImgOptimized({ src, progressive = true, threshold: _threshold, ...props }) {
  const thumbSrc = getThumbUrl(src);
  return <ImageResource key={JSON.stringify([src, thumbSrc, progressive])}
    {...props} src={src} thumbSrc={thumbSrc} progressive={progressive} />;
}

function ImageResource({ src, thumbSrc, progressive, alt = '', className = '', style,
  width, height, aspectStyle, onClick, onKeyDown, onLoad, onError, 'data-testid': testId, ...rest }) {
  const { t } = useI18n();
  const [state, setState] = useState({ attempt: 0, thumb: 'pending', full: 'pending' });
  const current = useRef(state);
  const mounted = useRef(false);
  const imageRef = useRef(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (state.attempt > 0) imageRef.current?.focus({ preventScroll: true });
  }, [state.attempt]);

  const hasThumb = !!thumbSrc && thumbSrc !== src;
  const failed = value => value.full === 'error' && (!hasThumb || value.thumb === 'error');
  const settle = (part, status, event, overlay = false) => {
    const previous = current.current;
    if (!mounted.current || previous.attempt !== state.attempt || previous[part] !== 'pending' || (overlay && previous.thumb === 'error')) return;
    const next = { ...previous, [part]: status };
    current.current = next;
    setState(next);
    // Both layers may finish in one event batch. Only terminal failure is an
    // image failure, and the original's dimensions also reach the row measurer.
    if (status === 'ready') onLoad?.(event);
    else if (failed(next) && !failed(previous)) onError?.(event);
  };
  const retry = event => {
    event.stopPropagation();
    if (!mounted.current || current.current.attempt !== state.attempt) return;
    const next = { attempt: state.attempt + 1, thumb: 'pending', full: 'pending' };
    current.current = next;
    setState(next);
  };

  const usingThumb = hasThumb && state.thumb !== 'error';
  const showFullLayer = progressive && usingThumb && state.full !== 'error';
  const fullVisible = showFullLayer && state.full === 'ready';
  const loaded = state.thumb === 'ready' || state.full === 'ready';
  const broken = failed(state);
  const primaryPart = usingThumb ? 'thumb' : 'full';
  const softenThumb = progressive && usingThumb && state.full !== 'error';
  const imageStyle = aspectStyle ? { width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', objectFit: 'cover', display: 'block' } : undefined;

  return <span className={loaded || broken ? '' : 'img-skeleton'} style={{
    display: 'inline-block', background: loaded || broken ? 'none' : 'var(--bg-hover, rgba(0,0,0,.06))',
    borderRadius: 'inherit', position: 'relative', overflow: 'hidden', ...aspectStyle, ...style,
  }}>
    {broken ? <button type="button" data-testid={testId ? `${testId}-retry` : 'image-retry'}
      className={`${className} loaded`} onClick={retry} aria-label={t('authImage.loadFailedRetry')}
      style={{ ...imageStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8, minWidth: 120, minHeight: 120, padding: 12, border: '1px solid var(--tl-border)',
        color: 'var(--tl-readable-muted)', background: 'var(--tl-surface-secondary)', cursor: 'pointer', fontSize: 12 }}>
      <TouliaoIcon name="image" size="xl" tone="secondary" />
      <span>{t('authImage.loadFailedRetry')}</span>
    </button> : <>
      <img key={`primary:${state.attempt}:${primaryPart}`} ref={imageRef}
        src={usingThumb ? thumbSrc : src} alt={alt} className={`${className}${loaded ? ' loaded' : ''}`}
        width={width} height={height} decoding="async" loading="lazy" data-testid={testId}
        onClick={onClick} onKeyDown={onKeyDown}
        onLoad={event => settle(primaryPart, 'ready', event)} onError={event => settle(primaryPart, 'error', event)}
        style={{ ...imageStyle, ...(softenThumb ? {
          filter: 'blur(20px)', transform: 'scale(1.08)', transition: 'opacity var(--dur-normal, .3s)', opacity: fullVisible ? 0 : 1,
        } : undefined) }} {...rest} />
      {showFullLayer && <img key={`full:${state.attempt}`} src={src} alt="" aria-hidden="true"
        decoding="async" loading="lazy" onLoad={event => settle('full', 'ready', event, true)} onError={event => settle('full', 'error', event, true)}
        style={{ ...imageStyle, position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
          transition: 'opacity var(--dur-normal, .3s)', opacity: fullVisible ? 1 : 0, pointerEvents: 'none' }} />}
    </>}
  </span>;
}
