import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { mediaUrl } from '../utils/url';
import { showToast } from '../utils/toast';

// 我的表情包：点一下直接发送；可上传新增、长按/✕ 删除。
export default function StickerPanel({ onSend }) {
  const [stickers, setStickers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = () => axios.get('/api/stickers').then(r => setStickers(r.data || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const onPick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
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

  const del = (e, id) => {
    e.stopPropagation();
    setStickers(s => s.filter(x => x.id !== id));
    axios.delete(`/api/stickers/${id}`).catch(() => {});
  };

  return (
    <div className="wc-emoji-picker" style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 12px 8px' }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>我的表情 · 点一下发送</span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ fontSize: 12, color: 'var(--green)', background: 'rgba(7,193,96,.1)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
          {uploading ? '上传中…' : '＋ 添加'}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{ display: 'none' }} onChange={onPick} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '0 12px 8px', maxHeight: 200, overflowY: 'auto' }}>
        {stickers.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, padding: '24px 8px', lineHeight: 1.6 }}>
            还没有表情<br />点「＋ 添加」上传图片，或长按聊天里的图片「收藏到表情」
          </div>
        )}
        {stickers.map(s => (
          <div key={s.id} onClick={() => onSend(s.id)}
            style={{ position: 'relative', cursor: 'pointer', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-search)', border: '1px solid var(--border-color)' }}>
            <img loading="lazy" src={mediaUrl(s.url)} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <button onClick={(e) => del(e, s.id)} title="删除"
              style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: 8, background: 'rgba(0,0,0,.5)', color: 'var(--text-inverse)', fontSize: 11, lineHeight: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              aria-label="删除表情"
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
