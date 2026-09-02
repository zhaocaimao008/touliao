import React, { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { mediaUrl } from '../utils/url';
import { showToast, showConfirm } from '../utils/toast';
import './StickerPanel.css';

const MAX_STICKER_MB = 5;   // 表情图上限，超出前端就拦，省去无谓上传等待

// 我的表情包：点一下直接发送；可上传新增、长按/✕ 删除。
// 后端 user_stickers 有硬上限 200 个/人(stickers.controller.js MAX_STICKERS)，一次性拉全量
// 响应体不到 30KB，图片本身走 <img loading="lazy"> 原生懒加载——不需要额外做请求级分页，
// 之前"加载更多"是从全量结果里 slice 的假分页，徒增状态复杂度，直接去掉。
export default function StickerPanel({ onSend }) {
  const [stickers, setStickers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(() => axios.get('/api/stickers')
    .then(r => setStickers(r.data || []))
    .catch(() => {})
    .finally(() => setLoaded(true)), []);

  useEffect(() => { load(); }, [load]);

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
      await axios.post('/api/stickers/upload', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
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
    } catch { showToast('删除表情失败，请重试', 'error'); }
  };

  return (
    <div className="wc-emoji-picker" style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 12px 8px' }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>我的表情 · 点一下发送</span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ fontSize: 'var(--text-sm)', color: 'var(--color-primary)', background: 'rgba(var(--color-primary-rgb),.1)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '3px 10px', cursor: 'pointer' }}>
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
      </div>
    </div>
  );
}
