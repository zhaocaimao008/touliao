import React, { memo } from 'react';
import { useI18n } from '../contexts/I18nContext';

/* ── 输入区上方的上下文条（从 ChatWindow 抽离）─────────────────────
   编辑模式指示条 与 回复引用条 二选一（编辑优先）。纯展示子组件：
   只读 editingMsg / replyTo，取消动作经回调上抛父级。memo 化后，父组件
   因打字/来消息等高频重渲染时，只要这些 props 未变本条不重渲染。 */
function replyPreview(type, content, t) {
  switch (type) {
    case 'image': return t('messageItem.replyPreviewImage');
    case 'voice': return t('messageItem.replyPreviewVoice');
    case 'video': return t('messageItem.replyPreviewVideo');
    case 'red_packet': return t('messageItem.replyPreviewRedPacket');
    case 'file': return t('messageItem.replyPreviewFile');
    default: return content;
  }
}

function ComposeContextBar({ editingMsg, replyTo, onCancelEdit, onCancelReply }) {
  const { t } = useI18n();
  if (editingMsg) {
    return (
      <div className="wc-edit-bar">
        <div className="wc-edit-bar-body">
          <div className="wc-edit-bar-label">{t('composeBar.editingMessage')}</div>
          <div className="wc-edit-bar-text">{editingMsg.content}</div>
        </div>
        <button className="wc-edit-cancel-btn" onClick={onCancelEdit} aria-label={t('composeBar.cancelEdit')}>✕</button>
      </div>
    );
  }
  if (replyTo) {
    return (
      <div className="wc-reply-bar">
        <div className="wc-reply-bar-body">
          <div className="wc-reply-bar-name">{t('composeBar.replyingToTemplate').replace('{name}', replyTo.senderName)}</div>
          <div className="wc-reply-bar-text">
            {replyPreview(replyTo.type, replyTo.content, t)}
          </div>
        </div>
        <button className="wc-reply-bar-close" onClick={onCancelReply} aria-label={t('composeBar.cancelReply')}>✕</button>
      </div>
    );
  }
  return null;
}

export default memo(ComposeContextBar);
