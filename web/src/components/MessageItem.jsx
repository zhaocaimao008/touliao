import TouliaoIcon from '../ui-kit/Icon';

import React, { memo, useEffect, useState } from 'react';
import Avatar from './Avatar';
import { mediaUrl, resolveMediaUrl, getThumbUrl, useMediaCredentials } from '../utils/url';
import { formatFull } from '../utils/time';
import VoicePlayer from './VoicePlayer';
import { showToast } from '../utils/toast';
import { humanFileSize } from '../utils/fileSize';
import { getAspect, rememberAspect } from '../utils/imgDimCache';
import ImgOptimized from './ImgOptimized';
import { renderRichText, mentionsUser } from '../utils/richText';
import { useI18n } from '../contexts/I18nContext';
import { useSwipe } from '../hooks/useSwipe';
import MergedMessageCard from './MergedMessageCard';
import { groupSystemText } from '../utils/groupSystemText';

// Time divider rendered as a list item
export const TimeDivider = memo(function TimeDivider({ time }) {
  return (
    <div className="wc-msg-time">
      <span>{formatFull(time * 1000)}</span>
    </div>
  );
});

// 视频气泡封面：后端为视频生成 <uuid>_thumb.webp 海报（与图片缩略图同命名，见 getThumbUrl）。
// 旧视频没有海报 → 先用 Image() 探测：成功则 poster + preload="none"（不再为每个气泡拉视频
// metadata）；失败/探测中保持原行为 preload="metadata" + #t=0.1 抓首帧。结果按缩略图路径缓存。
const posterProbe = new Map(); // thumbPath -> 'ok' | 'fail' | Promise
function probePoster(thumbPath, src) {
  const cached = posterProbe.get(thumbPath);
  if (cached) return cached;
  const p = new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ ok: false });
    img.src = src;
  }).then(r => { posterProbe.set(thumbPath, r.ok ? 'ok' : 'fail'); return r; });
  posterProbe.set(thumbPath, p);
  return p;
}

function BubbleVideoThumb({ fileUrl, vidSrc, onMeta }) {
  const thumbPath = getThumbUrl(fileUrl);
  const hasThumb = !!thumbPath && thumbPath !== fileUrl;
  const thumbSrc = hasThumb ? mediaUrl(thumbPath) : undefined;
  const known = hasThumb ? posterProbe.get(thumbPath) : 'fail';
  const [probed, setProbed] = useState(null); // { path, ok }
  const status = typeof known === 'string' ? known
    : probed && probed.path === thumbPath ? (probed.ok ? 'ok' : 'fail') : 'pending';
  useEffect(() => {
    if (status !== 'pending' || !thumbSrc) return undefined;
    let alive = true;
    probePoster(thumbPath, thumbSrc).then(r => {
      if (!alive) return;
      if (r.ok && r.w && r.h) onMeta?.(r.w, r.h);
      setProbed({ path: thumbPath, ok: r.ok });
    });
    return () => { alive = false; };
  }, [status, thumbPath, thumbSrc, onMeta]);

  const usePoster = status === 'ok' && !!thumbSrc;
  // 用 #t=0.1 让浏览器抓取首帧作为封面缩略图（无海报时的回退路径）
  // 防御: file_url 缺失(撤回/删除后缓存残留)时 vidSrc 为 undefined,不得调 .includes
  const frameSrc = (vidSrc || '').includes('#') ? vidSrc : `${vidSrc || ''}#t=0.1`;
  return (
    <video
      key={usePoster ? 'poster' : 'frame'}
      src={usePoster ? vidSrc : frameSrc}
      poster={usePoster ? thumbSrc : undefined}
      preload={usePoster ? 'none' : status === 'pending' ? 'none' : 'metadata'}
      muted
      playsInline
      tabIndex={-1}
      className="wc-msg-video"
      style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
      onLoadedMetadata={e => {
        const v = e.currentTarget;
        onMeta?.(v.videoWidth, v.videoHeight);
      }}
    />
  );
}

// JSON.parse 失败时返回 fallback（与原 `let x = {}; try { x = JSON.parse(...) } catch { x = {} }` 等价）
function parseJsonOr(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

const MessageItem = memo(function MessageItem({ item, cbRef, measure }) {
  useMediaCredentials();
  const { t } = useI18n();
  const { msg, isMine, isLastMine, isSelected, isHighlighted, multiSelect, selectionBusy,
    convType, userId, myUsername, groupSettings, myGroupRole, members,
    consecutive } = item;

  // cbRef.current 只在事件回调里读（react-hooks/refs：渲染期间不得读 ref）。这也正是传 ref 的本意：
  // memo 比较不含回调本身，渲染期快照可能是旧回调，事件发生时再取才是最新的一组。

  // 左滑快捷回复（移动端）：仅普通消息可用，多选/系统消息禁用
  const canSwipeReply = !multiSelect && !msg.deleted;
  const { swipeOffset, isSwiping, swipeHandlers, resetSwipe, swipeEnabled } = useSwipe({
    disabled: !canSwipeReply,
    maxOffset: 72,
    allowRight: false, // 只有左滑回复；右滑没有对应操作，不跟手
    onSwipeLeft: () => { /* 吸附展开，按钮点击时真正触发回复 */ },
  });
  const handleSwipeReply = () => {
    resetSwipe();
    cbRef.current.setReply?.(msg);
  };

  // 拍一拍：居中系统提示「你 拍了拍 X」/「X 拍了拍 你」/「X 拍了拍 Y」
  // 群系统提示（入群/移出/转让群主/改群名等）：居中灰字，涉及自己时显示「你」
  if (msg.type === 'system') {
    return (
      <div className="wc-msg-time">
        <span>{groupSystemText(msg, userId, t)}</span>
      </div>
    );
  }

  if (msg.type === 'nudge') {
    let n;
    try { n = JSON.parse(msg.content); } catch { n = {}; }
    const actorName = String(n.actor) === String(userId) ? t('messageItem.you') : (n.actorName || t('messageItem.someone'));
    const targetName = String(n.target) === String(userId) ? t('messageItem.you') : (n.targetName || t('messageItem.someone'));
    return (
      <div className="wc-msg-time">
        <span>{t('messageItem.pattedTemplate').replace('{actor}', actorName).replace('{target}', targetName)}</span>
      </div>
    );
  }

  // 通话系统消息：居中灰字提示（微信行为对齐）。
  // content 为人话(老客户端兜底直接显示);结构化 JSON 在 file_url:
  // { callId, status: completed|canceled|rejected|missed, duration, callType, callerId }
  // 主叫/被叫文案不同（callerId 判定）;解析失败时显示 content 原文。
  if (msg.type === 'call') {
    let c;
    try { c = JSON.parse(msg.file_url); } catch { c = {}; }
    const isCaller = String(c.callerId) === String(userId);
    const kind = c.callType === 'video' ? t('chat.videoCall') : t('chat.voiceCall');
    let text = msg.content || t('messageItem.callEnded');
    if (c.status === 'completed' && typeof c.duration === 'number') {
      const d = Math.max(0, c.duration);
      const mins = Math.floor(d / 60), secs = d % 60;
      const durationText = d >= 60
        ? (secs ? t('messageItem.durationMinSecTemplate').replace('{min}', mins).replace('{sec}', secs) : t('messageItem.durationMinOnlyTemplate').replace('{min}', mins))
        : t('messageItem.durationSecOnlyTemplate').replace('{sec}', d);
      text = `${kind} ${durationText}`;
    } else if (c.status === 'canceled') {
      text = isCaller ? t('messageItem.callCanceled') : t('messageItem.callMissed');
    } else if (c.status === 'rejected') {
      text = isCaller ? t('messageItem.callRejectedByOther') : t('messageItem.callRejectedByMe');
    } else if (c.status === 'missed') {
      text = isCaller ? t('messageItem.callNoAnswer') : t('messageItem.callMissed');
    }
    return (
      <div className="wc-msg-time">
        <span>{text}</span>
      </div>
    );
  }

  const showRead      = isMine && msg._read      && convType === 'private';
  const showDelivered = isMine && msg._delivered && convType === 'private' && !msg._read;
  // 被@提醒：消息 @ 了自己时气泡加高亮边框（socket 通知已存在，此处补视觉样式）
  const isMentioned = !isMine && msg.type === 'text' && mentionsUser(msg.content, myUsername);
  // 定时消息标记：由后端调度器发出的消息带 is_scheduled=1
  const isScheduled   = !!msg.is_scheduled;

  const canClickAvatar = (() => {
    if (isMine || convType !== 'group') return true;
    if (!groupSettings.no_private_chat) return true;
    if (myGroupRole === 'owner' || myGroupRole === 'admin') return true;
    const senderMember = members.find(m => m.id === msg.sender_id);
    return senderMember?.role === 'owner' || senderMember?.role === 'admin';
  })();

  // Opening a profile has no competing double-click action; respond on the
  // first click instead of delaying every tap and retaining a stale timer.
  const doAvatarProfile = () => {
    if (!canClickAvatar) { showToast(t('messageItem.privateChatDisabledByOwner')); return; }
    if (!isMine) cbRef.current.setShowUserProfile(msg.sender_id);
  };

  const selectMessage = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectionBusy) cbRef.current.toggleMsgSelect(msg.id);
  };
  // 气泡内容的派生值。原先写在 JSX 里的立即执行函数（IIFE）中：IIFE 在渲染期执行且捕获了 cbRef，
  // react-hooks/refs 会判为渲染期读 ref。挪到组件体后，JSX 里只剩事件回调（事件发生时才读 cbRef.current）。
  // 只按 msg.type 计算对应那一项，其余为空值，行为与原 IIFE 一致。
  const imgSrc = msg.type === 'image' ? mediaUrl(msg.file_url) : '';
  // 已知宽高比 → 预留正确高度，消除加载时的布局抖动(滚回历史不再跳)
  const imgAspect = msg.type === 'image' ? getAspect(imgSrc) : null;
  // aspect-ratio 需配合一个确定的宽度才能预留高度：竖图按 max-height 反推宽度，
  // 横图/方图取 max-width(240)，避免占位框比真实图片更宽。
  const imgAspectStyle = imgAspect
    ? { aspectRatio: String(imgAspect), width: imgAspect < 0.75 ? `${Math.round(320 * imgAspect)}px` : 'min(240px, 62vw)' }
    : undefined;
  const vidSrc = msg.type === 'video' ? mediaUrl(msg.file_url) : '';
  // 复用图片的宽高比缓存，视频加载 metadata 前也能预留正确高度,消除布局抖动
  const vidAspect = msg.type === 'video' ? getAspect(vidSrc) : null;
  const onVideoMeta = (w, h) => {
    rememberAspect(vidSrc, w, h);
    measure?.(); // 海报/metadata 到达→按真实宽高比撑开后同步重测本行
  };
  const openVideoPreview = () => cbRef.current.setVideoUrl?.({ url: msg.file_url, name: msg.content });
  const fileSizeText = msg.type === 'file' && msg.file_size ? humanFileSize(msg.file_size) : '';
  const contactCard = msg.type === 'contact_card' ? parseJsonOr(msg.content, {}) : null;
  const redPacket = msg.type === 'red_packet' ? parseJsonOr(msg.content, {}) : null;

  const selectionLabel = msg.type === 'text' || msg.type === 'file'
    ? String(msg.content || t('messageItem.replyPreviewFile'))
    : t({ image: 'messageItem.replyPreviewImage', video: 'messageItem.replyPreviewVideo',
      voice: 'messageItem.replyPreviewVoice', sticker: 'messageItem.replyPreviewSticker',
      contact_card: 'messageItem.replyPreviewContactCard', red_packet: 'messageItem.replyPreviewRedPacket',
    }[msg.type] || 'chat.multiSelect');

  return (
    <div
      id={`msg-${msg.id}`}
      data-msg-id={msg.id}
      className={`wc-msg-row${isMine ? ' mine' : ''}${consecutive ? ' consecutive' : ''}${multiSelect ? ' multiselect-row' : ''}${isHighlighted ? ' wc-msg-hl' : ''}`}
      onClickCapture={multiSelect ? selectMessage : undefined}
      onKeyDownCapture={multiSelect ? e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cbRef.current.cancelMultiSelect?.(); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.repeat) { e.preventDefault(); e.stopPropagation(); return; }
          selectMessage(e);
        }
      } : undefined}
      onContextMenuCapture={multiSelect ? e => { e.preventDefault(); e.stopPropagation(); } : undefined}
      onClick={!multiSelect && swipeOffset !== 0 ? resetSwipe : undefined}
      role={multiSelect ? 'checkbox' : undefined}
      aria-label={multiSelect ? selectionLabel : undefined}
      aria-checked={multiSelect ? isSelected : undefined}
      aria-disabled={multiSelect && selectionBusy ? true : undefined}
      tabIndex={multiSelect ? 0 : undefined}
      {...(canSwipeReply && swipeEnabled ? swipeHandlers : {})}
      style={{
        ...(multiSelect ? { cursor: 'pointer' } : {}),
        touchAction: canSwipeReply && swipeEnabled ? 'pan-y pinch-zoom' : undefined,
        transition: isSwiping ? 'none' : undefined,
        ...(canSwipeReply && swipeOffset !== 0 ? { transform: `translateX(${swipeOffset}px)` } : {}),
      }}
    >
      {/* 左滑快捷回复按钮（移动端） */}
      {canSwipeReply && swipeEnabled && swipeOffset !== 0 && (
        <button
          type="button"
          className="wc-msg-swipe-reply"
          data-swipe-action="true"
          onClick={handleSwipeReply}
          aria-label={t('chat.reply')}
          style={{ width: 72 }}
        >
          <TouliaoIcon name="reply" size="sm" />
          <span>{t('chat.reply')}</span>
        </button>
      )}
      {multiSelect && (
        <div style={{ display: 'flex', alignItems: 'center', marginRight: 8, flexShrink: 0, alignSelf: 'center' }}>
          <div style={{ width: 20, height: 20, borderRadius: 'var(--radius-full)', border: `2px solid ${isSelected ? 'var(--green)' : 'var(--border-default)'}`, background: isSelected ? 'var(--green)' : 'var(--text-inverse)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background var(--dur-fast), border-color var(--dur-fast)' }}>
            {isSelected && <span style={{ color: 'var(--text-inverse)', fontSize: 'var(--text-sm)', fontWeight: 700, lineHeight: 1 }}><TouliaoIcon name="check" size="xs" /></span>}
          </div>
        </div>
      )}
      <div
        className="wc-msg-avatar"
        onClick={!multiSelect ? doAvatarProfile : undefined}
        role={!multiSelect && !isMine ? 'button' : undefined}
        tabIndex={!multiSelect && !isMine ? 0 : undefined}
        onKeyDown={!multiSelect && !isMine ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doAvatarProfile(); } }) : undefined}
        title={!isMine ? t('chat.clickToViewProfile') : undefined}
        style={{ cursor: !multiSelect && canClickAvatar && !isMine ? 'pointer' : 'default' }}
      >
        <Avatar src={msg.senderAvatar} name={msg.senderName} size='sm' />
      </div>
      {/* One checkbox owns the whole message during selection, including nested media and links. */}
      <div className="wc-msg-body" inert={multiSelect ? '' : undefined} style={multiSelect ? { pointerEvents: 'none' } : undefined}>
        {!isMine && convType === 'group' && !consecutive && (
          <div
            className="wc-msg-sender"
            onClick={!multiSelect ? doAvatarProfile : undefined}
            role={!multiSelect && canClickAvatar ? 'button' : undefined}
            tabIndex={!multiSelect && canClickAvatar ? 0 : undefined}
            onKeyDown={!multiSelect && canClickAvatar ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doAvatarProfile(); } }) : undefined}
            style={!multiSelect && canClickAvatar ? { cursor: 'pointer' } : undefined}
            title={canClickAvatar ? t('chat.clickToViewProfile') : undefined}
          >{msg.senderName}</div>
        )}
        <div className="wc-msg-bubble-wrap">
          {isMine && (
            msg._status === 'sending' ? (
              <div className="wc-msg-read"><span className="wc-msg-spinner" /></div>
            ) : msg._status === 'error' ? (
              <div
                className="wc-msg-read wc-msg-status-error-icon"
                data-testid="msg-send-failed"
                title={t('messageItem.sendFailedRetry')}
                role="button" tabIndex={0} aria-label={t('messageItem.sendFailedRetry')}
                onClick={() => cbRef.current.retryMessage(msg)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cbRef.current.retryMessage(msg); } }}
              ><TouliaoIcon name="error" size="sm" /></div>
            ) : isLastMine && convType === 'private' ? (
              showRead
                ? <div className="wc-msg-read wc-msg-status-read" data-testid="msg-read-status"><TouliaoIcon name="read" size="xs" /> {t('messageItem.read')}</div>
                : showDelivered
                  ? <div className="wc-msg-read wc-msg-status-delivered"><TouliaoIcon name="delivered" size="xs" /> {t('messageItem.delivered')}</div>
                  : <div className="wc-msg-read wc-msg-status-sent"><TouliaoIcon name="check" size="xs" /> {t('messageItem.sent')}</div>
            ) : null
          )}
          {/* 定时消息标记：气泡左上角「定时」角标 */}
          {isScheduled && (
            <span
              data-testid="msg-scheduled-badge"
              title={t('messageItem.scheduledMessageTitle')}
              style={{
                position: 'absolute', top: 2, left: isMine ? 'auto' : 2, right: isMine ? 2 : 'auto',
                fontSize: 'var(--text-2xs)', padding: '1px 5px', borderRadius: 'var(--radius-badge)',
                background: 'rgba(var(--color-primary-rgb), .85)', color: '#fff',
                pointerEvents: 'none', zIndex: 1,
              }}
            >{t('messageItem.scheduled')}</span>
          )}
          <div
            data-testid={`msg-bubble-${msg.id}`}
            className={`wc-msg-bubble ${isMine ? 'mine' : 'other'}${isMentioned ? ' mentioned' : ''}`}
            title={msg.created_at ? formatFull(msg.created_at * 1000) : undefined}
            tabIndex={multiSelect ? undefined : 0}
            aria-haspopup={multiSelect ? undefined : 'menu'}
            onKeyDown={e => {
              if (!multiSelect && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
                cbRef.current.handleContextMenu(e, msg);
              }
            }}
            onContextMenu={e => cbRef.current.handleContextMenu(e, msg)}
          >
            {/* 引用块：被引用消息已撤回/删除时整块移除，UI 无痕（不显示"消息已撤回"） */}
            {msg.replyTo && !msg.replyTo.deleted && (
              <div className={`wc-msg-reply gi-cp${(msg.type === 'image' || msg.type === 'video' || msg.type === 'sticker') ? ' wc-msg-reply--on-media' : ''}`} role="button" tabIndex={0} data-testid="msg-reply-preview"
                aria-label={t('messageItem.jumpToQuotedAriaLabel')}
                onClick={e => { e.stopPropagation(); cbRef.current.scrollToMsg(msg.replyTo.id); }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); cbRef.current.scrollToMsg(msg.replyTo.id); } }}>
                <div className="wc-msg-reply-name">{msg.replyTo.senderName}</div>
                {(msg.replyTo.type === 'image' || msg.replyTo.type === 'sticker') && msg.replyTo.file_url ? (
                  <div className="wc-msg-reply-media">
                    {/* width/height 显式声明：缩略图未解码前就按 34×34 预留盒子，
                        使本行首帧高度即等于 estimateHeight 的预留值，杜绝图片解码后
                        撑高本行、下一行事后回落造成的重叠/抖动。 */}
                    <img loading="lazy" width={34} height={34} src={mediaUrl(getThumbUrl(msg.replyTo.file_url))} alt="" className="wc-msg-reply-thumb"
                      onLoad={() => measure?.()}
                      onError={async e => {
                        const el = e.currentTarget;
                        try {
                          const original = await resolveMediaUrl(msg.replyTo.file_url);
                          if (!el.isConnected) return;
                          if (el.src !== original) { el.src = original; return; }
                        } catch { /* Failed authorization uses the hidden placeholder. */ }
                        el.style.display = 'none'; measure?.();
                      }} />
                  </div>
                ) : (
                  <div className="wc-msg-reply-text">
                    {msg.replyTo.type === 'image' ? t('messageItem.replyPreviewImage') : msg.replyTo.type === 'voice' ? t('messageItem.replyPreviewVoice') : msg.replyTo.type === 'video' ? t('messageItem.replyPreviewVideo') : msg.replyTo.type === 'red_packet' ? t('messageItem.replyPreviewRedPacket') : msg.replyTo.type === 'file' ? t('messageItem.replyPreviewFile') : msg.replyTo.type === 'sticker' ? t('messageItem.replyPreviewSticker') : (msg.replyTo.type === 'contact_card' || msg.replyTo.type === 'contact') ? t('messageItem.replyPreviewContactCard') : msg.replyTo.content}
                  </div>
                )}
              </div>
            )}
            {msg.type === 'text' && (
              <span>
                {renderRichText(String(msg.content ?? ''), { myUsername })}
                {msg.edited ? <span className="wc-msg-edited" data-testid="msg-edited-flag" style={{ color: isMine ? 'rgba(0,0,0,.35)' : 'var(--text-tertiary)' }}>{t('messageItem.edited')}</span> : null}
              </span>
            )}
            {msg.type === 'merged' && <MergedMessageCard content={msg.content} />}
            {msg.type === 'image' && (
              <ImgOptimized
                key={imgSrc}
                data-testid="msg-image"
                src={imgSrc}
                alt={t('messageItem.messageImageAlt')}
                className="wc-msg-img"
                aspectStyle={imgAspectStyle}
                role="button" tabIndex={0} aria-label={t('moments.viewLargeImage')}
                onClick={() => cbRef.current.setLightboxUrl(msg.file_url)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cbRef.current.setLightboxUrl(msg.file_url); } }}
                onLoad={e => {
                  const el = e.currentTarget;
                  rememberAspect(imgSrc, el.naturalWidth, el.naturalHeight);
                  measure?.();
                  cbRef.current.onImageLoad?.();
                }}
              />
            )}
            {msg.type === 'voice' && (
              <VoicePlayer url={mediaUrl(msg.file_url)} msgId={msg.id} isMine={isMine} />
            )}
            {msg.type === 'video' && (
              <div
                className="wc-msg-video-wrap"
                role="button" tabIndex={0} aria-label={t('messageItem.playVideo')}
                onClick={openVideoPreview}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVideoPreview(); } }}
                style={{
                  position: 'relative', display: 'inline-block', cursor: 'pointer',
                  borderRadius: 'var(--radius-input, 8px)', overflow: 'hidden', background: '#000',
                  ...(vidAspect ? { aspectRatio: String(vidAspect), width: 'min(240px, 62vw)' } : { width: 'min(240px, 62vw)' }),
                }}
              >
                {/* 封面：有 _thumb.webp 海报用 poster+preload=none，否则 preload=metadata + #t=0.1 抓首帧；不播放、不显控件 */}
                <BubbleVideoThumb fileUrl={msg.file_url} vidSrc={vidSrc} onMeta={onVideoMeta} />
                {/* 中央播放按钮浮层 */}
                <span aria-hidden="true" style={{
                  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                  width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,0,0,.5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <TouliaoIcon name="play" style={{marginLeft:3}} tone="onDark" size="md" />
                </span>
              </div>
            )}
            {msg.type === 'file' && (
              <a href={mediaUrl(msg.file_url)}
                 onClick={(e) => {
                   e.preventDefault();
                   cbRef.current.setFilePreview?.({
                     fileUrl: msg.file_url, filename: msg.content,
                     mimeType: msg.file_mime || '', fileSize: msg.file_size || 0,
                   });
                 }}
                 className="wc-msg-file-link" data-testid="msg-file">
                <div className="wc-msg-file-icon" aria-hidden="true">
                  <TouliaoIcon name="fileContent" size="lg" />
                </div>
                <div>
                  <div className="wc-msg-file-name">{msg.content}</div>
                  <div className="wc-msg-file-size">{fileSizeText ? `${fileSizeText} · ${t('messageItem.clickToPreview')}` : t('messageItem.clickToPreview')}</div>
                </div>
              </a>
            )}
            {msg.type === 'sticker' && (
              <img key={mediaUrl(msg.file_url || msg.content)} loading="lazy" src={mediaUrl(msg.file_url || msg.content)} alt="sticker" className="wc-msg-sticker" onLoad={() => measure?.()} onError={e => { e.currentTarget.style.display = 'none'; measure?.(); }} style={{ maxWidth: 120, maxHeight: 120 }} />
            )}
            {msg.type === 'contact_card' && (
              <div
                onClick={() => contactCard.uid && cbRef.current.setShowUserProfile(contactCard.uid)}
                className="wc-contact-card"
                role="button" tabIndex={0}
                aria-label={t('messageItem.viewCardAriaLabelTemplate').replace('{name}', contactCard.username || t('messageItem.defaultUsername'))}
                onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && contactCard.uid) { e.preventDefault(); cbRef.current.setShowUserProfile(contactCard.uid); } }}
              >
                <div className="wc-contact-card-body">
                  <Avatar src={contactCard.avatar} name={contactCard.username} size='md' style={{ borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
                  <div className="wc-contact-card-info">
                    <div className="wc-contact-card-name">{contactCard.username || t('messageItem.defaultUsername')}</div>
                    {contactCard.wechat_id && <div className="wc-contact-card-wechat">{t('messageItem.touliaoIdTemplate').replace('{id}', contactCard.wechat_id)}</div>}
                  </div>
                </div>
                <div className="wc-contact-card-footer">{t('messageItem.personalCard')}</div>
              </div>
            )}
            {msg.type === 'red_packet' && (
              <div
                onClick={() => cbRef.current.openRedPacket(redPacket.packetId)}
                className="wc-redpacket-card"
                role="button" tabIndex={0}
                aria-label={t('messageItem.openRedPacket')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cbRef.current.openRedPacket(redPacket.packetId); } }}
              >
                <div className="wc-redpacket-body">
                  <div className="wc-redpacket-icon"><TouliaoIcon name="redPacket" size="lg" /></div>
                  <div className="wc-redpacket-info">
                    <div className="wc-redpacket-greeting">
                      {redPacket.greeting || t('messageItem.redPacketFallbackGreeting')}
                    </div>
                    <div className="wc-redpacket-hint">{isMine ? t('messageItem.viewRedPacket') : t('messageItem.clickToClaimRedPacket')}</div>
                  </div>
                </div>
                <div className="wc-redpacket-footer">{t('messageItem.touliaoRedPacket')}</div>
              </div>
            )}
            {msg.type === 'transfer' && (() => {
              let tf;
              try { tf = JSON.parse(msg.content); } catch { tf = {}; }
              // 转账即到账，无需收款按钮，直接显示已收钱状态
              const isReceiver = !isMine;
              return (
                <div className="wc-transfer-card" aria-label={t('messageItem.transferAriaLabelTemplate').replace('{amount}', tf.amount)}>
                  <div className="wc-transfer-body">
                    <div className="wc-transfer-icon"><TouliaoIcon name="transfer" size="lg" /></div>
                    <div className="wc-transfer-info">
                      <div className="wc-transfer-amount">{tf.amount} {t('chat.coinUnit')}</div>
                      {tf.note ? <div className="wc-transfer-note">{tf.note}</div> : null}
                    </div>
                  </div>
                  <div className="wc-transfer-footer">
                    {isReceiver ? t('messageItem.transferReceived') : t('messageItem.transferSuccess')}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        {convType === 'group' && isMine && msg.readCount > 0 && (
          <div className="wc-group-read-count">{t('messageItem.groupReadCountTemplate').replace('{count}', msg.readCount)}</div>
        )}
        {msg.reactions?.length > 0 && (
          <div className="wc-reactions">
            {msg.reactions.map(r => {
              // 防御: 后端某些 reaction 可能缺 userIds(旧数据/部分返回) → 视为空数组
              const uids = Array.isArray(r.userIds) ? r.userIds.map(String) : [];
              const mine = uids.includes(String(userId));
              return (
              <div
                key={r.emoji}
                className={`wc-reaction-pill${mine ? ' mine' : ''}`}
                onClick={() => cbRef.current.toggleReaction(msg.id, r.emoji)}
                role="button" tabIndex={0}
                aria-label={`${r.emoji} ${r.count > 1 ? t('messageItem.reactionCountPersonTemplate').replace('{count}', r.count) : ''}${mine ? t('messageItem.reactionRespondedSuffix') : t('messageItem.reactionClickToRespondSuffix')}`}
                aria-pressed={mine}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cbRef.current.toggleReaction(msg.id, r.emoji); } }}
              >
                <span>{r.emoji}</span>
                {r.count > 1 && <span>{r.count}</span>}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => prev.item === next.item && prev.cbRef === next.cbRef && prev.measure === next.measure);

export default MessageItem;
