import React from 'react';

/** Skeleton — 骨架屏占位（列表首屏加载态） */
export const Skeleton = React.memo(function Skeleton({ rows = 6, avatar = true }) {
  return (
    <div className="wc-skeleton" role="status" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="wc-skeleton-row" key={i}>
          {avatar && <div className="wc-skeleton-avatar" />}
          <div className="wc-skeleton-lines">
            <div className="wc-skeleton-line" style={{ width: '55%' }} />
            <div className="wc-skeleton-line" style={{ width: '80%' }} />
          </div>
        </div>
      ))}
    </div>
  );
});

/** EmptyState — 空态 */
export const EmptyState = React.memo(function EmptyState({ icon = '📭', title = '暂无内容', desc, action }) {
  return (
    <div className="wc-state wc-state--empty" role="status">
      <div className="wc-state-icon" aria-hidden="true">{icon}</div>
      <div className="wc-state-title">{title}</div>
      {desc && <div className="wc-state-desc">{desc}</div>}
      {action && <div className="wc-state-action">{action}</div>}
    </div>
  );
});

/** ErrorState — 错误态（可重试） */
export const ErrorState = React.memo(function ErrorState({ title = '加载失败', desc = '请检查网络后重试', onRetry }) {
  return (
    <div className="wc-state wc-state--error" role="alert">
      <div className="wc-state-icon" aria-hidden="true">⚠️</div>
      <div className="wc-state-title">{title}</div>
      {desc && <div className="wc-state-desc">{desc}</div>}
      {onRetry && (
        <button type="button" className="wc-state-retry" onClick={onRetry}>重试</button>
      )}
    </div>
  );
});
