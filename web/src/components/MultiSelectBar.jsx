import React, { memo } from 'react';

/* ── 多选模式底部工具栏（从 ChatWindow 抽离）──────────────────────
   纯展示子组件：只读已选条数，转发/撤回/取消经回调上抛父级。memo 化后，
   父组件因打字/来消息等高频重渲染时，只要 selectedCount 与回调未变本条
   不重渲染。 */
function MultiSelectBar({ selectedCount, onForward, onDelete, onCancel }) {
  return (
    <div className="wc-multiselect-bar">
      <button className="wc-ms-cancel-btn" onClick={onCancel}>取消</button>
      <span className="wc-ms-count">已选 {selectedCount} 条</span>
      <div className="wc-ms-btn-group">
        <button className="wc-ms-btn-primary wc-ms-btn-forward" onClick={onForward} disabled={selectedCount === 0}>转发</button>
        <button className="wc-ms-btn-primary wc-ms-btn-delete" onClick={onDelete} disabled={selectedCount === 0}>撤回</button>
      </div>
    </div>
  );
}

export default memo(MultiSelectBar);
