import React, { memo } from 'react';
import { useI18n } from '../contexts/I18nContext';

/* ── 置顶消息 Banner / 详情（从 ChatWindow 抽离）────────────────────
   纯展示子组件：只读置顶列表与展开态，交互经回调上抛父级。memo 化后，
   父组件因输入/正在输入/来消息等高频 setState 重渲染时，只要 pinnedMessages
   与 showPinnedDetail 未变，本区块不重渲染。 */
function PinnedBanner({ pinnedMessages, showPinnedDetail, onToggleDetail, onUnpin }) {
  const { t } = useI18n();
  if (!pinnedMessages || pinnedMessages.length === 0) return null;
  const first = pinnedMessages[0];

  return (
    <>
      <div className="wc-pinned-banner"
        role="button" tabIndex={0} aria-expanded={showPinnedDetail} aria-label={t('chat.pinMessage')}
        onClick={onToggleDetail}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleDetail(); } }}>
        <span className="wc-pinned-badge">📌 {t('pinned.pinned')}</span>
        <span className="wc-pinned-text">
          {first?.type === 'image' ? t('chatlist.previewImage') : first?.content}
        </span>
        {pinnedMessages.length > 1 && <span className="wc-pinned-count">+{pinnedMessages.length - 1}</span>}
        <span className="wc-pinned-toggle">{showPinnedDetail ? '▲' : '▼'}</span>
      </div>
      {showPinnedDetail && (
        <div className="wc-pinned-detail">
          {pinnedMessages.map(p => (
            <div key={p.msgId} className="wc-pinned-item">
              <span className="wc-pinned-item-icon">📌</span>
              <div className="wc-pinned-item-body">
                <div className="wc-pinned-item-meta">{t('pinned.pinnedByTemplate').replace('{sender}', p.senderName).replace('{by}', p.pinnedByName)}</div>
                <div className="wc-pinned-item-text">{p.type === 'image' ? t('chatlist.previewImage') : p.content}</div>
              </div>
              <button className="wc-unpin-btn"
                onClick={e => { e.stopPropagation(); onUnpin(p.msgId); }}>
                {t('chat.unpinMessage')}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default memo(PinnedBanner);
