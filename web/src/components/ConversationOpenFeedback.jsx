import React from 'react';
import { useI18n } from '../contexts/I18nContext';
import { keepSettingFocus } from '../utils/settingFocus';

export default function ConversationOpenFeedback({ navigation }) {
  const { t } = useI18n();
  if (!navigation.openingKey && !navigation.error) return null;
  return <div className="conversation-open-feedback" role={navigation.error ? 'alert' : 'status'}>
    <span>{t(navigation.error ? 'gs.openFailed' : 'gs.openingChat')}</span>
    {navigation.retry && <button type="button" disabled={!!navigation.openingKey} onClick={() => keepSettingFocus(navigation.retry)}>{t('common.retry')}</button>}
  </div>;
}
