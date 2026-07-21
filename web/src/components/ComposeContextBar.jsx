import React, { memo } from 'react';

/* ── 输入区上方的上下文条（从 ChatWindow 抽离）─────────────────────
   编辑模式指示条 与 回复引用条 二选一（编辑优先）。纯展示子组件：
   只读 editingMsg / replyTo，取消动作经回调上抛父级。memo 化后，父组件
   因打字/来消息等高频重渲染时，只要这些 props 未变本条不重渲染。 */
function replyPreview(type, content) {
  switch (type) {
    case 'image': return '[图片]';
    case 'voice': return '[语音]';
    case 'video': return '[视频]';
    case 'red_packet': return '[红包]';
    case 'file': return '[文件]';
    default: return content;
  }
}

function ComposeContextBar({ editingMsg, replyTo, onCancelEdit, onCancelReply }) {
  if (editingMsg) {
    return (
      <div className="wc-edit-bar">
        <div className="wc-edit-bar-body">
          <div className="wc-edit-bar-label">编辑消息</div>
          <div className="wc-edit-bar-text">{editingMsg.content}</div>
        </div>
        <button className="wc-edit-cancel-btn" onClick={onCancelEdit} aria-label="取消编辑">✕</button>
      </div>
    );
  }
  if (replyTo) {
    return (
      <div className="wc-reply-bar">
        <div className="wc-reply-bar-body">
          <div className="wc-reply-bar-name">回复 {replyTo.senderName}</div>
          <div className="wc-reply-bar-text">
            {replyPreview(replyTo.type, replyTo.content)}
          </div>
        </div>
        <button className="wc-reply-bar-close" onClick={onCancelReply} aria-label="取消回复">✕</button>
      </div>
    );
  }
  return null;
}

export default memo(ComposeContextBar);
