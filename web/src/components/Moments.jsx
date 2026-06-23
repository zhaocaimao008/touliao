import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { useAuth } from '../contexts/AuthContext';
import { showToast, showConfirm } from '../utils/toast';

function ago(sec) {
  const d = Date.now() / 1000 - sec;
  if (d < 60) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + '分钟前';
  if (d < 86400) return Math.floor(d / 3600) + '小时前';
  if (d < 2592000) return Math.floor(d / 86400) + '天前';
  return new Date(sec * 1000).toLocaleDateString('zh-CN');
}

/* 单条动态 */
function MomentCard({ m, meId, onLike, onComment, onDelete, onDeleteComment, onLoadComments }) {
  const [commenting, setCommenting] = useState(false);
  const [text, setText] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);

  const viewAllComments = async () => {
    setLoadingComments(true);
    try { await onLoadComments(m); } finally { setLoadingComments(false); }
  };
  const hasMoreComments = (m.commentCount || 0) > (m.comments?.length || 0);

  const submit = () => {
    if (!text.trim()) return;
    onComment(m, text.trim(), () => { setText(''); setCommenting(false); });
  };

  const gridCols = m.images?.length ? Math.min(m.images.length, 3) : 1;

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
        {m.content && <div className="wc-moment-text">{m.content}</div>}

        {/* 图片九宫格 */}
        {m.images?.length > 0 && (
          <div className="wc-moment-images" style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
            {m.images.map((src, i) => (
              <img loading="lazy" key={i} src={src} alt="" />
            ))}
          </div>
        )}

        <div className="wc-moment-actions">
          <span className="wc-moment-time">{ago(m.created_at)}</span>
          <button
            className={`wc-moment-action-btn${m.liked ? ' liked' : ''}`}
            onClick={() => onLike(m)}
          >
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
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
              <div key={c.id} className="wc-moment-comment">
                <span className="wc-moment-comment-user">{c.username}</span>
                {c.reply_to_user ? <span className="wc-moment-comment-reply"> 回复 {c.reply_to_user}</span> : null}
                <span>：{c.content}</span>
                {(c.user_id === meId || m.user_id === meId) && (
                  <button className="wc-moment-comment-del" onClick={() => onDeleteComment(m, c)}>删</button>
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
              onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setCommenting(false); }}
              placeholder="评论…" maxLength={500} />
            <button className="wc-moment-comment-submit" onClick={submit}>发送</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Moments() {
  const { user } = useAuth();
  const meId = user?.id;
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [images, setImages] = useState([]); // [{previewUrl, file}]
  const [posting, setPosting] = useState(false);
  const [composing, setComposing] = useState(false);
  const imgInputRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    axios.get('/api/moments').then(r => setList(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleImagePick = (e) => {
    const files = Array.from(e.target.files || []);
    const remaining = 9 - images.length;
    files.slice(0, remaining).forEach(file => {
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
    setComposing(false);
  };

  const publish = async () => {
    if (!text.trim() && images.length === 0) return;
    setPosting(true);
    try {
      let imageUrls = [];
      if (images.length > 0) {
        const fd = new FormData();
        images.forEach(img => fd.append('images', img.file));
        const { data } = await axios.post('/api/moments/images', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        imageUrls = data.urls || [];
      }
      const { data } = await axios.post('/api/moments', { content: text.trim(), images: imageUrls });
      setList(p => [data, ...p]);
      resetCompose();
    } catch (e) { showToast(e.response?.data?.error || '发布失败', 'error'); }
    setPosting(false);
  };

  const onLike = async (m) => {
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
  };

  const onComment = async (m, content, clear) => {
    try {
      const { data } = await axios.post(`/api/moments/${m.id}/comment`, { content });
      setList(p => p.map(x => x.id === m.id ? { ...x, comments: [...(x.comments || []), data], commentCount: (x.commentCount || 0) + 1 } : x));
      clear();
    } catch (e) { showToast(e.response?.data?.error || '评论失败', 'error'); }
  };

  // 热门动态：timeline 只返回前 N 条评论，点「查看全部」时分页拉全量替换
  const onLoadComments = async (m) => {
    let all = [], offset = 0;
    for (;;) {
      const { data } = await axios.get(`/api/moments/${m.id}/comments`, { params: { limit: 50, offset } });
      all = all.concat(data.items || []);
      if (!data.hasMore || (data.items || []).length === 0) break;
      offset += 50;
    }
    setList(p => p.map(x => x.id === m.id ? { ...x, comments: all, commentCount: all.length } : x));
  };

  const onDelete = async (m) => {
    if (!(await showConfirm('删除这条动态？'))) return;
    try { await axios.delete(`/api/moments/${m.id}`); setList(p => p.filter(x => x.id !== m.id)); } catch {}
  };

  const onDeleteComment = async (m, c) => {
    try {
      await axios.delete(`/api/moments/comments/${c.id}`);
      setList(p => p.map(x => x.id === m.id ? { ...x, comments: x.comments.filter(cc => cc.id !== c.id), commentCount: x.commentCount - 1 } : x));
    } catch {}
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 发布区 */}
      <div className="wc-moment-publish-bar">
        {!composing ? (
          <button className="wc-moment-composer" onClick={() => setComposing(true)}>
            分享新动态…
          </button>
        ) : (
          <div className="wc-moment-editor">
            <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={3}
              placeholder="这一刻的想法…" maxLength={5000} />
            {/* 图片预览区 */}
            {images.length > 0 && (
              <div className="wc-moment-img-preview">
                {images.map((img, i) => (
                  <div key={i} className="wc-moment-img-thumb">
                    <img src={img.previewUrl} alt="" loading="lazy" />
                    <button className="wc-moment-img-remove" onClick={() => removeImage(i)}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="wc-moment-editor-actions">
              <button className="wc-moment-img-btn" onClick={() => imgInputRef.current?.click()}
                disabled={images.length >= 9} title="添加图片">
                🖼 图片{images.length > 0 ? ` (${images.length}/9)` : ''}
              </button>
              <input ref={imgInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={handleImagePick} />
              <div style={{ flex: 1 }} />
              <button className="wc-moment-editor-cancel"
                onClick={resetCompose}>取消</button>
              <button className="wc-moment-editor-publish"
                disabled={posting || (!text.trim() && images.length === 0)} onClick={publish}>
                {posting ? '发布中…' : '发布'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 时间线 */}
      <div className="wc-moment-scroll">
        {loading ? (
          <div className="wc-moment-state">加载中…</div>
        ) : list.length === 0 ? (
          <div className="wc-moment-state" style={{ padding: 60 }}>还没有动态，发布第一条吧</div>
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
