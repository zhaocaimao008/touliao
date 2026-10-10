import React from 'react';
import { useI18n } from '../contexts/I18nContext';

export default function DirectoryActionFeedback({ action }) {
  const { t } = useI18n();
  if (action.pendingKey) return <div className="cl-load-status" role="status">{t('contacts.processing')}</div>;
  if (action.error) return <div className="cl-action-error" role="alert">{t('contacts.actionUnconfirmed')}</div>;
  return null;
}
