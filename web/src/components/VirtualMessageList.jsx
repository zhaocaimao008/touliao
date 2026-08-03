import React, { useRef, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import { VariableSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import MessageItem, { TimeDivider } from './MessageItem';
import { estimateHeight } from './estimateHeight';

// 批量行高刷新调度器：多行(图片/表情/回复缩略图)异步测量会各自触发 resetAfterIndex，
// 每次都强制列表从该行起全量重排。多行同帧完成时 = 几十次连锁重排 → 持续抖动(三端共用此列表)。
// 这里把同一帧内所有行的高度变更合并成一次 resetAfterIndex(取最小受影响 index)，一帧只重排一次。
function createSizeFlusher(listRef, onSettle) {
  let raf = 0;
  let minIndex = Infinity;
  const flush = () => {
    raf = 0;
    const idx = minIndex;
    minIndex = Infinity;
    if (idx !== Infinity) {
      listRef.current?.resetAfterIndex(idx, true);
      // 行高被修正后通知外层：若处于贴底态，外层据此贴一次底(事件驱动，取代每帧盲滚循环)。
      onSettle?.current?.();
    }
  };
  return {
    schedule(index) {
      if (index < minIndex) minIndex = index;
      if (!raf) raf = requestAnimationFrame(flush);
    },
    cancel() { if (raf) { cancelAnimationFrame(raf); raf = 0; } minIndex = Infinity; },
  };
}


// Row is module-level so it's stable (not recreated each render)
const Row = memo(function Row({ index, style, data }) {
  const { items, cbRef, sizeMapRef, sizeFlusher } = data;
  const item = items[index];
  const rowInnerRef = useRef(null);

  // Measure actual height and update size cache
  const updateSize = useCallback(() => {
    const el = rowInnerRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h > 0 && sizeMapRef.current[index] !== h) {
      sizeMapRef.current[index] = h;
      // 经批量调度器合并到下一帧统一 resetAfterIndex(idx,true)——多行同帧异步测量只重排一次，
      // 而非每行各自强制全量重排(旧行为=连锁重排=持续抖动)。shouldForceUpdate 仍为 true，
      // 保证 scrollHeight 与真实内容同步，贴底循环的高度稳定判断依然有效。
      sizeFlusher?.schedule(index);
    }
  }, [index, sizeMapRef, sizeFlusher]);

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
          : <MessageItem item={item} cbRef={cbRef} measure={updateSize} />
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
  { items, cbRef, outerRef, onHeightSettle },
  ref
) {
  const listRef = useRef(null);
  const sizeMapRef = useRef({});
  // onHeightSettle 用 ref 承接,避免父组件每次传新函数导致 flusher 重建
  const onSettleRef = useRef(onHeightSettle);
  onSettleRef.current = onHeightSettle;
  const sizeFlusherRef = useRef(null);
  if (!sizeFlusherRef.current) sizeFlusherRef.current = createSizeFlusher(listRef, onSettleRef);

  // When items array length changes (prepend/append), reset indices that shifted
  const prevItemsRef = useRef(items);
  if (prevItemsRef.current !== items) {
    // items 变化会重排索引，取消基于旧索引的挂起行高刷新，避免作用到错位的新列表。
    sizeFlusherRef.current.cancel();
    const prevLen = prevItemsRef.current.length;
    const curLen = items.length;
    // 整批替换(如切换会话):首尾 item 都对不上 → 旧高度缓存全失效,清空避免错位行高
    const sameEnds = curLen > 0 && prevLen > 0
      && items[0] === prevItemsRef.current[0]
      && items[curLen - 1] === prevItemsRef.current[prevLen - 1];
    if (curLen === prevLen && !sameEnds) {
      sizeMapRef.current = {};
      listRef.current?.resetAfterIndex(0, false);
    } else if (curLen !== prevLen) {
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
      } else if (items[0] !== prevItemsRef.current[0]) {
        // 首个 item 变了但非「前插」→ 整批替换(切到消息数不同的会话),清空旧缓存
        sizeMapRef.current = {};
        listRef.current?.resetAfterIndex(0, false);
      } else {
        // 纯追加(尾部新增),首个 item 不变,已有缓存仍有效,不动
      }
    }
    prevItemsRef.current = items;
  }

  const getItemSize = useCallback((index) => {
    return sizeMapRef.current[index] ?? estimateHeight(items[index]);
  }, [items]);

  // 卸载时取消挂起的行高刷新，防止 rAF 在组件销毁后回调到失效的 listRef
  React.useEffect(() => {
    const flusher = sizeFlusherRef.current;
    return () => flusher?.cancel();
  }, []);

  // 稳定行 key：默认 react-window 用 index 作 key，乐观消息被服务端 ack 替换时该行 item
  // 引用变化会触发按 index 复用的行重新挂载 → 最新一条闪烁。改用 item.key（上游 flatItems
  // 已用 _tempId/client_msg_id 作稳定 key），ack 前后同一 key → 复用同一 DOM 行 → 不闪。
  const itemKey = useCallback((index) => {
    const it = items[index];
    return it?.key ?? index;
  }, [items]);

  // Stable itemData to minimize Row re-renders
  const itemData = React.useMemo(() => ({
    items,
    cbRef,
    sizeMapRef,
    listRef,
    sizeFlusher: sizeFlusherRef.current,
  }), [items, cbRef]);

  // Expose imperative API to parent (ChatWindow)
  useImperativeHandle(ref, () => ({
    scrollToBottom(behavior) {
      const o = outerRef?.current;
      if (!o) return;
      // 平滑滚动：点「回到底部」按钮时给出顺滑动效(此前忽略 behavior 参数,总是硬跳)
      if (behavior === 'smooth') {
        o.scrollTo({ top: o.scrollHeight, behavior: 'smooth' });
        // 平滑动画期间行高可能仍在异步测量,末尾补一帧硬贴底,确保真正到底
        setTimeout(() => { const e = outerRef?.current; if (e) e.scrollTop = e.scrollHeight; }, 320);
        return;
      }
      // 默认：多帧 sticky 贴底，兼容行高异步测量（react-window + ResizeObserver）
      let n = 0;
      const step = () => {
        const e = outerRef?.current;
        if (!e) return;
        e.scrollTop = e.scrollHeight;
        if (++n < 10) requestAnimationFrame(step);
      };
      step();
    },
    scrollToItem(index, align = 'auto') {
      listRef.current?.scrollToItem(index, align);
    },
    // 把最后一项纳入渲染窗口并对齐到底部。变高行未测量时裸 scrollTop=scrollHeight
    // 会滚不到真正底部→末条(如刚发的乐观消息)被虚拟化掉、DOM 不挂载。
    // 由调用方每帧调用配合像素级贴底,覆盖末行异步测量导致的高度变化。
    scrollToLast() {
      const last = items.length - 1;
      if (last >= 0) listRef.current?.scrollToItem(last, 'end');
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
            itemKey={itemKey}
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
