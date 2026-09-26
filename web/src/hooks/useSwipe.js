import { useRef, useState, useCallback } from 'react';

/**
 * useSwipe — 水平滑动手势检测（移动端左滑快捷操作）
 *
 * - 水平滑动距离 > 阈值（默认 30px）且水平位移主导（> 垂直位移 1.5 倍）时触发，
 *   避免与垂直滚动冲突
 * - 仅在触屏设备上启用（'ontouchstart' in window）
 * - 返回 { swipeOffset, swipeHandlers, resetSwipe }：
 *   swipeOffset 为当前横向偏移（px，左滑为负），swipeHandlers 绑定到目标元素
 */
export function useSwipe({ threshold = 30, maxOffset = 160, onSwipeLeft, onSwipeRight } = {}) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const startRef = useRef(null);
  const trackingRef = useRef(false);
  const rafRef = useRef(null);
  const pendingOffsetRef = useRef(0);
  const enabled = typeof window !== 'undefined' && 'ontouchstart' in window;

  const resetSwipe = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setSwipeOffset(0);
    trackingRef.current = false;
    startRef.current = null;
  }, []);

  const handleTouchStart = useCallback(e => {
    if (!enabled) return;
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
    trackingRef.current = true;
  }, [enabled]);

  // rAF 节流：touchmove 高频触发，只在下一帧提交一次 setState
  const flushOffset = useCallback(() => {
    rafRef.current = null;
    setSwipeOffset(pendingOffsetRef.current);
  }, []);

  const handleTouchMove = useCallback(e => {
    if (!enabled || !trackingRef.current || !startRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    // 垂直位移主导 → 视为滚动，不拦截
    if (Math.abs(dy) > Math.abs(dx) * 1.5) {
      trackingRef.current = false;
      return;
    }
    // 水平滑动：跟随手指（限制范围），阻止垂直滚动抢夺手势
    if (Math.abs(dx) > 10) {
      pendingOffsetRef.current = Math.max(-maxOffset, Math.min(maxOffset, dx));
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flushOffset);
      }
    }
  }, [enabled, maxOffset, flushOffset]);

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !trackingRef.current) return;
    trackingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const finalOffset = pendingOffsetRef.current;
    if (finalOffset <= -threshold) {
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

  const swipeHandlers = enabled
    ? {
        onTouchStart: handleTouchStart,
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd,
        onTouchCancel: resetSwipe,
      }
    : {};

  return { swipeOffset, swipeHandlers, resetSwipe, swipeEnabled: enabled };
}
