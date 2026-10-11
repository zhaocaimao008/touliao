import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, test, vi } from 'vitest';
import ImgOptimized from './ImgOptimized';

vi.mock('../utils/url', () => ({ getThumbUrl: src => src?.replace(/\.png$/, '_thumb.webp') }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
let renderer;
const callbacks = () => ({ onLoad: vi.fn(), onError: vi.fn(), onClick: vi.fn(), onKeyDown: vi.fn() });
const mount = (props = {}) => {
  const handlers = callbacks();
  act(() => { renderer = create(<ImgOptimized src="/uploads/a.png" data-testid="msg-image" role="button" tabIndex={0}
    aria-label="Open image" {...handlers} {...props} />); });
  return handlers;
};
const images = () => renderer.root.findAllByType('img');
const retryButton = () => renderer.root.findByType('button');
const event = { currentTarget: { naturalWidth: 800, naturalHeight: 1200 }, stopPropagation: vi.fn() };
const fire = (image, type) => act(() => image.props[type](event));
afterEach(() => { if (renderer) act(() => renderer.unmount()); renderer = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('mounted rows contain native lazy images even when an observer would never fire', () => {
  const observer = vi.fn(); vi.stubGlobal('IntersectionObserver', observer); mount();
  expect(observer).not.toHaveBeenCalled(); expect(images()).toHaveLength(2);
  expect(images().map(image => image.props.loading)).toEqual(['lazy', 'lazy']);
});
test('works without IntersectionObserver support', () => {
  vi.stubGlobal('IntersectionObserver', undefined); mount(); expect(images()[0].props.src).toBe('/uploads/a_thumb.webp');
});
test('the original covers the reserved aspect instead of overflowing at its natural size', () => {
  mount({ aspectStyle: { aspectRatio: '0.5', width: '160px' } });
  expect(images()[0].props.style).toMatchObject({ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', objectFit: 'cover' });
  expect(images()[1].props.style).toMatchObject({ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover' });
  expect(images()[1].props['aria-hidden']).toBe('true');
});
test('only the accessible primary owns click and keyboard actions', () => {
  const handlers = mount(); fire(images()[0], 'onClick'); fire(images()[0], 'onKeyDown');
  expect(handlers.onClick).toHaveBeenCalledTimes(1); expect(handlers.onKeyDown).toHaveBeenCalledTimes(1);
  expect(images()[0].props.role).toBe('button'); expect(images()[1].props.style.pointerEvents).toBe('none');
});
test('a missing thumbnail falls back to the original without declaring failure', () => {
  const handlers = mount(); fire(images()[0], 'onError');
  expect(images()).toHaveLength(1); expect(images()[0].props.src).toBe('/uploads/a.png');
  expect(handlers.onError).not.toHaveBeenCalled(); fire(images()[0], 'onLoad');
  expect(handlers.onLoad).toHaveBeenCalledWith(event); expect(renderer.root.findAllByType('button')).toHaveLength(0);
});
test('a late thumbnail error cannot discard an already loaded original', () => {
  mount(); fire(images()[1], 'onLoad'); fire(images()[0], 'onError');
  expect(images()).toHaveLength(1); expect(images()[0].props.src).toBe('/uploads/a.png');
  expect(images()[0].props.className).toContain('loaded');
});
test('original failure leaves a sharp usable thumbnail', () => {
  const handlers = mount(); fire(images()[0], 'onLoad'); fire(images()[1], 'onError');
  expect(images()).toHaveLength(1); expect(images()[0].props.src).toBe('/uploads/a_thumb.webp');
  expect(images()[0].props.style.filter).toBeUndefined(); expect(images()[0].props.style.opacity).toBeUndefined();
  expect(handlers.onError).not.toHaveBeenCalled();
});
test('original dimensions are reported even when it wins the race with the thumbnail', () => {
  const handlers = mount(); fire(images()[1], 'onLoad');
  expect(handlers.onLoad).toHaveBeenCalledWith(event); expect(images()[0].props.style.opacity).toBe(0);
});
test.each(['thumb-first', 'full-first'])('both failures expose a retry exactly once: %s', order => {
  const handlers = mount();
  if (order === 'full-first') { fire(images()[1], 'onError'); fire(images()[0], 'onError'); }
  else { fire(images()[0], 'onError'); fire(images()[0], 'onError'); }
  expect(images()).toHaveLength(0); expect(retryButton().props['aria-label']).toBe('authImage.loadFailedRetry');
  expect(handlers.onError).toHaveBeenCalledTimes(1);
});
test('batched layer failures also produce one terminal callback', () => {
  const handlers = mount(); const [thumb, full] = images();
  act(() => { full.props.onError(event); thumb.props.onError(event); });
  expect(handlers.onError).toHaveBeenCalledTimes(1); expect(retryButton()).toBeDefined();
});
test('an unmounted overlay cannot fail the replacement original image', () => {
  const handlers = mount(); const oldError = images()[1].props.onError;
  fire(images()[0], 'onError'); act(() => oldError(event));
  expect(images()).toHaveLength(1); expect(handlers.onError).not.toHaveBeenCalled();
  fire(images()[0], 'onLoad'); expect(handlers.onLoad).toHaveBeenCalledTimes(1);
});
test('retry remounts image elements and ignores late events from the previous attempt', () => {
  const handlers = mount(); const staleLoad = images()[1].props.onLoad;
  fire(images()[0], 'onError'); fire(images()[0], 'onError'); const oldRetry = retryButton().props.onClick;
  act(() => { oldRetry(event); oldRetry(event); });
  expect(images()).toHaveLength(2); expect(images()[0].props.className).not.toContain('loaded');
  act(() => staleLoad(event)); expect(handlers.onLoad).not.toHaveBeenCalled();
  fire(images()[1], 'onLoad'); expect(handlers.onLoad).toHaveBeenCalledTimes(1);
});
test('changing source resets failed state and ignores retired-source callbacks', () => {
  const handlers = mount(); const stale = images()[1].props.onLoad;
  fire(images()[0], 'onError'); fire(images()[0], 'onError');
  act(() => renderer.update(<ImgOptimized src="/uploads/b.png" {...handlers} />));
  expect(images()[0].props.src).toBe('/uploads/b_thumb.webp');
  act(() => stale(event)); expect(handlers.onLoad).not.toHaveBeenCalled();
});
test('unmount suppresses delayed completion callbacks', () => {
  const handlers = mount(); const stale = images()[1].props.onLoad;
  act(() => renderer.unmount()); renderer = null; act(() => stale(event)); expect(handlers.onLoad).not.toHaveBeenCalled();
});
test('single-source images do not create duplicate layers and can retry', () => {
  mount({ src: 'blob:local-preview' }); expect(images()).toHaveLength(1);
  fire(images()[0], 'onError'); expect(retryButton()).toBeDefined();
  act(() => retryButton().props.onClick(event)); expect(images()[0].props.src).toBe('blob:local-preview');
});
test('non-progressive mode fetches the original only if the thumbnail fails', () => {
  mount({ progressive: false }); expect(images()).toHaveLength(1);
  fire(images()[0], 'onError'); expect(images()[0].props.src).toBe('/uploads/a.png');
  fire(images()[0], 'onLoad'); expect(images()[0].props.className).toContain('loaded');
});
test('an initially unavailable media URL is replaced with a fresh loading state', () => {
  mount({ src: undefined }); expect(images()[0].props.src).toBeUndefined();
  act(() => renderer.update(<ImgOptimized src="/uploads/ready.png" />));
  expect(images()).toHaveLength(2); expect(images()[0].props.src).toBe('/uploads/ready_thumb.webp');
});
