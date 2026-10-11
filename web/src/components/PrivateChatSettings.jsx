import TouliaoSwitch from '../ui-kit/Switch';
import { SettingCell, SettingSection } from '../ui-kit/Settings';
import { DangerButton } from '../ui-kit/Button';
import useFocusTrap from '../hooks/useFocusTrap';
import useMediaQuery from '../hooks/useMediaQuery';
import TouliaoIcon from '../ui-kit/Icon';
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import axios from 'axios';
import { showConfirm } from '../utils/toast';
import { useConvSettings } from '../hooks/useConvSettings';
import { useI18n } from '../contexts/I18nContext';
import { keepSettingFocus } from '../utils/settingFocus';

/**
 * 私聊「聊天设置」面板：免打扰 / 置顶 / 聊天背景 / 阅后即焚 / 双向删除记录。
 * 从 ChatWindow.jsx 抽出（原 2705 行大文件拆分），无状态耦合，仅回调通信。
 */
export default function PrivateChatSettings({ conversation, onClose, onConvUpdate, onPickBackground, onClearBackground, onCleared, onOpenChatFiles }) {
  const { t } = useI18n();
  const narrow = useMediaQuery('(max-width: 767px)');
  const panelRef = useFocusTrap(narrow, { onEscape: onClose, lockScroll: true });
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  // Desktop stays non-modal; only keys within this panel close it.
  useEffect(() => {
    if (narrow) return undefined;
    const panel = panelRef.current;
    const previous = document.activeElement;
    panel?.querySelector('.wc-settings-close-btn')?.focus({ preventScroll: true });
    const onKey = event => {
      if (event.key === 'Escape' && !event.defaultPrevented && panel?.contains(event.target)) {
        event.preventDefault(); event.stopPropagation(); closeRef.current();
      }
    };
    panel?.addEventListener('keydown', onKey);
    return () => {
      panel?.removeEventListener('keydown', onKey);
      if (previous?.isConnected && (document.activeElement === document.body || panel?.contains(document.activeElement))) previous.focus({ preventScroll: true });
    };
  }, [narrow, panelRef]);
  const BURN_OPTIONS = [
    { value: 0,      label: t('privateChat.burnOff') },
    { value: 10,     label: t('privateChat.burn10s') },
    { value: 30,     label: t('privateChat.burn30s') },
    { value: 60,     label: t('privateChat.burn1min') },
    { value: 300,    label: t('privateChat.burn5min') },
    { value: 3600,   label: t('privateChat.burn1hour') },
    { value: 86400,  label: t('privateChat.burn24hours') },
    { value: 604800, label: t('privateChat.burn7days') },
  ];
  const { muted, pinned, burnAfter, saving, pending, error, toggleMute, togglePin, changeBurnAfter, runAction } = useConvSettings(conversation, onConvUpdate);

  const clearMessages = () => {
    const name = conversation.name || t('privateChat.defaultChatName');
    return runAction('clear', {
      confirm: () => showConfirm(t('privateChat.confirmClearTemplate').replace('{name}', name), { variant: 'DANGER', confirmLabel: t('chat.delete') }),
      request: config => axios.delete(`/api/messages/conversation/${conversation.id}/messages`, config),
      onSuccess: () => { onCleared?.(); onClose?.(); },
      failureMessage: t('privateChat.clearFailed'),
    });
  };

  const exportChat = () => runAction('export', {
    request: config => axios.get(`/api/messages/conversation/${conversation.id}/export`, { ...config, responseType: 'blob', timeout: 120000 }),
    onSuccess: ({ data }) => {
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `聊天记录-${conversation.name || conversation.id}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
    failureMessage: t('groupInfo.exportFailed'),
  });

  return (
    <div ref={panelRef} tabIndex={-1} className="wc-settings-panel" role={narrow ? 'dialog' : 'region'} aria-modal={narrow || undefined} aria-label={t('privateChat.title')}>
      <div className="wc-settings-header">
        <span className="wc-settings-header-title">{t('privateChat.title')}</span>
        <button type="button" className="wc-settings-close-btn" onClick={onClose} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
      </div>
      <div className="wc-settings-body">
        {saving && <div className="tl-settings-feedback" role="status">{t(pending === 'export' ? 'privateChat.exporting' : pending === 'clear' ? 'privateChat.processing' : 'common.saving')}</div>}
        {error && <div className="tl-settings-feedback is-error" role="alert">{error}</div>}
        <SettingSection className="wc-settings-section-mt">
          <SettingCell label={t('chatlist.muteChat')} right={<TouliaoSwitch value={muted} disabled={saving} onChange={value => keepSettingFocus(() => toggleMute(value))} />} />
          <SettingCell label={t('chatlist.pinChat')} right={<TouliaoSwitch value={pinned} disabled={saving} onChange={value => keepSettingFocus(() => togglePin(value))} />} />
          <SettingCell label={t('groupInfo.setBackground')} value={conversation.background ? t('privateChat.changeBackground') : t('privateChat.chooseImage')} onClick={() => onPickBackground?.()} />
          {conversation.background && <SettingCell danger label={t('groupInfo.clearBackground')} onClick={() => onClearBackground?.()} />}
          {onOpenChatFiles && <SettingCell label={t('groupInfo.chatFiles')} desc={t('privateChat.mediaTypesHint')} onClick={onOpenChatFiles} />}
          <SettingCell label={t('groupInfo.exportChat')} desc={t('privateChat.saveAsTxt')} disabled={saving} onClick={() => keepSettingFocus(exportChat)} />
          <SettingCell label={t('privateChat.burnAfterReading')} right={
            <select value={burnAfter} disabled={saving} onChange={e => { const value = e.target.value; keepSettingFocus(() => changeBurnAfter(value)); }} className="wc-settings-select" aria-label={t('privateChat.burnAfterReading')}>
              {BURN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          } />
        </SettingSection>
        <DangerButton
          onClick={() => keepSettingFocus(clearMessages)}
          disabled={saving}
          className="wc-settings-clear-btn"
        >
          {t('groupInfo.clearMessagesBtn')}
        </DangerButton>
      </div>
    </div>
  );
}
