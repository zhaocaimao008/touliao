import React from 'react';
import TouliaoIcon from '../ui-kit/Icon';
import { useI18n } from '../contexts/I18nContext';

export default function MediaPreviewStatus({ state, errorKey }) {
  const { t } = useI18n();
  if (state.status === 'ready') return null;
  return <div className="media-preview-status" role={state.status === 'error' ? 'alert' : 'status'}>
    {state.status === 'error' ? <>
      <TouliaoIcon name="warning" size="lg" />
      <p>{t(errorKey)}</p>
      <button type="button" onClick={event => {
        event.currentTarget.closest('[role="dialog"]')?.querySelector('.media-preview-close')?.focus();
        state.retry();
      }}>{t('common.retry')}</button>
    </> : <>
      <span className="media-preview-spinner" aria-hidden="true" />
      <p>{t('common.loading')}</p>
    </>}
  </div>;
}
