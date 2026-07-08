// ================================================================
// imgDimCache.js — 消息图片尺寸缓存（消除加载时的布局抖动 / CLS）
// ----------------------------------------------------------------
// 问题：图片 <img> 未预留高度，加载完成瞬间从占位小方块撑开到真实尺寸，
//       导致消息列表跳动——尤其看历史时滚动位置被顶飞，体验很差。
// 方案：图片首次解码后记下其宽高比(w/h)，按 url 缓存到内存 + localStorage。
//       再次渲染同一图片(滚回/重开会话)时，直接用缓存宽高比给占位框预留
//       正确高度，做到零抖动。首刷只抖一次，后续像素稳定（历史浏览为高频场景）。
//
// 只存宽高比（浮点），极其轻量；上限 500 条，超出按插入序淘汰最旧。
// ================================================================

const LS_KEY = 'imgDimCache_v1';
const MAX = 500;

/** url → aspectRatio(w/h)。内存缓存，进程内 O(1) 命中。 */
let mem = null;

function load() {
  if (mem) return mem;
  mem = new Map();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      for (const k of Object.keys(obj)) {
        const v = Number(obj[k]);
        if (v > 0 && isFinite(v)) mem.set(k, v);
      }
    }
  } catch {
    /* 解析失败：忽略，从空缓存开始 */
  }
  return mem;
}

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  // 合并写：解码事件可能短时间大量触发，攒一拍再落盘，避免频繁 JSON.stringify
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      const m = load();
      // 超限：保留最近 MAX 条（Map 迭代序即插入序）
      let entries = [...m.entries()];
      if (entries.length > MAX) entries = entries.slice(entries.length - MAX);
      localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      /* localStorage 满/隐私模式：静默降级 */
    }
  }, 400);
}

/** 取某图片的宽高比；未知返回 null */
export function getAspect(url) {
  if (!url) return null;
  return load().get(url) ?? null;
}

/** 记录某图片的宽高比（w/h），从已解码的 <img> 读取 naturalWidth/Height */
export function rememberAspect(url, naturalWidth, naturalHeight) {
  if (!url || !naturalWidth || !naturalHeight) return;
  const ratio = naturalWidth / naturalHeight;
  if (!(ratio > 0) || !isFinite(ratio)) return;
  const m = load();
  const prev = m.get(url);
  // 已是相同值就不重复触发落盘
  if (prev && Math.abs(prev - ratio) < 0.001) return;
  m.delete(url); // 重新插入到末尾，维持"最近使用"顺序，配合淘汰
  m.set(url, ratio);
  scheduleFlush();
}
