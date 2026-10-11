import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { useSwipe } from './useSwipe';
const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', () => ({
  useState: initial => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], value => { hooks.slots[i] = value; }];
  },
  useRef: initial => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
    return hooks.slots[i];
  },
  useCallback: fn => fn,
  useEffect: effect => { hooks.effects.push(effect); },
}));
let frames;
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = [];
  frames = new Map(); let next = 0;
  vi.stubGlobal('window', { ontouchstart: null });
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { const id = next++; frames.set(id, callback); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(id => frames.delete(id)));
});
afterEach(() => vi.unstubAllGlobals());
const touch = (x, y, count = 1) => ({ touches: Array.from({ length: count }, () => ({ clientX: x, clientY: y })) });
// eslint-disable-next-line react-hooks/rules-of-hooks -- Controlled hook runner replaces React scheduling in this Node regression test.
const render = options => { hooks.cursor = 0; return useSwipe({ maxOffset: 72, allowRight: false, ...options }); };
const flush = () => { const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback()); };

test.each([false, true])('vertical scrolling clears a horizontal drag before/after animation flush (%s)', flushed => {
  const onSwipeLeft = vi.fn(); const options = { onSwipeLeft };
  const handlers = render(options).swipeHandlers;
  handlers.onTouchStart(touch(100, 100));
  handlers.onTouchMove(touch(60, 100));
  if (flushed) flush();
  handlers.onTouchMove(touch(60, 190));
  flush(); handlers.onTouchEnd();
  expect(render(options).swipeOffset).toBe(0);
  expect(onSwipeLeft).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});

test('a second finger cancels dragging and a later fresh gesture still opens reply', () => {
  const onSwipeLeft = vi.fn(); const handlers = render({ onSwipeLeft }).swipeHandlers;
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(45, 100));
  handlers.onTouchStart(touch(45, 100, 2)); flush(); handlers.onTouchEnd();
  expect(render().swipeOffset).toBe(0); expect(onSwipeLeft).not.toHaveBeenCalled();
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(45, 100)); handlers.onTouchEnd();
  expect(render().swipeOffset).toBe(-72); expect(onSwipeLeft).toHaveBeenCalledOnce();
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchEnd();
  expect(render().swipeOffset).toBe(0);
});

test('touch cancellation and unmount discard queued frame 0 as well as later frames', () => {
  const handlers = render().swipeHandlers;
  const cleanup = hooks.effects[0]();
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(50, 100));
  handlers.onTouchCancel();
  expect(cancelAnimationFrame).toHaveBeenCalledWith(0);
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(50, 100));
  cleanup(); expect(frames.size).toBe(0);
});

test('rightward drag never opens a left-only reply action', () => {
  const right = vi.fn(); const handlers = render({ onSwipeRight: right }).swipeHandlers;
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(180, 100)); handlers.onTouchEnd();
  expect(render().swipeOffset).toBe(0); expect(right).not.toHaveBeenCalled();
});

test('entering selection mode clears an open swipe instead of restoring it on exit', () => {
  const handlers = render().swipeHandlers;
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(50, 100)); handlers.onTouchEnd();
  expect(render().swipeOffset).toBe(-72);
  hooks.effects = [];
  expect(render({ disabled: true }).swipeHandlers).toEqual({});
  hooks.effects.at(-1)();
  expect(render().swipeOffset).toBe(0);
});

test('diagonal scrolling never reveals actions even if the finger later moves sideways', () => {
  const onSwipeLeft = vi.fn(); const handlers = render({ onSwipeLeft }).swipeHandlers;
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(60, 140));
  handlers.onTouchMove(touch(10, 145)); flush(); handlers.onTouchEnd();
  expect(render().swipeOffset).toBe(0); expect(onSwipeLeft).not.toHaveBeenCalled();
});

test('small vertical jitter does not cancel an intentional horizontal drag and tracking stops on release', () => {
  const handlers = render().swipeHandlers;
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(100, 104));
  handlers.onTouchMove(touch(45, 107)); flush();
  expect(render()).toMatchObject({ swipeOffset: -55, isSwiping: true });
  handlers.onTouchEnd(); expect(render()).toMatchObject({ swipeOffset: -72, isSwiping: false });
});

test('a drag consumes its synthetic click without blocking keyboard activation or the next deliberate tap', () => {
  const handlers = render().swipeHandlers;
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(45, 100)); handlers.onTouchEnd();
  const keyboard = { detail: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handlers.onClickCapture?.(keyboard); expect(keyboard.preventDefault).not.toHaveBeenCalled();
  const pointer = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handlers.onClickCapture?.(pointer); expect(pointer.preventDefault).toHaveBeenCalledOnce();
  const next = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handlers.onClickCapture?.(next); expect(next.preventDefault).not.toHaveBeenCalled();
});

test('an open row stays under the finger and swiping back closes it', () => {
  let handlers = render().swipeHandlers;
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(40, 100)); handlers.onTouchEnd();
  handlers = render().swipeHandlers;
  handlers.onTouchStart(touch(100, 100)); expect(render().swipeOffset).toBe(-72);
  handlers.onTouchMove(touch(140, 100)); flush(); expect(render().swipeOffset).toBe(-32);
  handlers.onTouchEnd(); expect(render().swipeOffset).toBe(0);
});

test('tapping an open row closes it without activating the content underneath', () => {
  let handlers = render().swipeHandlers;
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(40, 100)); handlers.onTouchEnd();
  handlers = render().swipeHandlers; handlers.onTouchStart(touch(100, 100)); handlers.onTouchEnd();
  const click = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handlers.onClickCapture?.(click);
  expect(render().swipeOffset).toBe(0); expect(click.preventDefault).toHaveBeenCalledOnce();
});

test('text fields and native media controls retain their own gestures', () => {
  const handlers = render().swipeHandlers;
  handlers.onTouchStart({ ...touch(100, 100), target: { closest: () => ({ tagName: 'INPUT' }) } });
  handlers.onTouchMove(touch(40, 100)); handlers.onTouchEnd();
  expect(render().swipeOffset).toBe(0);
});

test('a deliberate tap on the revealed action reaches its click handler', () => {
  let handlers = render().swipeHandlers;
  handlers.onTouchStart(touch(100, 100)); handlers.onTouchMove(touch(40, 100)); handlers.onTouchEnd();
  handlers = render().swipeHandlers;
  handlers.onTouchStart({ ...touch(280, 100), target: { closest: selector => selector.includes('[data-swipe-action]') ? {} : null } });
  handlers.onTouchEnd();
  const click = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handlers.onClickCapture(click);
  expect(render().swipeOffset).toBe(-72);
  expect(click.preventDefault).not.toHaveBeenCalled();
});
