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
    if (!await showConfirm(t('privateChat.confirmClearTemplate').replace('{name}', name))) return;
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
    setBurnAfter(s);
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/burn-after`, { seconds: s });
      onConvUpdate?.({ burn_after: s });
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
    <div className="wc-settings-panel">
      <div className="wc-settings-header">
        <span className="wc-settings-header-title">{t('privateChat.title')}</span>
        <button className="wc-settings-close-btn" onClick={onClose} aria-label={t('common.close')}>✕</button>
      </div>
      <div className="wc-settings-body">
        <div className="wc-settings-section-mt">
          <div className="wc-settings-row">
            <span className="wc-settings-row-label">{t('chatlist.muteChat')}</span>
            <div role="switch" aria-checked={muted} tabIndex={0}
              onClick={() => !saving && toggleMute(!muted)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !saving && toggleMute(!muted)}
              className={`wc-settings-toggle${muted ? ' on' : ' off'}${saving ? ' saving' : ''}`}>
              <div className={`wc-settings-toggle-thumb${muted ? ' on' : ' off'}`} />
            </div>
          </div>
          <div className="wc-settings-row">
            <span className="wc-settings-row-label">{t('chatlist.pinChat')}</span>
            <div role="switch" aria-checked={pinned} tabIndex={0}
              onClick={() => !saving && togglePin(!pinned)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !saving && togglePin(!pinned)}
              className={`wc-settings-toggle${pinned ? ' on' : ' off'}${saving ? ' saving' : ''}`}>
              <div className={`wc-settings-toggle-thumb${pinned ? ' on' : ' off'}`} />
            </div>
          </div>
          <div className="wc-settings-row wc-settings-row-clickable" role="button" tabIndex={0} onClick={() => onPickBackground?.()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickBackground?.(); } }}>
            <span className="wc-settings-row-label">{t('groupInfo.setBackground')}</span>
            <span className="wc-settings-row-action">{conversation.background ? t('privateChat.changeBackground') : t('privateChat.chooseImage')}</span>
          </div>
          {conversation.background && (
            <div className="wc-settings-row wc-settings-row-clickable" role="button" tabIndex={0} onClick={() => onClearBackground?.()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClearBackground?.(); } }}>
              <span className="wc-settings-row-label" style={{ color: 'var(--color-badge)' }}>{t('groupInfo.clearBackground')}</span>
            </div>
          )}
          {onOpenChatFiles && (
            <div className="wc-settings-row wc-settings-row-clickable" role="button" tabIndex={0} onClick={() => onOpenChatFiles()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenChatFiles(); } }}>
              <span className="wc-settings-row-label">{t('groupInfo.chatFiles')}</span>
              <span className="wc-settings-row-action">{t('privateChat.mediaTypesHint')}</span>
            </div>
          )}
          <div className="wc-settings-row wc-settings-row-clickable" role="button" tabIndex={0} onClick={() => !saving && exportChat()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!saving) exportChat(); } }}>
            <span className="wc-settings-row-label">{t('groupInfo.exportChat')}</span>
            <span className="wc-settings-row-action">{t('privateChat.saveAsTxt')}</span>
          </div>
          <div className="wc-settings-row">
            <span className="wc-settings-row-label">{t('privateChat.burnAfterReading')}</span>
            <select
              value={burnAfter}
              onChange={e => changeBurnAfter(e.target.value)}
              className="wc-settings-select"
              style={{ fontSize: 'var(--text-sm2)', color: burnAfter > 0 ? 'var(--green)' : 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              {BURN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={clearMessages}
          disabled={saving}
          className="wc-settings-clear-btn"
        >
          {t('groupInfo.clearMessagesBtn')}
        </button>
      </div>
    </div>
  );
}
