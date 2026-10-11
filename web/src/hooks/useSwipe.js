import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * useSwipe — 水平滑动手势检测（移动端左滑快捷操作）
 *
 * - 水平滑动距离 > 阈值（默认 30px）且水平位移主导（> 垂直位移 1.5 倍）时触发，
 *   避免与垂直滚动冲突
 * - 仅在触屏设备上启用（'ontouchstart' in window）
 * - 返回 { swipeOffset, swipeHandlers, resetSwipe }：
 *   swipeOffset 为当前横向偏移（px，左滑为负），swipeHandlers 绑定到目标元素
 */
export function useSwipe({ threshold = 30, maxOffset = 160, onSwipeLeft, onSwipeRight, allowRight = true, disabled = false } = {}) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startRef = useRef(null);
  const trackingRef = useRef(false);
  const rafRef = useRef(null);
  const pendingOffsetRef = useRef(0);
  const suppressClickRef = useRef(0);
  const enabled = !disabled && typeof window !== 'undefined' && 'ontouchstart' in window;

  const resetSwipe = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setSwipeOffset(0);
    setIsSwiping(false);
    pendingOffsetRef.current = 0;
    trackingRef.current = false;
    startRef.current = null;
  }, []);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    // Selection mode ends any active gesture, including its queued animation.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Cancel the external touch/animation lifecycle when interaction is disabled.
    if (disabled) resetSwipe();
  }, [disabled, resetSwipe]);

  const handleTouchStart = useCallback(e => {
    if (!enabled) return;
    suppressClickRef.current = 0;
    if (e.touches.length !== 1) { resetSwipe(); return; }
    if (e.target?.closest?.('input,textarea,select,[contenteditable="true"],[role="slider"],audio,video,[data-swipe-action]')) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, origin: swipeOffset, dragging: false, dx: 0 };
    pendingOffsetRef.current = swipeOffset;
    trackingRef.current = true;
  }, [enabled, resetSwipe, swipeOffset]);

  // rAF 节流：touchmove 高频触发，只在下一帧提交一次 setState
  const flushOffset = useCallback(() => {
    rafRef.current = null;
    setSwipeOffset(pendingOffsetRef.current);
  }, []);

  const handleTouchMove = useCallback(e => {
    if (!enabled || !trackingRef.current || !startRef.current) return;
    if (e.touches.length !== 1) { resetSwipe(); return; }
    const t = e.touches[0];
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    const start = startRef.current;
    // Wait through small finger jitter. A diagonal/vertical start belongs to
    // scrolling and must never turn into a reply/delete gesture later.
    if ((!start.dragging && Math.abs(dy) > 10 && Math.abs(dx) <= Math.abs(dy) * 1.5) ||
        Math.abs(dy) > Math.max(10, Math.abs(dx) * 1.5)) {
      resetSwipe();
      return;
    }
    if (!start.dragging && (Math.abs(dx) <= 10 || Math.abs(dx) <= Math.abs(dy) * 1.5)) return;
    if (!start.dragging) { start.dragging = true; setIsSwiping(true); }
    start.dx = dx;
    if (start.dragging) {
      pendingOffsetRef.current = Math.max(-maxOffset, Math.min(allowRight ? maxOffset : 0, start.origin + dx));
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flushOffset);
      }
    }
  }, [enabled, maxOffset, allowRight, flushOffset, resetSwipe]);

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !trackingRef.current) return;
    trackingRef.current = false;
    setIsSwiping(false);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const finalOffset = pendingOffsetRef.current;
    const start = startRef.current;
    if (start?.dragging || start?.origin) suppressClickRef.current = Date.now() + 500;
    const closing = !start?.dragging || (start.origin < 0 && start.dx >= threshold) || (start.origin > 0 && start.dx <= -threshold);
    if (closing) {
      setSwipeOffset(0); pendingOffsetRef.current = 0;
    } else if (finalOffset <= -threshold) {
      // 左滑达阈值：吸附到最大偏移，显示快捷按钮
      setSwipeOffset(-maxOffset);
      onSwipeLeft?.();
    } else if (finalOffset >= threshold) {
      setSwipeOffset(maxOffset);
      onSwipeRight?.();
    } else {
      setSwipeOffset(0);
    }
    startRef.current = null;
  }, [enabled, threshold, maxOffset, onSwipeLeft, onSwipeRight]);

  const handleClickCapture = useCallback(event => {
    // Consume only the pointer click synthesized by this gesture, not keyboard
    // activation or a later deliberate tap on the revealed action.
    if (event.detail !== 0 && Date.now() < suppressClickRef.current) {
      suppressClickRef.current = 0;
      event.preventDefault(); event.stopPropagation();
    }
  }, []);

  const swipeHandlers = enabled
    ? {
        onTouchStart: handleTouchStart,
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd,
        onTouchCancel: resetSwipe,
        onClickCapture: handleClickCapture,
      }
    : {};

  return { swipeOffset, isSwiping, swipeHandlers, resetSwipe, swipeEnabled: enabled };
}
