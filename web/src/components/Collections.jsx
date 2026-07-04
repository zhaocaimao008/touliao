import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { mediaUrl } from '../utils/url';
import { showConfirm } from '../utils/toast';
import { downloadFile } from '../utils/download';
import ImagePreview from './ImagePreview';

function ago(sec) {
  const dt = new Date(sec * 1000);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function Collections() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null); // { urls, idx } | null

  useEffect(() => {
    axios.get('/api/users/me/collections').then(r => setList(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // 所有图片收藏的完整 URL，供灯箱左右切换
  const imageUrls = list
    .filter(c => c.type === 'image')
    .map(c => mediaUrl(c.extra?.file_url || c.content));

  const remove = async (id) => {
    if (!(await showConfirm('取消收藏这条内容？'))) return;
    try { await axios.delete(`/api/users/me/collections/${id}`); setList(p => p.filter(c => c.id !== id)); } catch {}
  };

  const renderContent = (c) => {
    if (c.type === 'image') {
      const url = mediaUrl(c.extra?.file_url || c.content);
      const idx = imageUrls.indexOf(url);
      return <img loading="lazy" src={url} alt="收藏图片"
        onError={e => { e.currentTarget.style.display = 'none'; }}
        onClick={() => setLightbox({ urls: imageUrls, idx: idx < 0 ? 0 : idx })}
        style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8, objectFit: 'cover', cursor: 'zoom-in' }} />;
    }
    if (c.type === 'file' || c.type === 'video') {
      const fileUrl = c.extra?.file_url;
      const label = `${c.type === 'video' ? '🎬' : '📎'} ${c.content || (c.type === 'video' ? '视频' : '文件')}`;
      // 有 file_url 才可下载；老数据无 url 则只显示（与聊天窗口一致：点击=下载，不跳网页）
      if (!fileUrl) return <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{label}</span>;
      return (
        <button onClick={() => downloadFile(fileUrl, c.content)}
          style={{ fontSize: 14, color: 'var(--text-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
          {label}
        </button>
      );
    }
    return <span style={{ fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.content}</span>;
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>加载中…</div>
      ) : list.length === 0 ? (
        <div role="status" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 13 }}>暂无收藏</div>
      ) : (
        list.map(c => (
          <div key={c.id} style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ marginBottom: 8 }}>{renderContent(c)}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{ago(c.created_at)}</span>
              <button onClick={() => remove(c.id)}
                style={{ fontSize: 12, color: 'var(--color-badge)', background: 'none', cursor: 'pointer', padding: '2px 6px' }}>取消收藏</button>
            </div>
          </div>
        ))
      )}
      {lightbox && (
        <ImagePreview urls={lightbox.urls} initialIdx={lightbox.idx}
          url={lightbox.urls[lightbox.idx]} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
