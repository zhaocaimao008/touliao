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

export function estimateHeight(item) {
  if (!item) return 80;
  if (item.type === 'divider') return 36;
  const { msg } = item;
  if (!msg) return 80;
  if (msg.deleted) return 48;
  // 拍一拍：仅渲染一行居中小字(无气泡/无引用)，独立返回精确高度，避免落到默认 82 高估留白。
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
  else base = 82;

  return base + replyAdd;
}
