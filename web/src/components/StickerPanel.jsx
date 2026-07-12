import React, { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { mediaUrl } from '../utils/url';
import { showToast, showConfirm } from '../utils/toast';
import './StickerPanel.css';

const MAX_STICKER_MB = 5;   // 表情图上限，超出前端就拦，省去无谓上传等待
const PAGE_SIZE = 20;       // 每页加载数，减少首屏请求量

// 我的表情包：点一下直接发送；可上传新增、长按/✕ 删除。
export default function StickerPanel({ onSend }) {
  const [stickers, setStickers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const fileRef = useRef(null);
  const sentinelRef = useRef(null);
  const allStickersRef = useRef([]);

  const load = useCallback(() => axios.get('/api/stickers')
    .then(r => {
      const data = r.data || [];
      allStickersRef.current = data;
      setStickers(data.slice(0, PAGE_SIZE));
      setHasMore(data.length > PAGE_SIZE);
      setPage(1);
    })
    .catch(() => {})
    .finally(() => setLoaded(true)), []);

  useEffect(() => { load(); }, [load]);

  const loadMore = useCallback(() => {
    if (loadingPage || !hasMore) return;
    setLoadingPage(true);
    // 模拟加载下一页（从全量中截取，避免额外请求）
    const nextPage = page + 1;
    const all = allStickersRef.current;
    const nextBatch = all.slice(0, nextPage * PAGE_SIZE);
    setStickers(nextBatch);
    setHasMore(nextBatch.length < all.length);
    setPage(nextPage);
    setLoadingPage(false);
  }, [page, hasMore, loadingPage]);

  // IntersectionObserver 在滚动到尾部时触发加载更多
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: '100px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const onPick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_STICKER_MB * 1024 * 1024) {
      showToast(`图片不能超过 ${MAX_STICKER_MB}MB`, 'error');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('image', file);
      await axios.post('/api/stickers/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
    } catch (err) {
      showToast(err.response?.data?.error || '添加失败', 'error');
    } finally {
      setUploading(false);
    }
  };

  const del = async (e, id) => {
    e.stopPropagation();
    if (!(await showConfirm('删除这个表情？'))) return;
    try {
      await axios.delete(`/api/stickers/${id}`);
      setStickers(s => s.filter(x => x.id !== id));
      allStickersRef.current = allStickersRef.current.filter(x => x.id !== id);
    } catch { showToast('删除表情失败，请重试', 'error'); }
  };

  return (
    <div className="wc-emoji-picker" style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 12px 8px' }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>我的表情 · 点一下发送</span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ fontSize: 12, color: 'var(--color-primary)', background: 'rgba(var(--color-primary-rgb),.1)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '3px 10px', cursor: 'pointer' }}>
          {uploading ? '上传中…' : '＋ 添加'}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{ display: 'none' }} onChange={onPick} />
      </div>
      <div className="sticker-grid">
        {loaded && stickers.length === 0 && (
          <div className="sticker-grid-empty">
            还没有表情<br />点「＋ 添加」上传图片，或长按聊天里的图片「收藏到表情」
          </div>
        )}
        {stickers.map(s => (
          <div key={s.id} className="sticker-item" role="button" tabIndex={0} aria-label="发送表情" onClick={() => onSend(s.id)}
            onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSend(s.id); } }}>
            <img loading="lazy" src={mediaUrl(s.url)} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
            <button className="sticker-del" onClick={(e) => del(e, s.id)} title="删除" aria-label="删除表情">✕</button>
          </div>
        ))}
        {/* 底部哨兵元素：滚动到此处自动加载更多 */}
        {hasMore && <div ref={sentinelRef} className="sticker-sentinel">{loadingPage ? '加载中…' : ''}</div>}
      </div>
    </div>
  );
}
