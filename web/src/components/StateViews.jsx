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

/** EmptyState — 空态（支持插画） */
export const EmptyState = React.memo(function EmptyState({ icon, illustration, title, desc, action, className = '' }) {
  const { t } = useI18n();
  return (
    <div className={`wc-state wc-state--empty ${className}`} role="status">
      {illustration
        ? <div className="wc-state-illustration" aria-hidden="true"><EmptyIllustration kind={illustration} /></div>
        : icon !== null && <div className="wc-state-icon" aria-hidden="true">{icon ?? <TouliaoIcon name="chat" />}</div>}
      <div className="wc-state-title">{title ?? t('common.empty')}</div>
      {desc && <div className="wc-state-desc">{desc}</div>}
      {action && <div className="wc-state-action">{action}</div>}
    </div>
  );
});

/** 空态插画：简笔线条 SVG（跟随 --text-tertiary 着色，深浅色自适应） */
const EmptyIllustration = React.memo(function EmptyIllustration({ kind = 'chat' }) {
  const common = {
    viewBox: '0 0 120 90',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    width: 120,
    height: 90,
  };
  const paths = {
    // 聊天：对话框 + 省略号
    chat: (<>
      <rect x="14" y="12" width="92" height="56" rx="14" />
      <path d="M34 68 L28 82 L46 68" />
      <circle cx="44" cy="40" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="60" cy="40" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="76" cy="40" r="2.5" fill="currentColor" stroke="none" />
    </>),
    // 搜索：放大镜
    search: (<>
      <circle cx="52" cy="42" r="24" />
      <path d="M70 60 L92 82" strokeWidth="5" />
      <path d="M42 42 h20" strokeWidth="2.5" opacity=".6" />
    </>),
    // 联系人：人形
    contacts: (<>
      <circle cx="60" cy="32" r="14" />
      <path d="M32 78 c0-16 12-26 28-26 s28 10 28 26" />
    </>),
    // 动态：图片框 + 山形
    moments: (<>
      <rect x="20" y="14" width="80" height="62" rx="10" />
      <circle cx="42" cy="34" r="6" />
      <path d="M20 66 L52 40 L70 56 L84 46 L100 60" />
    </>),
    // 图片：缺图占位
    image: (<>
      <rect x="24" y="14" width="72" height="62" rx="10" />
      <path d="M44 40 L60 56 M60 40 L44 56" />
    </>),
  };
  return <svg {...common}>{paths[kind] || paths.chat}</svg>;
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
