import useFocusTrap from '../hooks/useFocusTrap';
import TouliaoIcon from '../ui-kit/Icon';

import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import ImagePreview from './ImagePreview';
import VideoPreview from './VideoPreview';
import UploadProgressBar from './UploadProgressBar';
import { useAuth } from '../contexts/AuthContext';
import { showToast, showConfirm } from '../utils/toast';
import { getAspect, rememberAspect } from '../utils/imgDimCache';
import { getThumbUrl, mediaUrl, useMediaCredentials } from '../utils/url';
import { linkify } from '../utils/linkify';
import { useI18n } from '../contexts/I18nContext';
import { validateMomentVideo } from '../utils/momentMedia';

function ago(sec) {
  // 钳到 0：时钟偏差/服务器时间超前时避免出现「-3分钟前」
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + '分钟前';
  if (d < 86400) return Math.floor(d / 3600) + '小时前';
  if (d < 2592000) return Math.floor(d / 86400) + '天前';
  return new Date(sec * 1000).toLocaleDateString('zh-CN');
}

const CONTENT_LIMIT = 120;

/* 单条动态（memo：仅当本卡片数据 m 变化时才重渲染，点赞/评论不再重刷整个 feed）*/
export const MomentCard = memo(function MomentCard({ m, meId, onLike, onComment, onDelete, onDeleteComment, onLoadComments, onReport, onEdit }) {
  useMediaCredentials();
  const { t } = useI18n();
  const [commenting, setCommenting] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null); // { userId, username } | null：回复某条评论
  const [submitting, setSubmitting] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { urls, idx } | null
  const [videoLightbox, setVideoLightbox] = useState(false);
  const [likePop, setLikePop] = useState(false);  // 主动点赞时心跳动画（仅点击触发，避免 feed 加载已赞项乱跳）

  const viewAllComments = async () => {
    setLoadingComments(true);
    try { await onLoadComments(m); } finally { setLoadingComments(false); }
  };
  const hasMoreComments = (m.commentCount || 0) > (m.comments?.length || 0);

  const submit = async () => {
    if (submitting) return;              // 防连点/连按回车重复评论
    const val = text.trim();
    if (!val) return;
    setSubmitting(true);
    try { await onComment(m, val, () => { setText(''); setCommenting(false); setReplyTo(null); }, replyTo?.userId); }
    finally { setSubmitting(false); }
  };

  // 点评论 → 回复该人（不能回复自己）
  const startReply = (c) => {
    if (c.user_id === meId) return;
    setReplyTo({ userId: c.user_id, username: c.username });
    setCommenting(true);
  };

  // 微信九宫格规则：恰好 4 张时排成 2×2，其余按 1/2/3 列
  const imgCount = m.images?.length || 0;
  const gridCols = imgCount === 4 ? 2 : (imgCount ? Math.min(imgCount, 3) : 1);

  return (
    <div className="wc-moment-card">
      <Avatar src={m.author?.avatar} name={m.author?.username} size='md' />
      <div className="wc-moment-body">
        <div className="wc-moment-header">
          <span className="wc-moment-name">{m.author?.username || t('moments.defaultUser')}</span>
          {m.user_id === meId ? (
            <span className="moments-inline-actions">
              <button className="wc-moment-delete" onClick={() => onEdit(m)}>{t('chat.edit')}</button>
              <button className="wc-moment-delete" onClick={() => onDelete(m)}>{t('chat.delete')}</button>
            </span>
          ) : (
            <button className="wc-moment-delete" onClick={() => onReport(m)}>{t('moments.report')}</button>
          )}
        </div>
        {m.content && (() => {
          const needsTruncate = m.content.length > CONTENT_LIMIT;
          const display = needsTruncate && !expanded ? m.content.slice(0, CONTENT_LIMIT) + '…' : m.content;
          return (
            <div className="wc-moment-text">
              {linkify(display)}
              {needsTruncate && (
                <button className="wc-moment-expand-btn" onClick={() => setExpanded(v => !v)}>
                  {expanded ? t('moments.collapse') : t('moments.viewFull')}
                </button>
              )}
            </div>
          );
        })()}

        {/* 图片九宫格 */}
        {m.images?.length > 0 && (
          imgCount === 1 ? (
            // 单图：不强制正方形裁剪，按原图宽高比展示(封顶)，更接近微信；用缓存宽高比预留高度防抖动
            (() => {
              const single = m.images[0];
              const thumbSingle = getThumbUrl(single);
              const aspect = getAspect(single);
              return (
                <div className="wc-moment-images single">
                  <img loading="lazy" src={thumbSingle} alt={t('chat.image')}
                    className="wc-moment-single-img"
                    style={aspect ? { aspectRatio: String(aspect) } : undefined}
                    role="button" tabIndex={0} aria-label={t('moments.viewLargeImage')}
                    onLoad={e => { rememberAspect(single, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight); e.currentTarget.classList.add('loaded'); }}
                    onError={e => {
                      const el = e.currentTarget;
                      // 缩略图失败（旧动态无缩略图）先回退原图，原图也失败才隐藏
                      if (thumbSingle !== single && el.src !== single) { el.src = single; return; }
                      el.classList.add('loaded'); el.style.display = 'none';
                    }}
                    onClick={() => setLightbox({ urls: m.images, idx: 0 })}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox({ urls: m.images, idx: 0 }); } }} />
                </div>
              );
            })()
          ) : (
            <div className="wc-moment-images" style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
              {m.images.map((src, i) => (
                <img loading="lazy" key={src || i} src={getThumbUrl(src)} alt={t('moments.imageAltTemplate').replace('{n}', i + 1)} className="moments-zoom-cursor"
                  role="button" tabIndex={0} aria-label={t('moments.viewLargeImageTemplate').replace('{n}', i + 1)}
                  onLoad={e => e.currentTarget.classList.add('loaded')}
                  onError={e => {
                    const el = e.currentTarget;
                    const thumb = getThumbUrl(src);
                    if (thumb !== src && el.src !== src) { el.src = src; return; }
                    el.classList.add('loaded'); el.style.display = 'none';
                  }}
                  onClick={() => setLightbox({ urls: m.images, idx: i })}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox({ urls: m.images, idx: i }); } }} />
              ))}
            </div>
          )
        )}
        {m.video && (
          <button
            type="button"
            className="wc-moment-video-card"
            onClick={() => setVideoLightbox(true)}
            aria-label={t('moments.playVideo')}
          >
            <video
              src={mediaUrl(m.video) ? `${mediaUrl(m.video)}#t=0.1` : undefined}
              poster={m.cover ? mediaUrl(m.cover) : undefined}
              preload="metadata"
              muted
              playsInline
              tabIndex={-1}
            />
            <span className="wc-moment-video-play" aria-hidden="true"><TouliaoIcon name="play" size="md" tone="onDark" /></span>
          </button>
        )}
        {lightbox && (
          <ImagePreview urls={lightbox.urls} initialIdx={lightbox.idx}
            url={lightbox.urls[lightbox.idx]} onClose={() => setLightbox(null)} />
        )}
        {videoLightbox && (
          <VideoPreview url={m.video} name={t('moments.videoFilename')} onClose={() => setVideoLightbox(false)} />
        )}

        <div className="wc-moment-actions">
          <span className="wc-moment-time">{ago(m.created_at)}</span>
          <button
            className={`wc-moment-action-btn${m.liked ? ' liked' : ''}`}
            aria-pressed={!!m.liked} aria-label={t('moments.like')}
            onClick={() => { if (!m.liked) { setLikePop(true); setTimeout(() => setLikePop(false), 360); } onLike(m); }}
          >
            <TouliaoIcon name="like" className={likePop ? 'wc-like-pop' : undefined} size="sm" />
            {m.likeCount > 0 ? m.likeCount : t('moments.like')}
          </button>
          <button className="wc-moment-action-btn" aria-label={t('moments.comment')} onClick={() => setCommenting(v => !v)}>
            <TouliaoIcon name="chat" size="sm" />
            {m.commentCount > 0 ? m.commentCount : t('moments.comment')}
          </button>
        </div>

        {/* 点赞者 */}
        {m.likes?.length > 0 && (
          <div className="wc-moment-likes">
            <TouliaoIcon name="like" className="wc-moment-heart" size="xs" />
            {m.likes.map(l => l.username).join('、')}
          </div>
        )}

        {/* 评论列表 */}
        {(m.comments?.length > 0 || hasMoreComments) && (
          <div className="wc-moment-comments">
            {m.comments?.map(c => (
              <div key={c.id} className="wc-moment-comment">
                <span className="wc-moment-comment-reply-target"
                  role={c.user_id === meId ? undefined : 'button'} tabIndex={c.user_id === meId ? undefined : 0}
                  onClick={() => startReply(c)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startReply(c); } }}>
                  <span className="wc-moment-comment-user">{c.username}</span>
                  {c.reply_to_username ? <span className="wc-moment-comment-reply">{t('moments.replyToTemplate').replace('{name}', c.reply_to_username)}</span> : null}
                  <span>：{c.content}</span>
                </span>
                {(c.user_id === meId || m.user_id === meId) && (
                  <button className="wc-moment-comment-del"
                    aria-label={t('moments.deleteCommentAriaLabel')} title={t('moments.deleteCommentAriaLabel')}
                    onClick={e => { e.stopPropagation(); onDeleteComment(m, c); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); } }}>{t('moments.deleteShort')}</button>
                )}
              </div>
            ))}
            {/* 热门动态：timeline 只返回前 N 条，按需加载全部 */}
            {hasMoreComments && (
              <button className="wc-moment-comment-viewall" disabled={loadingComments} onClick={viewAllComments}>
                {loadingComments ? t('common.loading') : t('moments.viewAllCommentsTemplate').replace('{n}', m.commentCount)}
              </button>
            )}
          </div>
        )}

        {/* 评论输入 */}
        {commenting && (
          <div className="wc-moment-comment-input">
            <input className="wc-moment-comment-field" autoFocus value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                // IME 组词中按 Enter 是选词，不提交(CJK 用户高频痛点)
                if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') { setCommenting(false); setReplyTo(null); }
              }}
              placeholder={replyTo ? t('moments.replyPlaceholderTemplate').replace('{name}', replyTo.username) : t('moments.commentPlaceholder')} maxLength={500} aria-label={t('moments.commentInputAriaLabel')} />
            <button className="wc-moment-comment-submit" onClick={submit} disabled={submitting || !text.trim()}>{t('chat.send')}</button>
          </div>
        )}
      </div>
    </div>
  );
});

// 朋友圈首屏骨架：3 张卡片占位（头像 + 昵称/正文行 + 九宫格块），shimmer 微光
function MomentsSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="wc-moment-card">
          <div className="wc-skel wc-skel-avatar" />
          <div className="wc-moment-body moments-skel-body">
            <div className="wc-skel wc-skel-line moments-skel-w30" />
            <div className="wc-skel wc-skel-line moments-skel-w85" />
            <div className="wc-skel wc-skel-line moments-skel-w55" />
            <div className="moments-skel-imgs-row">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="wc-skel moments-skel-img-block" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Moments() {
  const { t } = useI18n();
  const { user } = useAuth();
  const meId = user?.id;
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const timelineRequest = useRef(null);
  const timelineCursor = useRef(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState([]); // [{previewUrl, file}]
  const [mediaMode, setMediaMode] = useState('images'); // images | video
  const [video, setVideo] = useState(null); // { previewUrl, file }
  const [posting, setPosting] = useState(false);
  const [uploadPct, setUploadPct] = useState(null);   // null=非上传中；0-100=图片上传进度
  const [composing, setComposing] = useState(false);
  const [visibility, setVisibility] = useState('all'); // all | friends | private | include | exclude
  const [visibleTo, setVisibleTo] = useState([]); // 分组可见的好友 id 列表
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [friends, setFriends] = useState([]); // 联系人（分组可见选人用）
  const [notifCount, setNotifCount] = useState(0);
  const [notifList, setNotifList] = useState(null); // null = 面板关闭；[] = 已打开
  const [showSettings, setShowSettings] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState(false);
  const [notifHasMore, setNotifHasMore] = useState(false);
  const [notifReady, setNotifReady] = useState(0);
  const [notifReadError, setNotifReadError] = useState(false);
  const notifRequest = useRef(null);
  const notifReadRequest = useRef(null);
  const notifOffset = useRef(0);
  const notifBusy = useRef(false);
  const settingsDialog = useFocusTrap(showSettings);
  const notificationsDialog = useFocusTrap(notifList !== null);
  const [settingsError, setSettingsError] = useState(false);
  const [savingDays, setSavingDays] = useState(false);
  const savingDaysRef = useRef(false);
  const [visibleDays, setVisibleDays] = useState(null); // 最近 N 天可见：0=全部
  const [editing, setEditing] = useState(null); // 正在编辑的动态 { id, content } | null
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const imgInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const likingRef = useRef({});
  const imagesRef = useRef(images);
  const videoRef = useRef(video);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { videoRef.current = video; }, [video]);
  useEffect(() => () => {
    imagesRef.current.forEach(img => URL.revokeObjectURL(img.previewUrl));
    if (videoRef.current) URL.revokeObjectURL(videoRef.current.previewUrl);
  }, []);

  // 时间线使用稳定游标，新增/删除动态不会使下一页跳项；刷新取消旧请求。
  const load = useCallback(async (more = false) => {
    if (more && timelineRequest.current) return;
    timelineRequest.current?.abort();
    const ac = new AbortController();
    timelineRequest.current = ac;
    setLoadError(false);
    if (more) setLoadingMore(true); else { setLoading(true); setLoadingMore(false); }
    try {
      const cursor = more ? timelineCursor.current : null;
      const { data } = await axios.get('/api/moments', {
        params: { limit: 20, ...(cursor ? { beforeCreatedAt: cursor.created_at, beforeId: cursor.id } : {}) }, signal: ac.signal,
      });
      if (!Array.isArray(data)) throw new Error('Invalid timeline response');
      if (ac.signal.aborted) return;
      timelineCursor.current = data.at(-1) || cursor;
      setList(prev => more ? [...prev, ...data.filter(m => !prev.some(p => p.id === m.id))] : data);
      setHasMore(data.length === 20);
    } catch { if (!ac.signal.aborted) setLoadError(true); }
    finally {
      if (!ac.signal.aborted) { setLoading(false); setLoadingMore(false); timelineRequest.current = null; }
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始请求与手动刷新共用可取消的加载流程
    load();
    return () => timelineRequest.current?.abort();
  }, [load]);

  const loadSettings = useCallback(async (signal) => {
    try {
      const { data } = await axios.get('/api/users/me/settings', { signal });
      if (!signal?.aborted) { setVisibleDays(Number(data.momentsVisibleDays) || 0); setSettingsError(false); }
    } catch { if (!signal?.aborted) setSettingsError(true); }
  }, []);
  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 状态仅在可取消的异步设置请求完成后更新
    loadSettings(ac.signal);
    return () => ac.abort();
  }, [loadSettings]);

  // 分组可见：首次需要选人时按需加载联系人
  const ensureFriends = useCallback(() => {
    if (friends.length) return;
    axios.get('/api/users/contacts').then(r => setFriends(r.data || [])).catch(() => {});
  }, [friends.length]);

  const saveVisibleDays = async (d) => {
    if (savingDaysRef.current || visibleDays === null || visibleDays === d) return;
    savingDaysRef.current = true;
    setSavingDays(true);
    setSettingsError(false);
    try {
      await axios.put('/api/users/me/settings', { momentsVisibleDays: d });
      setVisibleDays(d);
    } catch { setSettingsError(true); }
    finally { savingDaysRef.current = false; setSavingDays(false); }
  };

  // 互动通知未读数（谁赞了/评论了我的动态）
  const loadNotifCount = useCallback(() => {
    axios.get('/api/moments/notifications/unread-count')
      .then(r => setNotifCount(r.data.count || 0)).catch(() => {});
  }, []);
  useEffect(() => { loadNotifCount(); }, [loadNotifCount]);

  // 实时朋友圈（对齐安卓/iOS）：socket 广播 → 刷新互动红点；好友发新动态 → 刷新 feed
  useEffect(() => {
    const onMoment = (e) => {
      loadNotifCount();
      if (e?.detail?.type === 'new_moment') load();
    };
    window.addEventListener('touliao:moment', onMoment);
    return () => window.removeEventListener('touliao:moment', onMoment);
  }, [load, loadNotifCount]);

  useEffect(() => {
    const handler = e => {
      if (e.key !== 'Escape') return;
      if (notifList !== null) { notifRequest.current?.abort(); notifReadRequest.current?.abort(); setNotifList(null); return; }
      if (showFriendPicker) { setShowFriendPicker(false); return; }
      if (showSettings) { setShowSettings(false); return; }
      if (editing && !savingEdit) setEditing(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [notifList, showFriendPicker, showSettings, editing, savingEdit]);

  const closeNotif = () => { notifRequest.current?.abort(); notifReadRequest.current?.abort(); setNotifList(null); };
  const openNotif = async (more = false) => {
    if (more && notifBusy.current) return;
    notifRequest.current?.abort();
    const ac = new AbortController();
    notifRequest.current = ac;
    notifBusy.current = true;
    setNotifLoading(true);
    setNotifError(false);
    if (!more) { setNotifList([]); setNotifHasMore(false); setNotifReadError(false); notifOffset.current = 0; }
    try {
      const { data } = await axios.get('/api/moments/notifications', { params: { limit: 30, offset: notifOffset.current }, signal: ac.signal });
      if (!Array.isArray(data?.items) || data.items.some(n => !n || typeof n.id !== 'string')) throw new Error('Invalid notifications response');
      if (ac.signal.aborted) return;
      setNotifList(prev => more ? [...(prev || []), ...data.items.filter(n => !prev?.some(p => p.id === n.id))] : data.items);
      notifOffset.current += data.items.length;
      setNotifHasMore(!!data.hasMore && data.items.length > 0);
      if (!more) setNotifReady(n => n + 1);
    } catch { if (!ac.signal.aborted) setNotifError(true); }
    finally { if (!ac.signal.aborted) { setNotifLoading(false); notifBusy.current = false; } }
  };
  // 仅在成功读取并提交通知列表后标记已读；读取/标记失败都保留未读数。
  useEffect(() => {
    if (!notifReady) return;
    if (notifRequest.current?.signal.aborted) return;
    const ac = new AbortController();
    notifReadRequest.current = ac;
    const signal = ac.signal;
    axios.post('/api/moments/notifications/read', {}, { signal })
      .then(() => { if (!signal?.aborted) { setNotifReadError(false); loadNotifCount(); } })
      .catch(() => { if (!signal.aborted) setNotifReadError(true); });
    return () => ac.abort();
  }, [notifReady, loadNotifCount]);
  useEffect(() => () => notifRequest.current?.abort(), []);

  const ALLOWED_IMG_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const handleImagePick = (e) => {
    const files = Array.from(e.target.files || []);
    const remaining = 9 - images.length;
    if (remaining <= 0) {
      showToast(t('moments.maxImagesError'), 'error');
      e.target.value = '';
      return;
    }
    // 选择数量超过剩余名额时,截断并明确告知被丢弃了几张,而非静默忽略
    if (files.length > remaining) {
      showToast(t('moments.imagesTruncatedTemplate').replace('{n}', files.length - remaining), 'info');
    }
    files.slice(0, remaining).forEach(file => {
      if (!ALLOWED_IMG_TYPES.includes(file.type)) {
        showToast(t('moments.imageTypeErrorTemplate').replace('{name}', file.name), 'error');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast(t('moments.imageSizeErrorTemplate').replace('{name}', file.name), 'error');
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      setImages(prev => [...prev, { previewUrl, file }]);
    });
    e.target.value = '';
  };

  const removeImage = (idx) => {
    setImages(prev => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const clearImages = () => {
    images.forEach(img => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
  };

  const clearVideo = () => {
    if (video) URL.revokeObjectURL(video.previewUrl);
    setVideo(null);
  };

  const changeMediaMode = (mode) => {
    if (mode === mediaMode) return;
    if (mode === 'video') clearImages();
    else clearVideo();
    setMediaMode(mode);
  };

  const handleVideoPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const error = validateMomentVideo(file);
    if (error) {
      const key = error === 'empty' ? 'moments.videoEmptyError'
        : error === 'too-large' ? 'moments.videoSizeError'
          : 'moments.videoTypeError';
      showToast(t(key), 'error');
      return;
    }
    clearVideo();
    setVideo({ previewUrl: URL.createObjectURL(file), file });
  };

  const resetCompose = () => {
    clearImages();
    clearVideo();
    setMediaMode('images');
    setText('');
    setVisibility('all');
    setVisibleTo([]);
    setComposing(false);
  };

  const onVisibilityChange = (v) => {
    setVisibility(v);
    if (v === 'include' || v === 'exclude') { ensureFriends(); setShowFriendPicker(true); }
  };

  const toggleVisibleFriend = (id) => {
    setVisibleTo(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const publish = async () => {
    if (posting) return;                 // 防连点：发布中禁止重复提交
    if (!text.trim() && images.length === 0 && !video) return;
    if (visibility === 'include' && visibleTo.length === 0) {
      setShowFriendPicker(true); return;
    }
    setPosting(true);
    try {
      let uploadedVideo = '';
      let imageUrls = [];
      if (mediaMode === 'video' && video) {
        setUploadPct(0);
        const fd = new FormData();
        fd.append('video', video.file);
        const { data } = await axios.post('/api/moments/video', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            if (e.total) setUploadPct(Math.min(99, Math.round((e.loaded / e.total) * 100)));
          },
          timeout: 600000,
        });
        setUploadPct(100);
        uploadedVideo = data.url || '';
      } else if (images.length > 0) {
        setUploadPct(0);
        const fd = new FormData();
        images.forEach(img => fd.append('images', img.file));
        const { data } = await axios.post('/api/moments/images', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            if (e.total) setUploadPct(Math.min(99, Math.round((e.loaded / e.total) * 100)));
          },
          timeout: 180000, // 最多9张图一起传，全局20s默认不够
        });
        setUploadPct(100);
        imageUrls = data.urls || [];
      }
      const payload = mediaMode === 'video'
        ? { content: text.trim(), video: uploadedVideo, visibility }
        : { content: text.trim(), images: imageUrls, visibility };
      if (visibility === 'include' || visibility === 'exclude') payload.visibleTo = visibleTo;
      const { data } = await axios.post('/api/moments', payload);
      setList(p => [data, ...p.filter(m => m.id !== data.id)]);
      resetCompose();
    } catch (e) { showToast(e.response?.data?.error || t('moments.publishFailed'), 'error'); }
    setUploadPct(null);
    setPosting(false);
  };

  const onLike = useCallback(async (m) => {
    if (likingRef.current[m.id]) return;
    likingRef.current[m.id] = true;
    try {
      const { data } = await axios.post(`/api/moments/${m.id}/like`);
      setList(p => p.map(x => {
        if (x.id !== m.id) return x;
        const likes = data.liked
          ? [...(x.likes || []), { user_id: meId, username: user?.username }]
          : (x.likes || []).filter(l => l.user_id !== meId);
        return { ...x, liked: data.liked, likeCount: data.likeCount, likes };
      }));
    } catch { /* like request failed; state reverts via finally */ }
    finally { likingRef.current[m.id] = false; }
  }, [meId, user?.username]);

  const onComment = useCallback(async (m, content, clear, replyToUser) => {
    try {
      const body = replyToUser ? { content, replyToUser } : { content };
      const { data } = await axios.post(`/api/moments/${m.id}/comment`, body);
      setList(p => p.map(x => x.id === m.id ? { ...x, comments: [...(x.comments || []), data], commentCount: (x.commentCount || 0) + 1 } : x));
      clear();
    } catch (e) { showToast(e.response?.data?.error || t('moments.commentFailed'), 'error'); }
  }, [t]);

  // 热门动态：timeline 只返回前 N 条评论，点「查看全部」时分页拉全量替换
  const onLoadComments = useCallback(async (m) => {
    let all = [], offset = 0;
    for (;;) {
      const { data } = await axios.get(`/api/moments/${m.id}/comments`, { params: { limit: 50, offset } });
      all = all.concat(data.items || []);
      if (!data.hasMore || (data.items || []).length === 0) break;
      offset += 50;
    }
    setList(p => p.map(x => x.id === m.id ? { ...x, comments: all, commentCount: all.length } : x));
  }, []);

  const onDelete = useCallback(async (m) => {
    if (!(await showConfirm(t('moments.confirmDeleteMoment')))) return;
    try { await axios.delete(`/api/moments/${m.id}`); setList(p => p.filter(x => x.id !== m.id)); }
    catch (e) { showToast(e.response?.data?.error || t('moments.deleteFailed'), 'error'); }
  }, [t]);

  const onReport = useCallback(async (m) => {
    if (!(await showConfirm(t('moments.confirmReport')))) return;
    try {
      await axios.post(`/api/moments/${m.id}/report`, {});
      showToast(t('moments.reportThanks'), 'success');
    } catch (e) {
      showToast(e.response?.status === 409 ? t('moments.alreadyReported') : (e.response?.data?.error || t('moments.reportFailed')), e.response?.status === 409 ? 'info' : 'error');
    }
  }, [t]);

  const onEdit = useCallback((m) => {
    setEditing(m);
    setEditText(m.content || '');
  }, []);

  const saveEdit = async () => {
    if (savingEdit || !editing) return;
    const val = editText.trim();
    if (!val) { showToast(t('moments.contentEmpty'), 'error'); return; }
    if (val === (editing.content || '')) { setEditing(null); return; }
    setSavingEdit(true);
    try {
      const { data } = await axios.put(`/api/moments/${editing.id}`, { content: val });
      setList(p => p.map(x => x.id === editing.id ? { ...x, ...data } : x));
      setEditing(null);
    } catch (e) {
      showToast(e.response?.data?.error || t('moments.saveFailed'), 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const onDeleteComment = useCallback(async (m, c) => {
    // 删评论前确认，与「删除动态」及移动端一致，避免误删
    if (!(await showConfirm(t('moments.confirmDeleteComment')))) return;
    try {
      await axios.delete(`/api/moments/comments/${c.id}`);
      setList(p => p.map(x => x.id === m.id ? { ...x, comments: x.comments.filter(cc => cc.id !== c.id), commentCount: x.commentCount - 1 } : x));
    } catch (e) { showToast(e.response?.data?.error || t('moments.deleteFailed'), 'error'); }
  }, [t]);

  return (
    <div className="moments-root">
      {/* 互动通知入口 */}
      <div className="wc-moment-notif-bar">
        <button className="wc-moment-notif-open" onClick={() => openNotif()}>
        <span className="wc-moment-notif-icon"><TouliaoIcon name="notification" size="sm" /></span>
        <span className="wc-moment-notif-label">{t('moments.notifications')}</span>
        {notifCount > 0 && <span className="wc-moment-notif-badge">{notifCount > 99 ? '99+' : notifCount}</span>}
        </button>
        <button
          className="wc-moment-settings-btn"
          title={t('moments.settingsTitle')}
          aria-label={t('moments.settingsTitle')}
          onClick={e => { e.stopPropagation(); setShowSettings(true); }}
        ><TouliaoIcon name="settings" size="sm" /></button>
      </div>

      {/* 朋友圈设置：最近 N 天可见 */}
      {showSettings && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && setShowSettings(false)}>
          <div ref={settingsDialog} className="wc-modal moments-modal-sm" role="dialog" aria-modal="true" aria-label={t('moments.settingsTitle')}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">{t('moments.settingsTitle')}</span>
              <button className="wc-modal-close" onClick={() => setShowSettings(false)} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
            </div>
            <div className="moments-modal-section">
              <div className="moments-modal-desc">{t('moments.visibilityRangeDesc')}</div>
              {savingDays && <div role="status">{t('moments.savingEllipsis')}</div>}
              {visibleDays === null && !settingsError && <div role="status">{t('common.loading')}</div>}
              {settingsError && <div role="alert" className="moments-error">
                {t(visibleDays === null ? 'moments.loadFailed' : 'moments.saveFailed')}
                {visibleDays === null && <button onClick={() => loadSettings()}>{t('common.retry')}</button>}
              </div>}
              <div role="radiogroup" aria-label={t('moments.visibilityRangeAriaLabel')}>
                {[{ d: 0, label: t('moments.visAll') }, { d: 1, label: t('moments.vis1Day') }, { d: 3, label: t('moments.vis3Days') }, { d: 30, label: t('moments.vis1Month') }].map(o => (
                  <button key={o.d} className="wc-moment-vis-opt moments-vis-opt-row"
                    role="radio" aria-checked={visibleDays === o.d} disabled={savingDays || visibleDays === null}
                    onClick={() => saveVisibleDays(o.d)}>
                    <span>{o.label}</span>
                    {visibleDays === o.d && <span className="moments-check-green"><TouliaoIcon name="check" size="xs" /></span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 编辑动态：仅改文字内容（图片保持不变） */}
      {editing && (
        <div className="wc-modal-overlay"
          onClick={e => e.target === e.currentTarget && !savingEdit && setEditing(null)}>
          <div className="wc-modal moments-modal-md" role="dialog" aria-modal="true" aria-label={t('moments.editMoment')}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">{t('moments.editMoment')}</span>
              <button className="wc-modal-close" onClick={() => !savingEdit && setEditing(null)} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
            </div>
            <div className="moments-modal-pad16">
              <textarea autoFocus value={editText} onChange={e => setEditText(e.target.value)}
                rows={4} maxLength={5000} aria-label={t('moments.editMomentContentAriaLabel')}
                className="moments-edit-textarea" />
              {editing.images?.length > 0 && (
                <div className="moments-edit-note">{t('moments.imagesNotEditableTemplate').replace('{n}', editing.images.length)}</div>
              )}
            </div>
            <div className="moments-modal-footer">
              <button className="wc-moment-editor-cancel moments-mr-8" onClick={() => setEditing(null)} disabled={savingEdit}>{t('common.cancel')}</button>
              <button className="wc-moment-editor-publish" onClick={saveEdit} disabled={savingEdit || !editText.trim()}>
                {savingEdit ? t('moments.savingEllipsis') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分组可见：选择好友 */}
      {showFriendPicker && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && setShowFriendPicker(false)}>
          <div className="wc-modal moments-modal-md" role="dialog" aria-modal="true" aria-label={t('moments.chooseFriends')}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">{visibility === 'include' ? t('moments.chooseVisibleFriends') : t('moments.chooseHiddenFriends')}</span>
              <button className="wc-modal-close" onClick={() => setShowFriendPicker(false)} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
            </div>
            <div className="wc-moment-notif-list moments-friend-list">
              {friends.length === 0 ? (
                <div role="status" className="wc-moment-state moments-state-pad40">{t('moments.noFriends')}</div>
              ) : friends.map(f => {
                const checked = visibleTo.includes(f.id);
                return (
                  <div key={f.id} className="wc-moment-notif-item moments-cursor-pointer"
                    role="checkbox" tabIndex={0} aria-checked={checked}
                    onClick={() => toggleVisibleFriend(f.id)}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleVisibleFriend(f.id)}>
                    <Avatar src={f.avatar} name={f.remark || f.username} size='sm' />
                    <div className="wc-moment-notif-body">
                      <div className="wc-moment-notif-text">{f.remark || f.username}</div>
                    </div>
                    <span className="moments-check-circle" style={{ border: `2px solid ${checked ? 'var(--green)' : 'var(--border-medium)'}`, background: checked ? 'var(--green)' : 'var(--bg-card)' }}>{checked ? <TouliaoIcon name="check" size="xs" /> : null}</span>
                  </div>
                );
              })}
            </div>
            <div className="moments-modal-footer">
              <button className="wc-moment-editor-publish" onClick={() => setShowFriendPicker(false)}>
                {t('moments.confirmCountTemplate').replace('{n}', visibleTo.length)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 互动通知面板 */}
      {notifList !== null && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && closeNotif()}>
          <div ref={notificationsDialog} className="wc-modal moments-modal-md" role="dialog" aria-modal="true" aria-label={t('moments.notifications')}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">{t('moments.notifications')}</span>
              <button className="wc-modal-close" onClick={closeNotif} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
            </div>
            <div className="wc-moment-notif-list">
              {notifError && <div role="alert" className="wc-moment-state moments-state-pad40">
                {t('moments.loadFailed')} <button onClick={() => openNotif(notifList.length > 0)}>{t('common.retry')}</button>
              </div>}
              {notifReadError && <div role="alert" className="moments-error">
                {t('moments.readFailed')} <button onClick={() => setNotifReady(n => n + 1)}>{t('common.retry')}</button>
              </div>}
              {notifList.length === 0 && !notifLoading && !notifError ? (
                <div role="status" className="wc-moment-state moments-state-pad40">{t('moments.noNotifications')}</div>
              ) : notifList.map(n => (
                <div key={n.id} className="wc-moment-notif-item">
                  <Avatar src={n.actor?.avatar} name={n.actor?.username} size='sm' />
                  <div className="wc-moment-notif-body">
                    <div className="wc-moment-notif-text">
                      <b>{n.actor?.username || t('moments.defaultUser')}</b>
                      {n.type === 'like' ? t('moments.likedYourMoment') : t('moments.commentedTemplate').replace('{content}', n.commentContent || '')}
                    </div>
                    <div className="wc-moment-notif-time">{ago(n.createdAt)}</div>
                  </div>
                  {n.moment?.thumb
                    ? <img className="wc-moment-notif-thumb" src={n.moment.thumb} alt={t('moments.momentImageAlt')} loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />
                    : <div className="wc-moment-notif-snippet">{(n.moment?.content || '').slice(0, 12)}</div>}
                </div>
              ))}
              {notifLoading && <div role="status" className="wc-moment-state moments-state-pad40">{t('common.loading')}</div>}
              {notifHasMore && !notifError && <button className="moments-load-more" disabled={notifLoading} onClick={() => openNotif(true)}>{t('common.loadMore')}</button>}
            </div>
          </div>
        </div>
      )}

      {/* 发布区 */}
      <div className="wc-moment-publish-bar">
        {!composing ? (
          <button className="wc-moment-composer" onClick={() => setComposing(true)}>
            {t('moments.shareNewMoment')}
          </button>
        ) : (
          <div className="wc-moment-editor">
            <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={3}
              placeholder={t('moments.thoughtPlaceholder')} maxLength={5000} aria-label={t('moments.publishAriaLabel')} />
            {/* 图片预览区 */}
            {images.length > 0 && (
              <div className="wc-moment-img-preview">
                {images.map((img, i) => (
                  <div key={i} className="wc-moment-img-thumb">
                    <img src={img.previewUrl} alt={t('moments.pendingImageAltTemplate').replace('{n}', i + 1)} loading="lazy" />
                    <button className="wc-moment-img-remove" onClick={() => removeImage(i)} aria-label={t('moments.removeImageTemplate').replace('{n}', i + 1)}><TouliaoIcon name="close" size="sm" /></button>
                  </div>
                ))}
              </div>
            )}
            {video && (
              <div className="wc-moment-video-compose">
                <video src={video.previewUrl} controls preload="metadata" playsInline />
                <button type="button" onClick={clearVideo} aria-label={t('moments.removeVideo')}><TouliaoIcon name="close" size="sm" /></button>
              </div>
            )}
            <div className="wc-moment-media-modes" role="radiogroup" aria-label={t('moments.mediaMode')}>
              <button type="button" role="radio" aria-checked={mediaMode === 'images'} className={mediaMode === 'images' ? 'active' : ''} onClick={() => changeMediaMode('images')}>{t('moments.imageMode')}</button>
              <button type="button" role="radio" aria-checked={mediaMode === 'video'} className={mediaMode === 'video' ? 'active' : ''} onClick={() => changeMediaMode('video')}>{t('moments.videoMode')}</button>
            </div>
            <div className="wc-moment-editor-actions">
              {mediaMode === 'images' ? <button className="wc-moment-img-btn" onClick={() => imgInputRef.current?.click()}
                disabled={images.length >= 9} title={t('moments.addImage')} aria-label={`${t('moments.addImage')}${images.length > 0 ? t('moments.addImageCountSuffixTemplate').replace('{n}', images.length) : ''}`}>
                <TouliaoIcon name="image" size="sm" /> {t('moments.imagesLabel')}{images.length > 0 ? ` (${images.length}/9)` : ''}
              </button> : <button className="wc-moment-img-btn" type="button" onClick={() => videoInputRef.current?.click()} disabled={!!video}>
                <TouliaoIcon name="video" size="sm" /> {video ? t('moments.videoSelected') : t('moments.selectVideo')}
              </button>}
              <input ref={imgInputRef} type="file" accept="image/*" multiple className="moments-hidden-input"
                onChange={handleImagePick} />
              <input ref={videoInputRef} type="file" accept="video/*" className="moments-hidden-input" onChange={handleVideoPick} />
              <select className="wc-moment-vis-select" value={visibility}
                onChange={e => onVisibilityChange(e.target.value)} title={t('moments.whoCanSee')}>
                <option value="all">{t('moments.visPublic')}</option>
                <option value="friends">{t('moments.visFriendsOnly')}</option>
                <option value="private">{t('moments.visPrivate')}</option>
                <option value="include">{t('moments.visInclude')}</option>
                <option value="exclude">{t('moments.visExclude')}</option>
              </select>
              {(visibility === 'include' || visibility === 'exclude') && (
                <button className="wc-moment-img-btn" type="button"
                  onClick={() => { ensureFriends(); setShowFriendPicker(true); }}
                  title={t('moments.chooseFriends')}>
                  {visibility === 'include' ? t('moments.visibleLabel') : t('moments.hiddenLabel')} ({visibleTo.length})
                </button>
              )}
              <div className="moments-spacer" />
              <button className="wc-moment-editor-cancel"
                onClick={resetCompose}>{t('common.cancel')}</button>
              <button className="wc-moment-editor-publish"
                disabled={posting || (!text.trim() && images.length === 0 && !video)} onClick={publish}>
                {posting
                  ? (uploadPct !== null && uploadPct < 100 ? t('moments.uploadingTemplate').replace('{pct}', uploadPct) : t('moments.publishing'))
                  : t('moments.publish')}
              </button>
            </div>
            <UploadProgressBar
              uploadState={uploadPct === null ? null : {
                name: mediaMode === 'video' ? (video?.file.name || t('moments.videoMode')) : t('moments.imagesLabel'),
                progress: uploadPct,
                status: 'uploading',
              }}
              onCancel={() => {}}
            />
          </div>
        )}
      </div>

      {/* 时间线 */}
      <div className="wc-moment-scroll">
        {loading ? (
          <MomentsSkeleton />
        ) : loadError && list.length === 0 ? (
          <div role="status" className="wc-moment-state moments-state-pad60">
            {t('moments.loadFailed')}，<button className="wc-moment-expand-btn" onClick={() => load()}>{t('moments.clickRetry')}</button>
          </div>
        ) : list.length === 0 ? (
          <div role="status" className="wc-moment-state moments-state-pad60">{t('moments.emptyFeed')}</div>
        ) : (
          list.map(m => (
            <MomentCard key={m.id} m={m} meId={meId}
              onLike={onLike} onComment={onComment} onDelete={onDelete} onDeleteComment={onDeleteComment}
              onLoadComments={onLoadComments} onReport={onReport} onEdit={onEdit} />
          ))
        )}
        {!loading && list.length > 0 && (hasMore || loadError) && (
          <div className="moments-pagination">
            {loadError && <div role="alert">{t('moments.loadFailed')}</div>}
            <button className="moments-load-more" disabled={loadingMore} onClick={() => load(true)}>
              {loadingMore ? t('common.loading') : t(loadError ? 'common.retry' : 'common.loadMore')}
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
