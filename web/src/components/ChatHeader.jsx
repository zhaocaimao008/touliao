import React, { memo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { IcoSearch, IcoVideo } from './Icons';

/* ── ChatWindow 顶栏 ─────────────────────────────────────────────────
   memo 化：父组件高频 setState 时顶栏不重渲染。 */

const IcoVoiceCall = () => <svg viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>;
const IcoInfo      = () => <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>;

function ChatHeader({
  conversation,
  memberCount,
  features = {},
  showGroupInfo,
  showSearch,
  onClose,
  onOpenUserProfile,
  onStartCall,
  onStartGroupCall,
  onToggleGroupInfo,
  onToggleSearch,
}) {
  const { t } = useI18n();
  const isPrivate = conversation.type === 'private';
  const isGroup   = conversation.type === 'group';

  return (
    <div className="wc-chat-header">
      <button className="wc-chat-header-back wc-back-btn" onClick={onClose} title={t('common.back')} aria-label={t('common.back')}>
        <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      </button>

      <div className="wc-header-name-container">
        {isPrivate && conversation.otherUser?.id ? (
          <div
            className="wc-chat-header-name wc-chat-header-name-clickable"
            data-testid="chat-title"
            role="button" tabIndex={0}
            title={t('chat.clickToViewProfile')}
            onClick={() => onOpenUserProfile(conversation.otherUser.id)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenUserProfile(conversation.otherUser.id); } }}
          >
            {conversation.name || t('chat.defaultChatName')}
          </div>
        ) : (
          <div className="wc-chat-header-name" data-testid="chat-title">
            {conversation.name || t('chat.defaultChatName')}
            {memberCount ? <span className="wc-header-member-count">({memberCount})</span> : null}
          </div>
        )}
        {isPrivate && conversation.otherUser?.status === 'online' && (
          <div className="wc-chat-header-sub">{t('contacts.online')}</div>
        )}
      </div>

      <div className="wc-chat-header-right">
        {isPrivate && <>
          <button className="wc-chat-header-btn" data-testid="chat-call-audio-btn" title={t('chat.voiceCall')} aria-label={t('chat.voiceCall')} onClick={() => onStartCall('audio')}><IcoVoiceCall /></button>
          <button className="wc-chat-header-btn" data-testid="chat-call-video-btn" title={t('chat.videoCall')} aria-label={t('chat.videoCall')} onClick={() => onStartCall('video')}><IcoVideo /></button>
        </>}
        {isGroup && <>
          {features.groupVoiceCall !== false && <button className="wc-chat-header-btn" title={t('chat.groupVoiceCall')} aria-label={t('chat.groupVoiceCall')} onClick={() => onStartGroupCall('audio')}><IcoVoiceCall /></button>}
          {features.groupVideoCall !== false && <button className="wc-chat-header-btn" title={t('chat.groupVideoCall')} aria-label={t('chat.groupVideoCall')} onClick={() => onStartGroupCall('video')}><IcoVideo /></button>}
        </>}
        {/* 搜索聊天记录 */}
        <button
          className={`wc-chat-header-btn${showSearch ? ' active' : ''}`}
          title={t('chat.searchChatHistory')}
          aria-label={t('chat.searchChatHistory')}
          aria-pressed={showSearch}
          data-testid="chat-search-btn"
          onClick={onToggleSearch}
        ><IcoSearch /></button>
        {/* 群聊信息 / 聊天信息 */}
        <button
          className={`wc-chat-header-btn${showGroupInfo ? ' active' : ''}`}
          title={isGroup ? t('chat.groupInfo') : t('chat.chatInfo')}
          aria-label={isGroup ? t('chat.groupInfo') : t('chat.chatInfo')}
          aria-pressed={showGroupInfo}
          data-testid="chat-group-info-btn"
          onClick={onToggleGroupInfo}
        ><IcoInfo /></button>
      </div>
    </div>
  );
}

export default memo(ChatHeader);
