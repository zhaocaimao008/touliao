import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeCtxPos } from '../utils/ctxPos';

/** Layout and keyboard navigation only. Actions/authorization remain in ChatWindow. */
export default function MessageActionMenu({ anchor, onClose, returnFocusRef, children }) {
  const menuRef = useRef(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    const place = () => setPos(computeCtxPos(anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { safeTop: 8, safeBottom: 8, bottomReserve: 140, gap: 6, edge: 12 }));
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, children]);
  useEffect(() => {
    const menu = menuRef.current;
    const previous = document.activeElement;
    const fallback = returnFocusRef?.current;
    const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter(el => el.getAttribute('aria-disabled') !== 'true');
    const focus = target => { items().forEach(el => { el.tabIndex = el === target ? 0 : -1; }); target?.focus({ preventScroll: true }); };
    focus(items()[0]);
    const key = event => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); closeRef.current(); return;
      }
      const list = items();
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
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}>{children}</div>
  </>, document.body);
}
