import React from 'react';
import { linkify } from './linkify';

// ================================================================
// richText.jsx — 消息富文本渲染：URL 链接 + @提及高亮
// ----------------------------------------------------------------
// 在 linkify 的基础上叠加 @username 高亮：
// - @xxx 片段用 --color-primary 着色加粗（与 MentionList 的绿色高亮语义一致，
//   此处跟随品牌色以适配深浅色主题）
// - @所有人 同样高亮
// - 与 URL 识别共存：URL 内的 @ 不误判（先按 URL 切分，再对纯文本段做 @ 切分）
// ================================================================

const MENTION_RE = /(@[^\s,，。！？；、）】》」』@]+)/g;

/**
 * 渲染富文本：返回 React 节点数组
 * @param {string} text 原始消息文本
 * @param {object} opts { highlightMe: boolean, myUsername: string } —
 *   highlightMe 为 true 时，若文本 @ 了自己（@username / @所有人），
 *   自己的那处提及用 .wc-msg-mention-me  stronger 样式
 */
export function renderRichText(text, opts = {}) {
  const { myUsername } = opts;
  const s = String(text ?? '');
  if (!s) return s;

  // 先用 linkify 切出 URL（linkify 返回混合数组：string | <a>）
  const linkified = linkify(s);
  const nodes = Array.isArray(linkified) ? linkified : [linkified];

  return nodes.map((node, idx) => {
    // <a> 链接节点：内部不再做 @ 切分
    if (React.isValidElement(node)) return <React.Fragment key={`r${idx}`}>{node}</React.Fragment>;
    // 纯文本：做 @ 高亮
    const parts = String(node).split(MENTION_RE);
    return (
      <React.Fragment key={`r${idx}`}>
        {parts.map((p, i) => {
          if (!p.startsWith('@') || p.length <= 1) return <React.Fragment key={`t${i}`}>{p}</React.Fragment>;
          const isMe = myUsername && (p === `@${myUsername}` || p === '@所有人');
          return (
            <span key={`m${i}`} className={isMe ? 'wc-msg-mention-me' : 'wc-msg-mention'}>
              {p}
            </span>
          );
        })}
      </React.Fragment>
    );
  });
}

/** 检测文本是否 @ 了指定用户（用于消息气泡的"有人@我"提醒样式） */
export function mentionsUser(text, username) {
  if (!text || !username) return false;
  const s = String(text);
  return s.includes(`@${username}`) || s.includes('@所有人');
}
