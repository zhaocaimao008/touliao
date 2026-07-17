import React, { useState } from 'react';
import axios from 'axios';
import { showToast, showConfirm } from '../utils/toast';

const BURN_OPTIONS = [
  { value: 0,      label: '关闭' },
  { value: 10,     label: '10秒' },
  { value: 30,     label: '30秒' },
  { value: 60,     label: '1分钟' },
  { value: 300,    label: '5分钟' },
  { value: 3600,   label: '1小时' },
  { value: 86400,  label: '24小时' },
  { value: 604800, label: '7天' },
];

/**
 * 私聊「聊天设置」面板：免打扰 / 置顶 / 聊天背景 / 阅后即焚 / 双向删除记录。
 * 从 ChatWindow.jsx 抽出（原 2705 行大文件拆分），无状态耦合，仅回调通信。
 */
export default function PrivateChatSettings({ conversation, onClose, onConvUpdate, onPickBackground, onClearBackground, onCleared }) {
  const [muted, setMuted] = useState(!!conversation.muted);
  const [pinned, setPinned] = useState(!!conversation.pinned);
  const [burnAfter, setBurnAfter] = useState(conversation.burn_after || 0);
  const [saving, setSaving] = useState(false);

  const toggleMute = async (val) => {
    setSaving(true);
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/mute`, { muted: val ? 1 : 0 });
      setMuted(val);
      onConvUpdate?.({ muted: val ? 1 : 0 });
    } catch { showToast('操作失败', 'error'); }
    setSaving(false);
  };

  const togglePin = async (val) => {
    setSaving(true);
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/pin`, { pinned: val ? 1 : 0 });
      setPinned(val);
      onConvUpdate?.({ pinned: val ? 1 : 0 });
    } catch { showToast('操作失败', 'error'); }
    setSaving(false);
  };

  const clearMessages = async () => {
    const name = conversation.name || '当前聊天';
    if (!await showConfirm(`确认双向删除「${name}」的全部聊天记录？对方也将看不到这些记录。`)) return;
    setSaving(true);
    try {
      await axios.delete(`/api/messages/conversation/${conversation.id}/messages`);
      onCleared?.();
      onClose?.();
    } catch (err) {
      showToast(err.response?.data?.error || '清理失败', 'error');
    }
    setSaving(false);
  };

  const changeBurnAfter = async (val) => {
    const s = parseInt(val) || 0;
    setBurnAfter(s);
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/burn-after`, { seconds: s });
      onConvUpdate?.({ burn_after: s });
    } catch { showToast('设置失败', 'error'); }
  };

  return (
    <div className="wc-settings-panel">
      <div className="wc-settings-header">
        <span className="wc-settings-header-title">聊天设置</span>
        <button className="wc-settings-close-btn" onClick={onClose} aria-label="关闭窗口">✕</button>
      </div>
      <div className="wc-settings-body">
        <div className="wc-settings-section-mt">
          <div className="wc-settings-row">
            <span className="wc-settings-row-label">消息免打扰</span>
            <div role="switch" aria-checked={muted} tabIndex={0}
              onClick={() => !saving && toggleMute(!muted)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !saving && toggleMute(!muted)}
              className={`wc-settings-toggle${muted ? ' on' : ' off'}${saving ? ' saving' : ''}`}>
              <div className={`wc-settings-toggle-thumb${muted ? ' on' : ' off'}`} />
            </div>
          </div>
          <div className="wc-settings-row">
            <span className="wc-settings-row-label">置顶聊天</span>
            <div role="switch" aria-checked={pinned} tabIndex={0}
              onClick={() => !saving && togglePin(!pinned)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !saving && togglePin(!pinned)}
              className={`wc-settings-toggle${pinned ? ' on' : ' off'}${saving ? ' saving' : ''}`}>
              <div className={`wc-settings-toggle-thumb${pinned ? ' on' : ' off'}`} />
            </div>
          </div>
          <div className="wc-settings-row wc-settings-row-clickable" role="button" tabIndex={0} onClick={() => onPickBackground?.()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickBackground?.(); } }}>
            <span className="wc-settings-row-label">设置聊天背景</span>
            <span className="wc-settings-row-action">{conversation.background ? '更换 ›' : '选择图片 ›'}</span>
          </div>
          {conversation.background && (
            <div className="wc-settings-row wc-settings-row-clickable" role="button" tabIndex={0} onClick={() => onClearBackground?.()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClearBackground?.(); } }}>
              <span className="wc-settings-row-label" style={{ color: 'var(--color-badge)' }}>清除聊天背景</span>
            </div>
          )}
          <div className="wc-settings-row">
            <span className="wc-settings-row-label">阅后即焚</span>
            <select
              value={burnAfter}
              onChange={e => changeBurnAfter(e.target.value)}
              className="wc-settings-select"
              style={{ fontSize: 13, color: burnAfter > 0 ? 'var(--green)' : 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
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
          双向删除聊天记录
        </button>
      </div>
    </div>
  );
}
