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
