// ================================================================
// estimateHeight.js — react-window 变高列表的「首帧行高估算」纯函数
// ----------------------------------------------------------------
// 独立成纯模块(不依赖 DOM/window)：既能被 VirtualMessageList 使用，也能被
// vitest(node 环境)直接单测——避免从组件导入牵连 utils/config 等触碰 window 的链路。
//
// 关键约束：估算必须并入「引用预览」的高度。react-window 为每行预留「绝对定位固定
// 高度」，若估算漏掉引用块，带引用的行被预留得过矮 → 下一行按错误偏移落进本行引用区
// (即「文字渲染进回复图片消息」)。异步 ResizeObserver 事后修正在 Electron/WebView
// 下有一帧竞态且不稳定——多次只改引用块 CSS/重测时机的修复因此复发。此处从首帧源头
// 并入引用高度，杜绝偏移，不再依赖异步修正。
//   图片/表情引用：名字(~16)+缩略图 34+上下 margin/padding(~10) ≈ 58
//   文本/其他引用：名字(~16)+单行文本(~18)+padding/margin(~12)  ≈ 44
// ================================================================
export const REPLY_MEDIA_HEIGHT = 58;
export const REPLY_TEXT_HEIGHT = 44;

// ── 文本行高常量（与 ChatWindow.css 实测对齐）───────────────────────
//   .wc-msg-row     padding-top: 13px（consecutive 连续消息为 3px）
//   .wc-msg-bubble  padding: 11px 15px → 上下共 22px
//   .wc-msg-bubble  line-height: --lh-body(1.6) × --text-base(14px) ≈ 22px/行
// 单行文本行高 = 13 + 22 + 22 ≈ 57px。此前对所有文本一律返回 82（≈2 行）：
//   · 单行短消息(最常见)被高估 ~25px → 发送时乐观气泡先按 82 贴底，ResizeObserver
//     测出真实 57 后列表收缩 25px、贴底循环再补一次 → 最新一条上跳 = 发消息「轻微抖动」。
//   · 3 行以上长文本反被低估(82<真实) → 下一行落进本行 = 一帧重叠。
// 改为按内容估算行数，短消息首帧即命中真实高度(消除抖动)，长消息不再低估(消除重叠)。
const TEXT_ROW_PAD = 13;
const TEXT_ROW_PAD_CONSECUTIVE = 3;
const TEXT_BUBBLE_VPAD = 22;
const TEXT_LINE_HEIGHT = 22;
// 每行可容纳的「列数」(CJK/全角计 2 列，其余计 1 列)。偏保守(按较窄气泡取值)，
// 宁可对长消息略高估(仅轻微收缩，无重叠)也不低估(会重叠)；短消息稳定判为 1 行。
const TEXT_COLS_PER_LINE = 26;

function estimateTextLines(content) {
  const text = typeof content === 'string' ? content : '';
  if (!text) return 1;
  // 各「显式换行」行分别按列宽换行后求和：CJK/全角计 2 列、其余计 1 列。
  // 发送路径已把换行折叠成空格（见 ChatWindow.sendMessage），故乐观气泡恒为 1 段；
  // 历史多行消息(含 \n)按真实段数累加，避免整体低估导致下一行落进本行。
  return text.split('\n').reduce((sum, line) => {
    let cols = 0;
    for (const ch of line) cols += (ch.codePointAt(0) >= 0x2e80 ? 2 : 1);
    return sum + Math.max(1, Math.ceil(cols / TEXT_COLS_PER_LINE));
  }, 0);
}

export function estimateHeight(item) {
  if (!item) return 80;
  if (item.type === 'divider') return 36;
  const { msg } = item;
  if (!msg) return 80;
  if (msg.deleted) return 48;
  // 拍一拍：仅渲染一行居中小字(无气泡/无引用)，独立返回精确高度，避免落到默认高估留白。
  if (msg.type === 'nudge') return 40;

  let replyAdd = 0;
  if (msg.replyTo) {
    const rt = msg.replyTo;
    // 引用目标是图片/表情且未撤回 → 渲染 34px 缩略图；否则渲染单行文本占位。
    replyAdd = (!rt.deleted && (rt.type === 'image' || rt.type === 'sticker') && rt.file_url)
      ? REPLY_MEDIA_HEIGHT
      : REPLY_TEXT_HEIGHT;
  }

  let base;
  if (msg.type === 'image') base = 260;
  else if (msg.type === 'voice') base = 72;
  else if (msg.type === 'file') base = 88;
  else if (msg.type === 'video') base = 220;
  else if (msg.type === 'red_packet') base = 130;
  else if (msg.type === 'contact_card') base = 100;
  else if (msg.type === 'sticker') base = 140;
  else {
    // 文本(及未知类型兜底)：按内容行数精确估算，首帧即贴近真实高度 → 发送不抖、长文不叠。
    const rowPad = item.consecutive ? TEXT_ROW_PAD_CONSECUTIVE : TEXT_ROW_PAD;
    base = rowPad + TEXT_BUBBLE_VPAD + estimateTextLines(msg.content) * TEXT_LINE_HEIGHT;
  }

  return base + replyAdd;
}
