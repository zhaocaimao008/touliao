import React from 'react';
import { useI18n } from '../contexts/I18nContext';

/** Skeleton — 骨架屏占位（列表首屏加载态） */
export const Skeleton = React.memo(function Skeleton({ rows = 6, avatar = true }) {
  const { t } = useI18n();
  return (
    <div className="wc-skeleton" role="status" aria-busy="true" aria-label={t('common.loading')}>
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
export const EmptyState = React.memo(function EmptyState({ icon = '📭', title, desc, action }) {
  const { t } = useI18n();
  return (
    <div className="wc-state wc-state--empty" role="status">
      <div className="wc-state-icon" aria-hidden="true">{icon}</div>
      <div className="wc-state-title">{title ?? t('common.empty')}</div>
      {desc && <div className="wc-state-desc">{desc}</div>}
      {action && <div className="wc-state-action">{action}</div>}
    </div>
  );
});

/** ErrorState — 错误态（可重试） */
export const ErrorState = React.memo(function ErrorState({ title, desc, onRetry }) {
  const { t } = useI18n();
  return (
    <div className="wc-state wc-state--error" role="alert">
      <div className="wc-state-icon" aria-hidden="true">⚠️</div>
      <div className="wc-state-title">{title ?? t('stateViews.loadFailed')}</div>
      {(desc ?? t('stateViews.checkNetworkRetry')) && <div className="wc-state-desc">{desc ?? t('stateViews.checkNetworkRetry')}</div>}
      {onRetry && (
        <button type="button" className="wc-state-retry" onClick={onRetry}>{t('common.retry')}</button>
      )}
    </div>
  );
});
