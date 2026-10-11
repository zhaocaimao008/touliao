import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import MessageActionMenu from './MessageActionMenu';
vi.mock('react-dom', () => ({ createPortal: children => children }));
let view, menu, items, events, winEvents, viewportEvents, frames, previous;
beforeEach(() => {
  events = new Map(); winEvents = new Map(); viewportEvents = new Map(); frames = new Map();
  const target = map => ({ addEventListener: (name, cb) => map.set(name, cb), removeEventListener: name => map.delete(name) });
  vi.stubGlobal('window', { ...target(winEvents), innerWidth: 390, innerHeight: 844,
    visualViewport: { ...target(viewportEvents), width: 390, height: 844, offsetTop: 0, offsetLeft: 0 } });
  previous = { isConnected: true, focus: vi.fn() };
  vi.stubGlobal('document', { body: {}, activeElement: previous });
  vi.stubGlobal('requestAnimationFrame', cb => { const id = frames.size; frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  items = Array.from({ length: 10 }, (_, i) => ({ offsetTop: i * 48 + 4, offsetHeight: 48,
    getAttribute: () => null, focus() { document.activeElement = this; } }));
  menu = { ...target(events), style: {}, scrollTop: 0, clientHeight: 180,
    get offsetWidth() { return Math.min(260, parseFloat(this.style.maxWidth) || 260); },
    get offsetHeight() { return Math.min(500, parseFloat(this.style.maxHeight) || 500); },
    querySelectorAll: () => items, contains: item => items.includes(item) };
});
afterEach(() => { if (view) act(() => view.unmount()); view = null; vi.unstubAllGlobals(); });
function mount(onClose = vi.fn()) {
  act(() => { view = create(<MessageActionMenu anchor={{ top: 700, bottom: 740, left: 320 }} onClose={onClose}><div role="menuitem">Example</div></MessageActionMenu>,
    { createNodeMock: element => element.props.role === 'menu' ? menu : null }); });
}
function key(value) { act(() => events.get('keydown')({ key: value, preventDefault: vi.fn(), stopPropagation: vi.fn() })); }

test('End and Home move the menu scroll position so the focused action stays visible', () => {
  mount(); key('End');
  expect(document.activeElement).toBe(items[9]);
  expect(menu.scrollTop).toBeGreaterThan(0);
  expect(items[9].offsetTop + 48).toBeLessThanOrEqual(menu.scrollTop + menu.clientHeight);
  key('Home'); expect(document.activeElement).toBe(items[0]);
  expect(menu.scrollTop).toBeLessThanOrEqual(items[0].offsetTop);
});

test('arrow navigation skips disabled items, wraps, and Escape restores the previous focus on close', () => {
  items[1].getAttribute = () => 'true'; const close = vi.fn(); mount(close);
  key('ArrowDown'); expect(document.activeElement).toBe(items[2]);
  key('Home'); key('ArrowUp'); expect(document.activeElement).toBe(items[9]);
  key('Escape'); expect(close).toHaveBeenCalledOnce();
  act(() => view.unmount()); view = null; expect(previous.focus).toHaveBeenCalledOnce();
});

test('visual viewport changes recalculate size and coordinates and unsubscribe on close', () => {
  mount(); Object.assign(window.visualViewport, { width: 320, height: 360, offsetTop: 150, offsetLeft: 20 });
  act(() => {
    viewportEvents.get('resize')?.();
    [...frames.values()].forEach(cb => cb()); frames.clear();
  });
  const style = view.root.findByProps({ role: 'menu' }).props.style;
  expect(style.top).toBeGreaterThanOrEqual(170);
  expect(style.top + menu.offsetHeight).toBeLessThanOrEqual(150 + 360 - 90);
  expect(style.left).toBeGreaterThanOrEqual(32);
  expect(style.left + menu.offsetWidth).toBeLessThanOrEqual(340);
  act(() => view.unmount()); view = null;
  expect(viewportEvents.size).toBe(0); expect(winEvents.size).toBe(0);
});
