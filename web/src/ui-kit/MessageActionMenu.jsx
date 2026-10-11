import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeCtxPos } from '../utils/ctxPos';

function revealItem(menu, item) {
  if (!item || !menu.contains(item)) return;
  if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop;
  else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight) {
    menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight;
  }
}

/** Layout and keyboard navigation only. Actions/authorization remain in ChatWindow. */
export default function MessageActionMenu({ anchor, onClose, returnFocusRef, children }) {
  const menuRef = useRef(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    const visual = window.visualViewport;
    let frame = null;
    const place = () => {
      const viewport = { width: visual?.width || window.innerWidth, height: visual?.height || window.innerHeight,
        offsetLeft: visual?.offsetLeft || 0, offsetTop: visual?.offsetTop || 0 };
      const reserve = Math.min(140, viewport.height * .25);
      el.style.maxHeight = `${Math.max(44, viewport.height - reserve - 40)}px`;
      el.style.maxWidth = `${Math.max(44, viewport.width - 24)}px`;
      const rect = anchor.element?.isConnected ? anchor.element.getBoundingClientRect() : anchor;
      const next = computeCtxPos(rect, { width: el.offsetWidth, height: el.offsetHeight }, viewport,
        { safeTop: 8, safeBottom: 8, bottomReserve: reserve, gap: 6, edge: 12 });
      next.origin = next.y < rect.top ? 'bottom center' : 'top center';
      setPos(previous => previous?.x === next.x && previous?.y === next.y && previous?.origin === next.origin ? previous : next);
      revealItem(el, document.activeElement);
    };
    const schedule = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => { frame = null; place(); });
    };
    place();
    window.addEventListener('resize', schedule);
    visual?.addEventListener('resize', schedule);
    visual?.addEventListener('scroll', schedule);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', schedule);
      visual?.removeEventListener('resize', schedule);
      visual?.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [anchor, children]);
  useEffect(() => {
    const menu = menuRef.current;
    const previous = document.activeElement;
    const fallback = returnFocusRef?.current;
    const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter(el => el.getAttribute('aria-disabled') !== 'true');
    const focus = target => {
      items().forEach(el => { el.tabIndex = el === target ? 0 : -1; });
      target?.focus({ preventScroll: true });
      revealItem(menu, target);
    };
    focus(items()[0]);
    const key = event => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); closeRef.current(); return;
      }
      const list = items();
      if (!list.length) return;
      const index = list.indexOf(document.activeElement);
      const target = { ArrowDown: (index + 1) % list.length, ArrowUp: (index - 1 + list.length) % list.length, Home: 0, End: list.length - 1 }[event.key];
      if (target !== undefined) { event.preventDefault(); event.stopPropagation(); focus(list[target]); }
    };
    menu.addEventListener('keydown', key);
    return () => {
      menu.removeEventListener('keydown', key);
      const target = previous !== document.body && previous?.isConnected ? previous : fallback;
      // Cleanup runs before a newly opened modal establishes its initial focus.
      target?.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);
  return createPortal(<>
    <div className="wc-ctx-overlay wc-ctx-overlay-fixed" aria-hidden="true" onClick={onClose} />
    <div ref={menuRef} role="menu" className="wc-ctx-menu wc-ctx-menu-fixed tl-message-menu"
      style={pos ? { left: pos.x, top: pos.y, transformOrigin: pos.origin } : { left: -9999, top: -9999 }}>{children}</div>
  </>, document.body);
}
