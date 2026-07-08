import React, { useRef, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import { VariableSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import MessageItem, { TimeDivider } from './MessageItem';

// Height estimates per item type
function estimateHeight(item) {
  if (!item) return 80;
  if (item.type === 'divider') return 36;
  const { msg } = item;
  if (!msg) return 80;
  if (msg.deleted) return 48;
  if (msg.type === 'image') return 260;
  if (msg.type === 'voice') return 72;
  if (msg.type === 'file') return 88;
  if (msg.type === 'video') return 220;
  if (msg.type === 'red_packet') return 130;
  if (msg.type === 'contact_card') return 100;
  if (msg.type === 'sticker') return 140;
  return 82;
}

// Row is module-level so it's stable (not recreated each render)
const Row = memo(function Row({ index, style, data }) {
  const { items, cbRef, sizeMapRef, listRef } = data;
  const item = items[index];
  const rowInnerRef = useRef(null);

  // Measure actual height and update size cache
  const updateSize = useCallback(() => {
    const el = rowInnerRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h > 0 && sizeMapRef.current[index] !== h) {
      sizeMapRef.current[index] = h;
      listRef.current?.resetAfterIndex(index, false);
    }
  }, [index, sizeMapRef, listRef]);

  // Observe height changes (images loading, content expanding)
  React.useEffect(() => {
    const el = rowInnerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(updateSize);
    obs.observe(el);
    updateSize();
    return () => obs.disconnect();
  }, [updateSize]);

  return (
    <div style={style}>
      <div ref={rowInnerRef} style={{ paddingLeft: 20, paddingRight: 20 }}>
        {item.type === 'divider'
          ? <TimeDivider time={item.time} />
          : <MessageItem item={item} cbRef={cbRef} />
        }
      </div>
    </div>
  );
}, (prev, next) => {
  // Only re-render if this specific item data changed or position changed
  return prev.data.items[prev.index] === next.data.items[next.index]
    && prev.style.top === next.style.top
    && prev.style.height === next.style.height;
});

const VirtualMessageList = forwardRef(function VirtualMessageList(
  { items, cbRef, outerRef },
  ref
) {
  const listRef = useRef(null);
  const sizeMapRef = useRef({});

  // When items array length changes (prepend/append), reset indices that shifted
  const prevItemsRef = useRef(items);
  if (prevItemsRef.current !== items) {
    const prevLen = prevItemsRef.current.length;
    const curLen = items.length;
    if (curLen !== prevLen) {
      // On prepend: all indices shifted; clear cache to avoid wrong heights
      if (curLen > prevLen && items[curLen - 1] === prevItemsRef.current[prevLen - 1]) {
        // Last item is same → items were prepended
        const diff = curLen - prevLen;
        const newMap = {};
        Object.keys(sizeMapRef.current).forEach(k => {
          newMap[Number(k) + diff] = sizeMapRef.current[k];
        });
        sizeMapRef.current = newMap;
        listRef.current?.resetAfterIndex(0, false);
      } else {
        // Append or full reset: only new items added at end, existing cache valid
        // Don't reset existing indices
      }
    }
    prevItemsRef.current = items;
  }

  const getItemSize = useCallback((index) => {
    return sizeMapRef.current[index] ?? estimateHeight(items[index]);
  }, [items]);

  // Stable itemData to minimize Row re-renders
  const itemData = React.useMemo(() => ({
    items,
    cbRef,
    sizeMapRef,
    listRef,
  }), [items, cbRef]);

  // Expose imperative API to parent (ChatWindow)
  useImperativeHandle(ref, () => ({
    scrollToBottom() {
      // 多帧 sticky 贴底，兼容行高异步测量（react-window + ResizeObserver）
      let n = 0;
      const step = () => {
        const o = outerRef?.current;
        if (!o) return;
        o.scrollTop = o.scrollHeight;
        if (++n < 10) requestAnimationFrame(step);
      };
      step();
    },
    scrollToItem(index, align = 'auto') {
      listRef.current?.scrollToItem(index, align);
    },
    resetAfterIndex(index) {
      delete sizeMapRef.current[index];
      listRef.current?.resetAfterIndex(index, false);
    },
  }));

  return (
    <AutoSizer>
      {({ height, width }) => (
        (!height || !width) ? null : (
          <VariableSizeList
            ref={listRef}
            outerRef={outerRef}
            className="cw-msg-scroll"
            height={height}
            width={width}
            itemCount={items.length}
            itemSize={getItemSize}
            estimatedItemSize={82}
            itemData={itemData}
            overscanCount={8}
            style={{ overflowX: 'hidden', background: 'var(--bg-messages)' }}
          >
            {Row}
          </VariableSizeList>
        )
      )}
    </AutoSizer>
  );
});

// memo 包裹：ChatWindow 因输入框打字/正在输入/上传进度等状态频繁重渲染，
// 但传入本组件的 props（items 已 useMemo、cbRef/outerRef/ref 均为稳定 ref）在这些
// 场景下引用不变。memo 后这类无关重渲染会被跳过，避免 AutoSizer/列表 wrapper 重跑。
export default memo(VirtualMessageList);
