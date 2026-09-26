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
  // v3 极光：主空状态（chat 插画）用 hero 样式 — 衬线标题 + 极光插画
  const isHero = illustration === 'chat';
  return (
    <div className={`wc-state wc-state--empty${isHero ? ' wc-state--hero' : ''} ${className}`} role="status">
      {illustration
        ? <div className="wc-state-illustration" aria-hidden="true"><EmptyIllustration kind={illustration} /></div>
        : icon !== null && <div className="wc-state-icon" aria-hidden="true">{icon ?? <TouliaoIcon name="chat" />}</div>}
      <div className="wc-state-title">{title ?? t('common.empty')}</div>
      {desc && <div className="wc-state-desc">{desc}</div>}
      {action && <div className="wc-state-action">{action}</div>}
    </div>
  );
});

/** 空态插画：v3 极光 hero（品牌时刻）— 深空底 + 流动光带 + 星，深浅色自适应 */
const EmptyIllustration = React.memo(function EmptyIllustration({ kind = 'chat' }) {
  // 极光 hero：只用于主空状态（chat），其他 kind 用简化版
  if (kind === 'chat') {
    return (
      <svg viewBox="0 0 200 140" width="200" height="140" aria-hidden="true">
        <defs>
          <linearGradient id="aurora-band-1" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6D5AE6" stopOpacity="0" />
            <stop offset=".35" stopColor="#6D5AE6" stopOpacity=".55" />
            <stop offset=".65" stopColor="#5EEAD4" stopOpacity=".35" />
            <stop offset="1" stopColor="#5EEAD4" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="aurora-band-2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#5EEAD4" stopOpacity="0" />
            <stop offset=".5" stopColor="#8A78EB" stopOpacity=".4" />
            <stop offset="1" stopColor="#6D5AE6" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="aurora-glow" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#6D5AE6" stopOpacity=".25" />
            <stop offset="1" stopColor="#6D5AE6" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* 深空底 */}
        <rect x="10" y="6" width="180" height="128" rx="20" fill="#0B0E1A" />
        <rect x="10" y="6" width="180" height="128" rx="20" fill="url(#aurora-glow)" />
        {/* 流动光带 */}
        <path d="M20 70 Q60 30 100 62 T180 52" fill="none" stroke="url(#aurora-band-1)" strokeWidth="10" strokeLinecap="round" opacity=".9" />
        <path d="M20 92 Q70 58 110 84 T180 74" fill="none" stroke="url(#aurora-band-2)" strokeWidth="7" strokeLinecap="round" opacity=".8" />
        {/* 星 */}
        <circle cx="52" cy="34" r="1.6" fill="#fff" opacity=".9" />
        <circle cx="96" cy="24" r="1.2" fill="#fff" opacity=".6" />
        <circle cx="140" cy="38" r="2" fill="#5EEAD4" opacity=".8" />
        <circle cx="164" cy="96" r="1.4" fill="#fff" opacity=".7" />
        <circle cx="38" cy="108" r="1.2" fill="#fff" opacity=".5" />
        <circle cx="120" cy="108" r="1.6" fill="#fff" opacity=".8" />
        {/* 聊天气泡剪影 */}
        <rect x="72" y="52" width="56" height="36" rx="12" fill="#fff" opacity=".14" />
        <path d="M84 88 l-4 10 12-10" fill="#fff" opacity=".14" />
        <circle cx="90" cy="70" r="2.4" fill="#fff" opacity=".85" />
        <circle cx="100" cy="70" r="2.4" fill="#fff" opacity=".85" />
        <circle cx="110" cy="70" r="2.4" fill="#fff" opacity=".85" />
      </svg>
    );
  }
  // 其他 kind：简化线条版
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
  return <svg {...common} style={{ color: 'var(--text-tertiary)', opacity: .8 }}>{paths[kind] || paths.search}</svg>;
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
