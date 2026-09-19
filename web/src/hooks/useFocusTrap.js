import { useEffect, useLayoutEffect, useRef } from 'react';

// Only the innermost/topmost layer handles focus and Escape, including media
// previews opened over drawers. Presentation only; no page actions live here.
const layers = [];
let scrollLocks = 0;
let previousOverflow = '';
const topLayer = () => layers.reduce((top, layer) =>
  top && layer.container.contains(top.container) ? top : layer, null);
export function isTopFocusLayer(container) { return topLayer()?.container === container; }

export default function useFocusTrap(active = true, options = {}) {
  const containerRef = useRef(null);
  const optionsRef = useRef(options);
  useLayoutEffect(() => { optionsRef.current = options; });
  const lockScroll = !!options.lockScroll;
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    const previous = document.activeElement;
    const layer = { container };
    layers.push(layer);
    if (lockScroll && scrollLocks++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const focusable = () => [...container.querySelectorAll(
      'a[href], button, textarea, input, select, video[controls], audio[controls], [tabindex]'
    )].filter(el => el.tabIndex >= 0 && !el.disabled && !el.closest('[inert]') &&
      el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const enter = () => {
      const preferred = optionsRef.current.initialFocus;
      const target = typeof preferred === 'string' ? container.querySelector(preferred) : preferred?.current;
      (target || focusable()[0] || container).focus({ preventScroll: true });
    };
    const timer = setTimeout(() => {
      if (isTopFocusLayer(container) && !container.contains(document.activeElement)) enter();
    }, 0);
    const onFocus = (event) => {
      if (isTopFocusLayer(container) && !container.contains(event.target)) enter();
    };
    const onKey = (event) => {
      if (!isTopFocusLayer(container)) return;
      if (event.key === 'Escape' && optionsRef.current.onEscape) {
        event.preventDefault();
        event.stopImmediatePropagation();
        optionsRef.current.onEscape();
      } else if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!items.length || !container.contains(document.activeElement) ||
            (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
          if (!items.length) container.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
      layers.splice(layers.indexOf(layer), 1);
      if (lockScroll && --scrollLocks === 0) document.body.style.overflow = previousOverflow;
      const top = topLayer();
      if (previous?.isConnected && (!top || top.container.contains(previous))) previous.focus({ preventScroll: true });
    };
  }, [active, lockScroll]);
  return containerRef;
}
