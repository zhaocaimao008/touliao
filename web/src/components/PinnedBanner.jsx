import React, { memo } from 'react';

/* ── 置顶消息 Banner / 详情（从 ChatWindow 抽离）────────────────────
   纯展示子组件：只读置顶列表与展开态，交互经回调上抛父级。memo 化后，
   父组件因输入/正在输入/来消息等高频 setState 重渲染时，只要 pinnedMessages
   与 showPinnedDetail 未变，本区块不重渲染。 */
function PinnedBanner({ pinnedMessages, showPinnedDetail, onToggleDetail, onUnpin }) {
  if (!pinnedMessages || pinnedMessages.length === 0) return null;
  const first = pinnedMessages[0];

  return (
    <>
      <div className="wc-pinned-banner"
        role="button" tabIndex={0} aria-expanded={showPinnedDetail} aria-label="置顶消息"
        onClick={onToggleDetail}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleDetail(); } }}>
        <span className="wc-pinned-badge">📌 置顶</span>
        <span className="wc-pinned-text">
          {first?.type === 'image' ? '[图片]' : first?.content}
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
                <div className="wc-pinned-item-meta">{p.senderName} · 由{p.pinnedByName}置顶</div>
                <div className="wc-pinned-item-text">{p.type === 'image' ? '[图片]' : p.content}</div>
              </div>
              <button className="wc-unpin-btn"
                onClick={e => { e.stopPropagation(); onUnpin(p.msgId); }}>
                取消置顶
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default memo(PinnedBanner);
