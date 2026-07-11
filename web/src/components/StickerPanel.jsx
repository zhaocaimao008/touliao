import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { mediaUrl } from '../utils/url';
import { showToast, showConfirm } from '../utils/toast';

const MAX_STICKER_MB = 5;   // 表情图上限，超出前端就拦，省去无谓上传等待

// 我的表情包：点一下直接发送；可上传新增、长按/✕ 删除。
export default function StickerPanel({ onSend }) {
  const [stickers, setStickers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);   // 首次拉取完成前不显示「还没有表情」,避免闪空态
  const fileRef = useRef(null);

  const load = () => axios.get('/api/stickers')
    .then(r => setStickers(r.data || []))
    .catch(() => {})
    .finally(() => setLoaded(true));
  useEffect(() => { load(); }, []);

  const onPick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    // 前端体积校验：超限直接提示,不发起上传
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
    // 二次确认：误点 ✕ 不会直接删掉表情
    if (!(await showConfirm('删除这个表情？'))) return;
    // 仅在服务器确实删除后才从 UI 移除，避免失败时表情"删了又回来"
    try {
      await axios.delete(`/api/stickers/${id}`);
      setStickers(s => s.filter(x => x.id !== id));
    } catch { showToast('删除表情失败，请重试', 'error'); }
  };

  return (
    <div className="wc-emoji-picker" style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 12px 8px' }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>我的表情 · 点一下发送</span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ fontSize: 12, color: 'var(--color-primary)', background: 'rgba(var(--color-primary-rgb),.1)', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
          {uploading ? '上传中…' : '＋ 添加'}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{ display: 'none' }} onChange={onPick} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '0 12px 8px', maxHeight: 200, overflowY: 'auto' }}>
        {loaded && stickers.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, padding: '24px 8px', lineHeight: 1.6 }}>
            还没有表情<br />点「＋ 添加」上传图片，或长按聊天里的图片「收藏到表情」
          </div>
        )}
        {stickers.map(s => (
          <div key={s.id} role="button" tabIndex={0} aria-label="发送表情" onClick={() => onSend(s.id)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSend(s.id); } }}
            style={{ position: 'relative', cursor: 'pointer', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-search)', border: '1px solid var(--border-color)' }}>
            <img loading="lazy" src={mediaUrl(s.url)} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <button onClick={(e) => del(e, s.id)} title="删除"
              style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, border: 'none', borderRadius: 8, background: 'rgba(0,0,0,.5)', color: 'var(--text-inverse)', fontSize: 11, lineHeight: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              aria-label="删除表情"
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
