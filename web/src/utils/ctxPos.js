// 长按菜单动态定位纯函数（无 DOM 依赖，便于单测）。
// 基于被长按消息 bubble 的视口坐标 + 菜单实测尺寸，计算最终位置：
//  · 下方空间足够 → 显示在气泡下方；不足 → 翻转到气泡上方
//  · 水平方向：优先左对齐气泡；右侧越界 → 向左收；左侧越界 → 向右收
//  · 顶部避开 Safe Area；底部避开输入框/TabBar（bottomReserve）
//  · 最终 clamp 在 viewport 内（永不越界）
export function computeCtxPos(anchor, menu, viewport, opts = {}) {
  const { safeTop = 0, safeBottom = 0, bottomReserve = 0, gap = 6, edge = 12 } = opts;
  const mw = menu.width, mh = menu.height;
  const vw = viewport.width, vh = viewport.height;
  const left = viewport.offsetLeft || 0, top = viewport.offsetTop || 0;
  if (!mw || !mh || !vw || !vh) return { x: anchor.left || 0, y: (anchor.bottom || 0) + gap };

  const below = anchor.bottom + gap;
  const above = anchor.top - gap - mh;
  const minY = top + safeTop + edge;
  const maxY = top + vh - safeBottom - bottomReserve;
  let y;
  if (below + mh <= maxY) y = below;                 // 下方足够
  else if (above >= minY) y = above;              // 翻转上方
  else y = below;
  // Anchors can be stale after scrolling, rotation or the soft keyboard opening.
  // Clamp both placement branches, not only the insufficient-space branch.
  y = Math.max(minY, Math.min(y, maxY - mh - edge));

  let x = anchor.left;                               // 水平：左对齐气泡
  x = Math.max(left + edge, Math.min(x, left + vw - mw - edge));

  return { x: Math.round(x), y: Math.round(y) };
}
