import { captureSession, isSessionCurrent } from '../utils/sessionContext';
import TouliaoSwitch from '../ui-kit/Switch';
import { SettingCell, SettingSection } from '../ui-kit/Settings';
import { DangerButton } from '../ui-kit/Button';
import useFocusTrap from '../hooks/useFocusTrap';
import useMediaQuery from '../hooks/useMediaQuery';
import TouliaoIcon from '../ui-kit/Icon';
import React, { useState } from 'react';
import axios from 'axios';
import { showToast, showConfirm } from '../utils/toast';
import { useConvSettings } from '../hooks/useConvSettings';
import { useI18n } from '../contexts/I18nContext';

/**
 * 私聊「聊天设置」面板：免打扰 / 置顶 / 聊天背景 / 阅后即焚 / 双向删除记录。
 * 从 ChatWindow.jsx 抽出（原 2705 行大文件拆分），无状态耦合，仅回调通信。
 */
export default function PrivateChatSettings({ conversation, onClose, onConvUpdate, onPickBackground, onClearBackground, onCleared, onOpenChatFiles }) {
  const { t } = useI18n();
  const narrow = useMediaQuery('(max-width: 767px)');
  const panelRef = useFocusTrap(narrow, { onEscape: onClose });
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
  // 免打扰 / 置顶：与 GroupInfo 共用 useConvSettings（state + /mute /pin API），
  // saving 沿用同一忙碌标志（切换/清空互斥），保持原有交互不回归。
  const { muted, pinned, saving, toggleMute, togglePin, setSaving } = useConvSettings(conversation, onConvUpdate);
  const [burnAfter, setBurnAfter] = useState(conversation.burn_after || 0);

  const clearMessages = async () => {
    const name = conversation.name || t('privateChat.defaultChatName');
    if (!await showConfirm(t('privateChat.confirmClearTemplate').replace('{name}', name), { variant: 'DANGER', confirmLabel: t('chat.delete') })) return;
    setSaving(true);
    try {
      await axios.delete(`/api/messages/conversation/${conversation.id}/messages`);
      onCleared?.();
      onClose?.();
    } catch (err) {
      showToast(err.response?.data?.error || t('privateChat.clearFailed'), 'error');
    }
    setSaving(false);
  };

  const changeBurnAfter = async (val) => {
    const s = parseInt(val) || 0;
    const scope = captureSession();
    try {
      const { data } = await axios.post(`/api/messages/conversation/${conversation.id}/burn-after`, { seconds: s });
      if (!isSessionCurrent(scope)) return;
      setBurnAfter(data.burn_after);
      onConvUpdate?.({ burn_after: data.burn_after });
    } catch { showToast(t('privateChat.setBurnFailed'), 'error'); }
  };

  const exportChat = async () => {
    setSaving(true);
    try {
      const { data } = await axios.get(`/api/messages/conversation/${conversation.id}/export`, { responseType: 'blob', timeout: 120000 });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `聊天记录-${conversation.name || conversation.id}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      showToast(err.response?.data?.error || t('groupInfo.exportFailed'), 'error');
    }
    setSaving(false);
  };

  return (
    <div ref={panelRef} tabIndex={-1} className="wc-settings-panel" role={narrow ? 'dialog' : 'region'} aria-modal={narrow || undefined} aria-label={t('privateChat.title')}>
      <div className="wc-settings-header">
        <span className="wc-settings-header-title">{t('privateChat.title')}</span>
        <button className="wc-settings-close-btn" onClick={onClose} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
      </div>
      <div className="wc-settings-body">
        <SettingSection className="wc-settings-section-mt">
          <SettingCell label={t('chatlist.muteChat')} right={<TouliaoSwitch value={muted} disabled={saving} onChange={toggleMute} />} />
          <SettingCell label={t('chatlist.pinChat')} right={<TouliaoSwitch value={pinned} disabled={saving} onChange={togglePin} />} />
          <SettingCell label={t('groupInfo.setBackground')} value={conversation.background ? t('privateChat.changeBackground') : t('privateChat.chooseImage')} onClick={() => onPickBackground?.()} />
          {conversation.background && <SettingCell danger label={t('groupInfo.clearBackground')} onClick={() => onClearBackground?.()} />}
          {onOpenChatFiles && <SettingCell label={t('groupInfo.chatFiles')} desc={t('privateChat.mediaTypesHint')} onClick={onOpenChatFiles} />}
          <SettingCell label={t('groupInfo.exportChat')} desc={t('privateChat.saveAsTxt')} disabled={saving} onClick={exportChat} />
          <SettingCell label={t('privateChat.burnAfterReading')} right={
            <select value={burnAfter} onChange={e => changeBurnAfter(e.target.value)} className="wc-settings-select" aria-label={t('privateChat.burnAfterReading')}>
              {BURN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          } />
        </SettingSection>
        <DangerButton
          onClick={clearMessages}
          disabled={saving}
          className="wc-settings-clear-btn"
        >
          {t('groupInfo.clearMessagesBtn')}
        </DangerButton>
      </div>
    </div>
  );
}
