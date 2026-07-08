// ================================================================
// linkify.jsx — 把纯文本里的 URL 转成可点击链接（安全、零依赖）
// ----------------------------------------------------------------
// 仅识别 http(s):// 与 www. 开头的链接，其余文本原样输出（React 自动转义，无 XSS）。
// 链接以新标签打开并带 rel="noopener noreferrer nofollow"，防止 tab-nabbing 与权重传递。
// 用于消息气泡：让"发个网址"能直接点开，对齐主流 IM。
// ================================================================
import React from 'react';

// 粗匹配 URL：http(s):// 或 www. 起头，到空白/中日韩标点前结束
const URL_RE = /((?:https?:\/\/|www\.)[^\s，。！？；、）】》」』]+)/gi;

// 去掉 URL 末尾常见的成对/句末标点，避免把 "）" "." 等吞进链接
function trimTrailing(url) {
  const m = url.match(/[).,;:!?'"]+$/);
  return m ? url.slice(0, url.length - m[0].length) : url;
}

/** 把文本渲染为「文本 + <a> 链接」的 React 片段数组 */
export function linkify(text) {
  const s = String(text ?? '');
  if (!s) return s;
  const out = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s)) !== null) {
    const raw = m[0];
    const clean = trimTrailing(raw);
    const start = m.index;
    if (start > last) out.push(s.slice(last, start));
    const href = clean.startsWith('http') ? clean : `https://${clean}`;
    out.push(
      <a key={start} href={href} target="_blank" rel="noopener noreferrer nofollow"
        className="wc-msg-link" onClick={e => e.stopPropagation()}>{clean}</a>
    );
    // 把被 trim 掉的尾部标点补回为普通文本
    if (clean.length < raw.length) out.push(raw.slice(clean.length));
    last = start + raw.length;
  }
  if (out.length === 0) return s;
  if (last < s.length) out.push(s.slice(last));
  return out;
}
