import React from 'react';
import { ErrorState, Skeleton } from './StateViews';
import { useI18n } from '../contexts/I18nContext';

export default function DirectoryFeedback({ resource }) {
  const { t } = useI18n();
  if (resource.loading) return resource.loaded
    ? <div className="cl-load-status" role="status">{t('common.loading')}</div>
    : <Skeleton rows={4} />;
  if (resource.error) return <ErrorState className="cl-load-error" onRetry={resource.reload} />;
  return null;
}
