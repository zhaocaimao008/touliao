import React, { memo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { MAX_BATCH_RECALL } from '../hooks/useBatchRecall';

/* ── 多选模式底部工具栏（从 ChatWindow 抽离）──────────────────────
   纯展示子组件：只读已选条数，转发/撤回/取消经回调上抛父级。memo 化后，
   父组件因打字/来消息等高频重渲染时，只要 selectedCount 与回调未变本条
   不重渲染。 */
function MultiSelectBar({ selectedCount, onForward, onDelete, onCancel, busy = false, phase = 'idle', error = '' }) {
  const { t } = useI18n();
  return (
    <div className="wc-multiselect-bar" role="group" aria-label={t('chat.multiSelect')} aria-busy={busy}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel(); } }}>
      <button className="wc-ms-cancel-btn" aria-disabled={busy} onClick={() => { if (!busy) onCancel(); }}>{t('common.cancel')}</button>
      <span className="wc-ms-count" role="status" aria-live="polite">{phase === 'sending' ? t('multiSelect.recalling') : t('multiSelect.selectedCountTemplate').replace('{n}', selectedCount)}</span>
      <div className="wc-ms-btn-group">
        <button className="wc-ms-btn-primary wc-ms-btn-forward" onClick={() => { if (!busy) onForward(); }} aria-disabled={busy} disabled={selectedCount === 0}>{t('chat.forward')}</button>
        <button className="wc-ms-btn-primary wc-ms-btn-delete" onClick={() => { if (!busy) onDelete(); }} aria-disabled={busy}
          aria-describedby={selectedCount > MAX_BATCH_RECALL ? 'batch-recall-limit' : undefined}
          disabled={selectedCount === 0 || selectedCount > MAX_BATCH_RECALL}>{t('chat.recall')}</button>
      </div>
      {selectedCount > MAX_BATCH_RECALL && <div id="batch-recall-limit" className="wc-ms-feedback" role="status">{t('multiSelect.recallLimit')}</div>}
      {error && <div className="wc-ms-feedback is-error" role="alert">{error}</div>}
    </div>
  );
}

export default memo(MultiSelectBar);
