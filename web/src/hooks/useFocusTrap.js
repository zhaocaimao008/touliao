import { useEffect, useRef } from 'react';

/**
 * 弹窗焦点陷阱：把键盘焦点锁在弹窗容器内，避免 Tab 键跳到弹窗背后的页面。
 * - 挂载时把焦点移入容器（若容器内已有 autoFocus 元素则不抢）
 * - Tab / Shift+Tab 在首尾可聚焦元素间循环
 * - 卸载时把焦点还给打开弹窗前的元素
 *
 * 用法：const ref = useFocusTrap(active); <div ref={ref} role="dialog">…</div>
 * 传给最外层 overlay 容器即可（焦点循环基于该容器内的可聚焦元素）。
 */
export default function useFocusTrap(active = true) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const prevFocused = document.activeElement;

    const getFocusable = () => Array.from(
      container.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null || el === document.activeElement);

    // 若焦点还不在容器内，移入第一个可聚焦元素（不打断已有的 autoFocus）
    if (!container.contains(document.activeElement)) {
      const first = getFocusable()[0];
      if (first) setTimeout(() => first.focus(), 0);
    }

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // 还原焦点，帮助键盘用户回到触发弹窗的按钮
      if (prevFocused && typeof prevFocused.focus === 'function') {
        prevFocused.focus();
      }
    };
  }, [active]);

  return containerRef;
}
