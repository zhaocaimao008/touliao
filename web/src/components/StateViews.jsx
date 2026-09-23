import TouliaoIcon from '../ui-kit/Icon';
import React from 'react';
import { avatarPx } from '../ui-kit/avatarMetrics';
import { SecondaryButton } from '../ui-kit/Button';

import { useI18n } from '../contexts/I18nContext';

/** Skeleton — 骨架屏占位（列表首屏加载态） */
export const Skeleton = React.memo(function Skeleton({ rows = 6, avatar = true, variant = 'list' }) {
  const { t } = useI18n();
  return <div className={`wc-skeleton wc-skeleton--${variant}`} role="status" aria-busy="true" aria-label={t('common.loading')}>
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => {
        const mine = variant === 'chat' && i % 2 === 1;
        return <div className={`wc-skeleton-row${mine ? ' wc-skeleton-row--mine' : ''}`} key={i}>
          {avatar && !mine && <div className="wc-skeleton-avatar" style={{ '--skeleton-avatar-size': `${avatarPx(variant === 'chat' ? 'message' : 'list')}px` }} />}
          <div className="wc-skeleton-lines">
            <div className="wc-skeleton-line" style={{ width: variant === 'panel' ? '100%' : '55%' }} />
            {variant === 'list' && <div className="wc-skeleton-line" style={{ width: '80%' }} />}
          </div>
        </div>;
      })}
    </div>
  </div>;
});

/** EmptyState — 空态 */
export const EmptyState = React.memo(function EmptyState({ icon = <TouliaoIcon name="chat"  />, title, desc, action, className = '' }) {
  const { t } = useI18n();
  return (
    <div className={`wc-state wc-state--empty ${className}`} role="status">
      {icon && <div className="wc-state-icon" aria-hidden="true">{icon}</div>}
      <div className="wc-state-title">{title ?? t('common.empty')}</div>
      {desc && <div className="wc-state-desc">{desc}</div>}
      {action && <div className="wc-state-action">{action}</div>}
    </div>
  );
});

/** ErrorState — 错误态（可重试） */
export const ErrorState = React.memo(function ErrorState({ title, desc, onRetry, className = '' }) {
  const { t } = useI18n();
  return (
    <div className={`wc-state wc-state--error ${className}`} role="alert">
      <div className="wc-state-icon" aria-hidden="true"><TouliaoIcon name="warning"  /></div>
      <div className="wc-state-title">{title ?? t('stateViews.loadFailed')}</div>
      {(desc ?? t('stateViews.checkNetworkRetry')) && <div className="wc-state-desc">{desc ?? t('stateViews.checkNetworkRetry')}</div>}
      {onRetry && (
        <SecondaryButton className="wc-state-retry" onClick={onRetry}>{t('common.retry')}</SecondaryButton>
      )}
    </div>
  );
});
