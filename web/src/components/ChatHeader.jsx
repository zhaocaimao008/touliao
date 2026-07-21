import React, { memo } from 'react';

/* ── ChatWindow 顶栏（从 ChatWindow 抽离）──────────────────────────
   纯展示子组件：只读会话/功能开关/群成员数，回调全部由父级传入（均为
   稳定引用：useCallback / setState）。memo 化后，父组件因输入按键、
   正在输入、来消息等高频 setState 重渲染时，只要下列 props 未变，
   顶栏（含静态 SVG 图标）不再跟着重渲染/重挂载。 */

// SVG 图标：模块级常量，无 props/闭包，组件类型稳定不重挂载。
const IcoVoiceCall = () => <svg viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>;
const IcoVideoCall = () => <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>;
const IcoMore = () => <svg viewBox="0 0 24 24"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>;

function ChatHeader({
  conversation,
  memberCount,
  features = {},
  showGroupInfo,
  onClose,
  onOpenUserProfile,
  onStartCall,
  onStartGroupCall,
  onToggleGroupInfo,
}) {
  const isPrivate = conversation.type === 'private';
  const isGroup = conversation.type === 'group';

  return (
    <div className="wc-chat-header">
      <button className="wc-chat-header-back wc-back-btn" onClick={onClose} title="返回" aria-label="返回">
        <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      </button>
      <div className="wc-header-name-container">
        {isPrivate && conversation.otherUser?.id ? (
          <div
            className="wc-chat-header-name wc-chat-header-name-clickable"
            data-testid="chat-title"
            role="button"
            tabIndex={0}
            title="点击查看资料"
            onClick={() => onOpenUserProfile(conversation.otherUser.id)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenUserProfile(conversation.otherUser.id); } }}
          >
            {conversation.name || '聊天'}
          </div>
        ) : (
          <div className="wc-chat-header-name" data-testid="chat-title">
            {conversation.name || '聊天'}
            {memberCount
              ? <span className="wc-header-member-count">({memberCount})</span>
              : null
            }
          </div>
        )}
        {isPrivate && conversation.otherUser?.status === 'online' && (
          <div className="wc-chat-header-sub">在线</div>
        )}
      </div>
      <div className="wc-chat-header-right">
        {/* 顶栏对齐微信：去搜索/查看资料(资料点名字即可看)，仅保留通话与更多 */}
        {isPrivate && <>
          <button className="wc-chat-header-btn" data-testid="chat-call-audio-btn" title="语音通话" aria-label="语音通话" onClick={() => onStartCall('audio')}><IcoVoiceCall /></button>
          <button className="wc-chat-header-btn" data-testid="chat-call-video-btn" title="视频通话" aria-label="视频通话" onClick={() => onStartCall('video')}><IcoVideoCall /></button>
        </>}
        {isGroup && <>
          {/* 后台开关关闭后（groupVoiceCall/groupVideoCall === false）直接隐藏对应按钮 */}
          {features.groupVoiceCall !== false && <button className="wc-chat-header-btn" title="群语音通话" aria-label="群语音通话" onClick={() => onStartGroupCall('audio')}><IcoVoiceCall /></button>}
          {features.groupVideoCall !== false && <button className="wc-chat-header-btn" title="群视频通话" aria-label="群视频通话" onClick={() => onStartGroupCall('video')}><IcoVideoCall /></button>}
        </>}
        <button
          className={`wc-chat-header-btn${showGroupInfo ? ' active' : ''}`}
          title={isGroup ? '群聊信息' : '更多'}
          aria-label={isGroup ? '群聊信息' : '更多'}
          aria-expanded={showGroupInfo}
          data-testid="chat-group-info-btn"
          onClick={onToggleGroupInfo}
        ><IcoMore /></button>
      </div>
    </div>
  );
}

export default memo(ChatHeader);
