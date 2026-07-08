import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import ImagePreview from './ImagePreview';
import { useAuth } from '../contexts/AuthContext';
import { showToast, showConfirm } from '../utils/toast';
import { getAspect, rememberAspect } from '../utils/imgDimCache';

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
const MomentCard = memo(function MomentCard({ m, meId, onLike, onComment, onDelete, onDeleteComment, onLoadComments }) {
  const [commenting, setCommenting] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null); // { userId, username } | null：回复某条评论
  const [submitting, setSubmitting] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { urls, idx } | null
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
      <Avatar src={m.author?.avatar} name={m.author?.username} size={42} />
      <div className="wc-moment-body">
        <div className="wc-moment-header">
          <span className="wc-moment-name">{m.author?.username || '用户'}</span>
          {m.user_id === meId && (
            <button className="wc-moment-delete" onClick={() => onDelete(m)}>删除</button>
          )}
        </div>
        {m.content && (() => {
          const needsTruncate = m.content.length > CONTENT_LIMIT;
          const display = needsTruncate && !expanded ? m.content.slice(0, CONTENT_LIMIT) + '…' : m.content;
          return (
            <div className="wc-moment-text">
              {display}
              {needsTruncate && (
                <button className="wc-moment-expand-btn" onClick={() => setExpanded(v => !v)}>
                  {expanded ? '收起' : '查看全文'}
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
              const aspect = getAspect(single);
              return (
                <div className="wc-moment-images single">
                  <img loading="lazy" src={single} alt="图片"
                    className="wc-moment-single-img"
                    style={aspect ? { aspectRatio: String(aspect) } : undefined}
                    role="button" tabIndex={0} aria-label="查看大图"
                    onLoad={e => { rememberAspect(single, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight); e.currentTarget.classList.add('loaded'); }}
                    onError={e => { e.currentTarget.classList.add('loaded'); e.currentTarget.style.display = 'none'; }}
                    onClick={() => setLightbox({ urls: m.images, idx: 0 })}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox({ urls: m.images, idx: 0 }); } }} />
                </div>
              );
            })()
          ) : (
            <div className="wc-moment-images" style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
              {m.images.map((src, i) => (
                <img loading="lazy" key={i} src={src} alt={`图片 ${i + 1}`} style={{ cursor: 'zoom-in' }}
                  role="button" tabIndex={0} aria-label={`查看第 ${i + 1} 张大图`}
                  onLoad={e => e.currentTarget.classList.add('loaded')}
                  onError={e => { e.currentTarget.classList.add('loaded'); e.currentTarget.style.display = 'none'; }}
                  onClick={() => setLightbox({ urls: m.images, idx: i })}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox({ urls: m.images, idx: i }); } }} />
              ))}
            </div>
          )
        )}
        {lightbox && (
          <ImagePreview urls={lightbox.urls} initialIdx={lightbox.idx}
            url={lightbox.urls[lightbox.idx]} onClose={() => setLightbox(null)} />
        )}

        <div className="wc-moment-actions">
          <span className="wc-moment-time">{ago(m.created_at)}</span>
          <button
            className={`wc-moment-action-btn${m.liked ? ' liked' : ''}`}
            onClick={() => { if (!m.liked) { setLikePop(true); setTimeout(() => setLikePop(false), 360); } onLike(m); }}
          >
            <svg viewBox="0 0 24 24" className={likePop ? 'wc-like-pop' : undefined}><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            {m.likeCount > 0 ? m.likeCount : '赞'}
          </button>
          <button className="wc-moment-action-btn" onClick={() => setCommenting(v => !v)}>
            <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
            {m.commentCount > 0 ? m.commentCount : '评论'}
          </button>
        </div>

        {/* 点赞者 */}
        {m.likes?.length > 0 && (
          <div className="wc-moment-likes">
            <span className="wc-moment-heart">♥ </span>
            {m.likes.map(l => l.username).join('、')}
          </div>
        )}

        {/* 评论列表 */}
        {m.comments?.length > 0 && (
          <div className="wc-moment-comments">
            {m.comments.map(c => (
              <div key={c.id} className="wc-moment-comment"
                onClick={() => startReply(c)}
                role={c.user_id === meId ? undefined : 'button'}
                tabIndex={c.user_id === meId ? undefined : 0}
                onKeyDown={e => { if (e.key === 'Enter') startReply(c); }}
                style={{ cursor: c.user_id === meId ? 'default' : 'pointer' }}>
                <span className="wc-moment-comment-user">{c.username}</span>
                {c.reply_to_username ? <span className="wc-moment-comment-reply"> 回复 {c.reply_to_username}</span> : null}
                <span>：{c.content}</span>
                {(c.user_id === meId || m.user_id === meId) && (
                  <button className="wc-moment-comment-del"
                    aria-label="删除评论" title="删除评论"
                    onClick={e => { e.stopPropagation(); onDeleteComment(m, c); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); } }}>删</button>
                )}
              </div>
            ))}
            {/* 热门动态：timeline 只返回前 N 条，按需加载全部 */}
            {hasMoreComments && (
              <button className="wc-moment-comment-viewall" disabled={loadingComments} onClick={viewAllComments}>
                {loadingComments ? '加载中…' : `查看全部 ${m.commentCount} 条评论`}
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
              placeholder={replyTo ? `回复 ${replyTo.username}…` : '评论…'} maxLength={500} aria-label="输入评论" />
            <button className="wc-moment-comment-submit" onClick={submit} disabled={submitting || !text.trim()}>发送</button>
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
          <div className="wc-moment-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="wc-skel wc-skel-line" style={{ width: '30%' }} />
            <div className="wc-skel wc-skel-line" style={{ width: '85%' }} />
            <div className="wc-skel wc-skel-line" style={{ width: '55%' }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="wc-skel" style={{ width: 76, height: 76, borderRadius: 6 }} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Moments() {
  const { user } = useAuth();
  const meId = user?.id;
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState('');
  const [images, setImages] = useState([]); // [{previewUrl, file}]
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
  const [visibleDays, setVisibleDays] = useState(0); // 最近 N 天可见：0=全部
  const imgInputRef = useRef(null);
  const likingRef = useRef({});
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => () => { imagesRef.current.forEach(img => URL.revokeObjectURL(img.previewUrl)); }, []);

  const load = useCallback(() => {
    setLoading(true);
    axios.get('/api/moments')
      .then(r => { setList(r.data); setLoadError(false); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // 朋友圈"最近 N 天可见"设置初值
  useEffect(() => {
    axios.get('/api/users/me/settings')
      .then(r => setVisibleDays(Number(r.data?.momentsVisibleDays) || 0)).catch(() => {});
  }, []);

  // 分组可见：首次需要选人时按需加载联系人
  const ensureFriends = useCallback(() => {
    if (friends.length) return;
    axios.get('/api/users/contacts').then(r => setFriends(r.data || [])).catch(() => {});
  }, [friends.length]);

  const saveVisibleDays = async (d) => {
    setVisibleDays(d);
    try { await axios.put('/api/users/me/settings', { momentsVisibleDays: d }); }
    catch { /* 静默失败，下次进入重置 */ }
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
    window.addEventListener('vxin:moment', onMoment);
    return () => window.removeEventListener('vxin:moment', onMoment);
  }, [load, loadNotifCount]);

  useEffect(() => {
    const handler = e => {
      if (e.key !== 'Escape') return;
      if (notifList) { setNotifList(null); return; }
      if (showFriendPicker) { setShowFriendPicker(false); return; }
      if (showSettings) { setShowSettings(false); return; }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [notifList, showFriendPicker, showSettings]);

  const openNotif = async () => {
    try {
      const { data } = await axios.get('/api/moments/notifications', { params: { limit: 30 } });
      setNotifList(data || []);
      if (notifCount > 0) {
        axios.post('/api/moments/notifications/read').catch(() => {});
        setNotifCount(0);
      }
    } catch { setNotifList([]); }
  };

  const ALLOWED_IMG_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const handleImagePick = (e) => {
    const files = Array.from(e.target.files || []);
    const remaining = 9 - images.length;
    files.slice(0, remaining).forEach(file => {
      if (!ALLOWED_IMG_TYPES.includes(file.type)) {
        showToast(`${file.name} 格式不支持，仅限 JPG/PNG/GIF/WebP`, 'error');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast(`${file.name} 超过 5MB 限制`, 'error');
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

  const resetCompose = () => {
    images.forEach(img => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
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
    if (!text.trim() && images.length === 0) return;
    if (visibility === 'include' && visibleTo.length === 0) {
      setShowFriendPicker(true); return;
    }
    setPosting(true);
    try {
      let imageUrls = [];
      if (images.length > 0) {
        setUploadPct(0);
        const fd = new FormData();
        images.forEach(img => fd.append('images', img.file));
        const { data } = await axios.post('/api/moments/images', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            if (e.total) setUploadPct(Math.min(99, Math.round((e.loaded / e.total) * 100)));
          },
        });
        setUploadPct(100);
        imageUrls = data.urls || [];
      }
      const payload = { content: text.trim(), images: imageUrls, visibility };
      if (visibility === 'include' || visibility === 'exclude') payload.visibleTo = visibleTo;
      const { data } = await axios.post('/api/moments', payload);
      setList(p => [data, ...p]);
      resetCompose();
    } catch (e) { showToast(e.response?.data?.error || '发布失败', 'error'); }
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
    } catch {}
    finally { likingRef.current[m.id] = false; }
  }, [meId, user?.username]);

  const onComment = useCallback(async (m, content, clear, replyToUser) => {
    try {
      const body = replyToUser ? { content, replyToUser } : { content };
      const { data } = await axios.post(`/api/moments/${m.id}/comment`, body);
      setList(p => p.map(x => x.id === m.id ? { ...x, comments: [...(x.comments || []), data], commentCount: (x.commentCount || 0) + 1 } : x));
      clear();
    } catch (e) { showToast(e.response?.data?.error || '评论失败', 'error'); }
  }, []);

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
    if (!(await showConfirm('删除这条动态？'))) return;
    try { await axios.delete(`/api/moments/${m.id}`); setList(p => p.filter(x => x.id !== m.id)); }
    catch (e) { showToast(e.response?.data?.error || '删除失败', 'error'); }
  }, []);

  const onDeleteComment = useCallback(async (m, c) => {
    // 删评论前确认，与「删除动态」及移动端一致，避免误删
    if (!(await showConfirm('删除这条评论？'))) return;
    try {
      await axios.delete(`/api/moments/comments/${c.id}`);
      setList(p => p.map(x => x.id === m.id ? { ...x, comments: x.comments.filter(cc => cc.id !== c.id), commentCount: x.commentCount - 1 } : x));
    } catch (e) { showToast(e.response?.data?.error || '删除失败', 'error'); }
  }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 互动通知入口 */}
      <div className="wc-moment-notif-bar" onClick={openNotif} role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && openNotif()}>
        <span className="wc-moment-notif-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg></span>
        <span className="wc-moment-notif-label">互动消息</span>
        {notifCount > 0 && <span className="wc-moment-notif-badge">{notifCount > 99 ? '99+' : notifCount}</span>}
        <div style={{ flex: 1 }} />
        <button
          className="wc-moment-settings-btn"
          title="朋友圈设置"
          aria-label="朋友圈设置"
          onClick={e => { e.stopPropagation(); setShowSettings(true); }}
        ><svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 00-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg></button>
      </div>

      {/* 朋友圈设置：最近 N 天可见 */}
      {showSettings && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && setShowSettings(false)}>
          <div className="wc-modal" role="dialog" aria-modal="true" aria-label="朋友圈设置" style={{ maxWidth: 360, width: '90%' }}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">朋友圈设置</span>
              <button className="wc-modal-close" onClick={() => setShowSettings(false)} aria-label="关闭">✕</button>
            </div>
            <div style={{ padding: '8px 0' }}>
              <div style={{ padding: '10px 18px', fontSize: 13, color: 'var(--text-secondary)' }}>允许朋友查看朋友圈的范围</div>
              <div role="radiogroup" aria-label="可见范围">
                {[{ d: 0, label: '全部' }, { d: 1, label: '最近一天' }, { d: 3, label: '最近三天' }, { d: 30, label: '最近一个月' }].map(o => (
                  <div key={o.d} className="wc-moment-vis-opt"
                    role="radio" aria-checked={visibleDays === o.d} tabIndex={0}
                    onClick={() => saveVisibleDays(o.d)}
                    onKeyDown={e => e.key === 'Enter' && saveVisibleDays(o.d)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer', borderTop: '1px solid var(--border-color,#eee)' }}>
                    <span>{o.label}</span>
                    {visibleDays === o.d && <span style={{ color: 'var(--green,#07c160)' }}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 分组可见：选择好友 */}
      {showFriendPicker && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && setShowFriendPicker(false)}>
          <div className="wc-modal" role="dialog" aria-modal="true" aria-label="选择好友" style={{ maxWidth: 420, width: '90%' }}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">{visibility === 'include' ? '选择可见的好友' : '选择不给谁看'}</span>
              <button className="wc-modal-close" onClick={() => setShowFriendPicker(false)} aria-label="关闭">✕</button>
            </div>
            <div className="wc-moment-notif-list" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {friends.length === 0 ? (
                <div role="status" className="wc-moment-state" style={{ padding: 40 }}>暂无好友</div>
              ) : friends.map(f => {
                const checked = visibleTo.includes(f.id);
                return (
                  <div key={f.id} className="wc-moment-notif-item" style={{ cursor: 'pointer' }}
                    role="checkbox" tabIndex={0} aria-checked={checked}
                    onClick={() => toggleVisibleFriend(f.id)}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleVisibleFriend(f.id)}>
                    <Avatar src={f.avatar} name={f.remark || f.username} size={36} />
                    <div className="wc-moment-notif-body">
                      <div className="wc-moment-notif-text">{f.remark || f.username}</div>
                    </div>
                    <span style={{ width: 20, height: 20, borderRadius: 10, border: `2px solid ${checked ? 'var(--green,#07c160)' : '#ccc'}`, background: checked ? 'var(--green,#07c160)' : 'var(--text-inverse)', color: 'var(--text-inverse)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{checked ? '✓' : ''}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: 12, textAlign: 'right', borderTop: '1px solid var(--border-color,#eee)' }}>
              <button className="wc-moment-editor-publish" onClick={() => setShowFriendPicker(false)}>
                确定 ({visibleTo.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 互动通知面板 */}
      {notifList !== null && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && setNotifList(null)}>
          <div className="wc-modal" role="dialog" aria-modal="true" aria-label="互动消息" style={{ maxWidth: 420, width: '90%' }}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">互动消息</span>
              <button className="wc-modal-close" onClick={() => setNotifList(null)} aria-label="关闭">✕</button>
            </div>
            <div className="wc-moment-notif-list">
              {notifList.length === 0 ? (
                <div role="status" className="wc-moment-state" style={{ padding: 40 }}>暂无互动消息</div>
              ) : notifList.map(n => (
                <div key={n.id} className="wc-moment-notif-item">
                  <Avatar src={n.actor?.avatar} name={n.actor?.username} size={36} />
                  <div className="wc-moment-notif-body">
                    <div className="wc-moment-notif-text">
                      <b>{n.actor?.username || '用户'}</b>
                      {n.type === 'like' ? ' 赞了你的动态' : ` 评论：${n.commentContent || ''}`}
                    </div>
                    <div className="wc-moment-notif-time">{ago(n.createdAt)}</div>
                  </div>
                  {n.moment?.thumb
                    ? <img className="wc-moment-notif-thumb" src={n.moment.thumb} alt="动态图片" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />
                    : <div className="wc-moment-notif-snippet">{(n.moment?.content || '').slice(0, 12)}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 发布区 */}
      <div className="wc-moment-publish-bar">
        {!composing ? (
          <button className="wc-moment-composer" onClick={() => setComposing(true)}>
            分享新动态…
          </button>
        ) : (
          <div className="wc-moment-editor">
            <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={3}
              placeholder="这一刻的想法…" maxLength={5000} aria-label="发布动态" />
            {/* 图片预览区 */}
            {images.length > 0 && (
              <div className="wc-moment-img-preview">
                {images.map((img, i) => (
                  <div key={i} className="wc-moment-img-thumb">
                    <img src={img.previewUrl} alt={`待发布图片 ${i + 1}`} loading="lazy" />
                    <button className="wc-moment-img-remove" onClick={() => removeImage(i)} aria-label={`移除图片 ${i + 1}`}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="wc-moment-editor-actions">
              <button className="wc-moment-img-btn" onClick={() => imgInputRef.current?.click()}
                disabled={images.length >= 9} title="添加图片" aria-label={`添加图片${images.length > 0 ? `，已选 ${images.length}/9` : ''}`}>
                🖼 图片{images.length > 0 ? ` (${images.length}/9)` : ''}
              </button>
              <input ref={imgInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={handleImagePick} />
              <select className="wc-moment-vis-select" value={visibility}
                onChange={e => onVisibilityChange(e.target.value)} title="谁可以看">
                <option value="all">🌐 公开</option>
                <option value="friends">👥 仅好友</option>
                <option value="private">🔒 仅自己</option>
                <option value="include">✅ 部分可见</option>
                <option value="exclude">🚫 不给谁看</option>
              </select>
              {(visibility === 'include' || visibility === 'exclude') && (
                <button className="wc-moment-img-btn" type="button"
                  onClick={() => { ensureFriends(); setShowFriendPicker(true); }}
                  title="选择好友">
                  {visibility === 'include' ? '可见' : '不给看'} ({visibleTo.length})
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="wc-moment-editor-cancel"
                onClick={resetCompose}>取消</button>
              <button className="wc-moment-editor-publish"
                disabled={posting || (!text.trim() && images.length === 0)} onClick={publish}>
                {posting
                  ? (uploadPct !== null && uploadPct < 100 ? `上传中 ${uploadPct}%` : '发布中…')
                  : '发布'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 时间线 */}
      <div className="wc-moment-scroll">
        {loading ? (
          <MomentsSkeleton />
        ) : loadError && list.length === 0 ? (
          <div role="status" className="wc-moment-state" style={{ padding: 60 }}>
            加载失败，<button className="wc-moment-expand-btn" onClick={load}>点击重试</button>
          </div>
        ) : list.length === 0 ? (
          <div role="status" className="wc-moment-state" style={{ padding: 60 }}>还没有动态，发布第一条吧</div>
        ) : (
          list.map(m => (
            <MomentCard key={m.id} m={m} meId={meId}
              onLike={onLike} onComment={onComment} onDelete={onDelete} onDeleteComment={onDeleteComment}
              onLoadComments={onLoadComments} />
          ))
        )}
      </div>

    </div>
  );
}
