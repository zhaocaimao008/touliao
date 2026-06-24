import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { mediaUrl } from '../utils/url';
import { showConfirm } from '../utils/toast';

function ago(sec) {
  const dt = new Date(sec * 1000);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function Collections() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/users/me/collections').then(r => setList(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const remove = async (id) => {
    if (!(await showConfirm('取消收藏这条内容？'))) return;
    try { await axios.delete(`/api/users/me/collections/${id}`); setList(p => p.filter(c => c.id !== id)); } catch {}
  };

  const renderContent = (c) => {
    if (c.type === 'image') {
      const url = c.extra?.file_url || c.content;
      return <img loading="lazy" src={mediaUrl(url)} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8, objectFit: 'cover' }} />;
    }
    if (c.type === 'file') {
      return <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>📎 {c.content || '文件'}</span>;
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
                style={{ fontSize: 12, color: '#FA5151', background: 'none', cursor: 'pointer', padding: '2px 6px' }}>取消收藏</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
