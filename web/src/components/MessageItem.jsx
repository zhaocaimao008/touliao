import React, { memo } from 'react';
import Avatar from './Avatar';
import { mediaUrl } from '../utils/url';
import { formatFull } from '../utils/time';
import axios from 'axios';
import VoicePlayer from './VoicePlayer';
import { showToast } from '../utils/toast';
import { downloadFile } from '../utils/download';

// 图片加载失败占位图（过期/被删的云文件）：灰底 + 可见文字，保证不显示浏览器裂图
const IMG_BROKEN = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='90'>" +
  "<rect width='120' height='90' fill='#f0f0f0'/>" +
  "<text x='60' y='49' font-size='12' fill='#999' text-anchor='middle'>图片加载失败</text></svg>"
);

// Time divider rendered as a list item
export const TimeDivider = memo(function TimeDivider({ time }) {
  return (
    <div className="wc-msg-time">
      <span>{formatFull(time * 1000)}</span>
    </div>
  );
});

const MessageItem = memo(function MessageItem({ item, cbRef }) {
  const { msg, isMine, isLastMine, isSelected, isHighlighted, multiSelect,
    convType, userId, groupSettings, myGroupRole, members, claiming,
    pinnedMessages, consecutive } = item;

  const cbs = cbRef.current;

  // 拍一拍：居中系统提示「你 拍了拍 X」/「X 拍了拍 你」/「X 拍了拍 Y」
  if (msg.type === 'nudge') {
    let n = {};
    try { n = JSON.parse(msg.content); } catch { n = {}; }
    const actorName = String(n.actor) === String(userId) ? '你' : (n.actorName || '某人');
    const targetName = String(n.target) === String(userId) ? '你' : (n.targetName || '某人');
    return (
      <div className="wc-msg-time">
        <span>{actorName} 拍了拍 {targetName}</span>
      </div>
    );
  }

  const showRead      = isMine && msg._read      && convType === 'private';
  const showDelivered = isMine && msg._delivered && convType === 'private' && !msg._read;

  const canClickAvatar = (() => {
    if (isMine || convType !== 'group') return true;
    if (!groupSettings.no_private_chat) return true;
    if (myGroupRole === 'owner' || myGroupRole === 'admin') return true;
    const senderMember = members.find(m => m.id === msg.sender_id);
    return senderMember?.role === 'owner' || senderMember?.role === 'admin';
  })();

  const handleAvatarClick = () => {
    if (!canClickAvatar) {
      showToast('群主已开启禁止私聊');
      return;
    }
    if (!isMine) cbs.setShowUserProfile(msg.sender_id);
  };

  return (
    <div
      id={`msg-${msg.id}`}
      data-msg-id={msg.id}
      className={`wc-msg-row${isMine ? ' mine' : ''}${consecutive ? ' consecutive' : ''}${multiSelect ? ' multiselect-row' : ''}${isHighlighted ? ' wc-msg-hl' : ''}`}
      onClick={multiSelect ? () => cbs.toggleMsgSelect(msg.id) : undefined}
      onKeyDown={multiSelect ? e => e.key === 'Enter' && cbs.toggleMsgSelect(msg.id) : undefined}
      role={multiSelect ? 'checkbox' : undefined}
      aria-checked={multiSelect ? isSelected : undefined}
      tabIndex={multiSelect ? 0 : undefined}
      style={multiSelect ? { cursor: 'pointer' } : {}}
    >
      {multiSelect && (
        <div style={{ display: 'flex', alignItems: 'center', marginRight: 8, flexShrink: 0, alignSelf: 'center' }}>
          <div style={{ width: 20, height: 20, borderRadius: 10, border: `2px solid ${isSelected ? 'var(--green)' : 'var(--border-default)'}`, background: isSelected ? 'var(--green)' : 'var(--text-inverse)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .1s' }}>
            {isSelected && <span style={{ color: 'var(--text-inverse)', fontSize: 12, fontWeight: 700, lineHeight: 1 }}>✓</span>}
          </div>
        </div>
      )}
      <div
        className="wc-msg-avatar"
        onClick={!multiSelect ? handleAvatarClick : undefined}
        onDoubleClick={!multiSelect && !isMine ? () => cbs.onNudge?.(msg.sender_id) : undefined}
        title={!isMine ? '双击拍一拍' : undefined}
        style={{ cursor: !multiSelect && canClickAvatar && !isMine ? 'pointer' : 'default' }}
      >
        <Avatar src={msg.senderAvatar} name={msg.senderName} size={36} />
      </div>
      <div className="wc-msg-body">
        {!isMine && convType === 'group' && !consecutive && (
          <div className="wc-msg-sender">{msg.senderName}</div>
        )}
        <div className="wc-msg-bubble-wrap">
          {isMine && (
            msg._status === 'sending' ? (
              <div className="wc-msg-read"><span className="wc-msg-spinner" /></div>
            ) : msg._status === 'error' ? (
              <div
                className="wc-msg-read wc-msg-status-error-icon"
                data-testid="msg-send-failed"
                title="发送失败，点击重发"
                role="button" tabIndex={0} aria-label="发送失败，点击重发"
                onClick={() => cbs.retryMessage(msg)}
                onKeyDown={e => e.key === 'Enter' && cbs.retryMessage(msg)}
              >❗</div>
            ) : isLastMine && convType === 'private' ? (
              showRead
                ? <div className="wc-msg-read wc-msg-status-read" data-testid="msg-read-status">✓✓ 已读</div>
                : showDelivered
                  ? <div className="wc-msg-read wc-msg-status-delivered">✓✓ 已送达</div>
                  : <div className="wc-msg-read wc-msg-status-sent">✓ 已发送</div>
            ) : null
          )}
          <div
            data-testid={`msg-bubble-${msg.id}`}
            className={`wc-msg-bubble ${isMine ? 'mine' : 'other'}`}
            onContextMenu={e => cbs.handleContextMenu(e, msg)}
          >
            {msg.replyTo && (
              <div className="wc-msg-reply gi-cp" role="button" tabIndex={0} data-testid="msg-reply-preview"
                onClick={e => { e.stopPropagation(); cbs.scrollToMsg(msg.replyTo.id); }}
                onKeyDown={e => e.key === 'Enter' && cbs.scrollToMsg(msg.replyTo.id)}>
                <div className="wc-msg-reply-name">{msg.replyTo.senderName}</div>
                <div className="wc-msg-reply-text">
                  {msg.replyTo.deleted ? '消息已撤回' : msg.replyTo.type === 'image' ? '[图片]' : msg.replyTo.type === 'voice' ? '[语音]' : msg.replyTo.type === 'video' ? '[视频]' : msg.replyTo.type === 'red_packet' ? '[红包]' : msg.replyTo.type === 'file' ? '[文件]' : msg.replyTo.type === 'sticker' ? '[表情]' : (msg.replyTo.type === 'contact_card' || msg.replyTo.type === 'contact') ? '[名片]' : msg.replyTo.content}
                </div>
              </div>
            )}
            {msg.type === 'text' && (
              <span>
                {msg.content}
                {msg.edited ? <span className="wc-msg-edited" data-testid="msg-edited-flag" style={{ color: isMine ? 'rgba(0,0,0,.35)' : 'var(--text-tertiary)' }}>已编辑</span> : null}
              </span>
            )}
            {msg.type === 'image' && (
              <img loading="lazy"
                data-testid="msg-image"
                src={mediaUrl(msg.file_url)}
                alt="消息图片"
                className="wc-msg-img"
                tabIndex={0} aria-label="查看大图"
                onClick={() => cbs.setLightboxUrl(mediaUrl(msg.file_url))}
                onKeyDown={e => e.key === 'Enter' && cbs.setLightboxUrl(mediaUrl(msg.file_url))}
                onLoad={e => { e.currentTarget.classList.add('loaded'); cbs.onImageLoad?.(); }}
                onError={e => { const el = e.currentTarget; el.onerror = null; el.src = IMG_BROKEN; el.alt = '图片加载失败'; el.style.cursor = 'default'; el.style.pointerEvents = 'none'; el.tabIndex = -1; el.classList.add('loaded'); }}
              />
            )}
            {msg.type === 'voice' && (
              <VoicePlayer url={mediaUrl(msg.file_url)} />
            )}
            {msg.type === 'video' && (
              <video
                src={mediaUrl(msg.file_url)}
                controls
                preload="metadata"
                className="wc-msg-video"
              />
            )}
            {msg.type === 'file' && (
              <a href={mediaUrl(msg.file_url)}
                 onClick={(e) => { e.preventDefault(); downloadFile(msg.file_url, msg.content); }}
                 className="wc-msg-file-link" data-testid="msg-file">
                <div className="wc-msg-file-icon">📄</div>
                <div>
                  <div className="wc-msg-file-name">{msg.content}</div>
                  <div className="wc-msg-file-size">点击下载</div>
                </div>
              </a>
            )}
            {msg.type === 'sticker' && (
              <img loading="lazy" src={mediaUrl(msg.file_url || msg.content)} alt="sticker" className="wc-msg-sticker" onError={e => { e.currentTarget.style.display = 'none'; }} style={{ maxWidth: 120, maxHeight: 120 }} />
            )}
            {msg.type === 'contact_card' && (() => {
              let card = {};
              try { card = JSON.parse(msg.content); } catch { card = {}; }
              return (
                <div
                  onClick={() => card.uid && cbs.setShowUserProfile(card.uid)}
                  className="wc-contact-card"
                  role="button" tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && card.uid && cbs.setShowUserProfile(card.uid)}
                >
                  <div className="wc-contact-card-body">
                    <Avatar src={card.avatar} name={card.username} size={44} style={{ borderRadius: 6, flexShrink: 0 }} />
                    <div className="wc-contact-card-info">
                      <div className="wc-contact-card-name">{card.username || '用户'}</div>
                      {card.wechat_id && <div className="wc-contact-card-wechat">v信号：{card.wechat_id}</div>}
                    </div>
                  </div>
                  <div className="wc-contact-card-footer">个人名片</div>
                </div>
              );
            })()}
            {msg.type === 'red_packet' && (() => {
              let rp = {};
              try { rp = JSON.parse(msg.content); } catch { rp = {}; }
              return (
                <div
                  onClick={() => cbs.openRedPacket(rp.packetId)}
                  className="wc-redpacket-card"
                  role="button" tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && cbs.openRedPacket(rp.packetId)}
                >
                  <div className="wc-redpacket-body">
                    <div className="wc-redpacket-icon">🧧</div>
                    <div className="wc-redpacket-info">
                      <div className="wc-redpacket-greeting">
                        {rp.greeting || '恭喜发财，大吉大利'}
                      </div>
                      <div className="wc-redpacket-hint">点击领取红包</div>
                    </div>
                  </div>
                  <div className="wc-redpacket-footer">v信红包</div>
                </div>
              );
            })()}
          </div>
        </div>
        {convType === 'group' && isMine && msg.readCount > 0 && (
          <div className="wc-group-read-count">{msg.readCount}人已读</div>
        )}
        {msg.reactions?.length > 0 && (
          <div className="wc-reactions">
            {msg.reactions.map(r => (
              <div
                key={r.emoji}
                className={`wc-reaction-pill${r.userIds.map(String).includes(String(userId)) ? ' mine' : ''}`}
                onClick={() => axios.post(`/api/messages/${msg.id}/react`, { emoji: r.emoji })}
                role="button" tabIndex={0}
                aria-label={`${r.emoji} ${r.count > 1 ? r.count + '人' : ''}${r.userIds.map(String).includes(String(userId)) ? '，已回应' : '，点击回应'}`}
                aria-pressed={r.userIds.map(String).includes(String(userId))}
                onKeyDown={e => e.key === 'Enter' && axios.post(`/api/messages/${msg.id}/react`, { emoji: r.emoji })}
              >
                <span>{r.emoji}</span>
                {r.count > 1 && <span>{r.count}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => prev.item === next.item && prev.cbRef === next.cbRef);

export default MessageItem;
