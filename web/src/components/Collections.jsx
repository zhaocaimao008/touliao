import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { mediaUrl } from '../utils/url';
import { showConfirm, showToast } from '../utils/toast';
import { downloadFile } from '../utils/download';
import ImagePreview from './ImagePreview';

function ago(sec) {
  const dt = new Date(sec * 1000);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function Collections() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { urls, idx } | null
  const [query, setQuery] = useState('');          // 搜索关键词
  const [typeFilter, setTypeFilter] = useState(''); // ''=全部 | text | image | file | video
  const [results, setResults] = useState(null);    // null=未搜索(显示全量) | 数组=搜索结果
  const [searching, setSearching] = useState(false);

  const load = () => {
    setLoading(true);
    axios.get('/api/users/me/collections')
      .then(r => { setList(r.data); setLoadError(false); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // 搜索：关键词为空且无类型过滤 → 回到全量列表；否则调 /collections/search（去抖）
  useEffect(() => {
    const kw = query.trim();
    if (!kw) { setResults(null); setSearching(false); return; }
    setSearching(true);
    // AbortController：快速输入时取消上一次未完成请求,防止慢响应覆盖新结果(旧数据竞态)
    const ac = new AbortController();
    const t = setTimeout(() => {
      const params = { q: kw, limit: 50 };
      if (typeFilter) params.type = typeFilter;
      axios.get('/api/users/me/collections/search', { params, signal: ac.signal })
        .then(r => setResults(r.data.items || []))
        .catch(err => { if (!axios.isCancel?.(err) && err.code !== 'ERR_CANCELED') setResults([]); })
        .finally(() => { if (!ac.signal.aborted) setSearching(false); });
    }, 300);
    return () => { clearTimeout(t); ac.abort(); };
  }, [query, typeFilter]);

  // 当前展示的列表：搜索态用结果，否则用全量（全量也支持类型过滤）
  const shown = results != null
    ? results
    : (typeFilter ? list.filter(c => c.type === typeFilter) : list);

  // 所有图片收藏的完整 URL，供灯箱左右切换（跟随当前展示的列表）
  const imageUrls = shown
    .filter(c => c.type === 'image')
    .map(c => mediaUrl(c.extra?.file_url || c.content));

  const remove = async (id) => {
    if (!(await showConfirm('取消收藏这条内容？'))) return;
    try {
      await axios.delete(`/api/users/me/collections/${id}`);
      setList(p => p.filter(c => c.id !== id));
      setResults(p => p == null ? p : p.filter(c => c.id !== id));
    }
    catch (e) { showToast(e.response?.data?.error || '取消收藏失败', 'error'); }
  };

  const renderContent = (c) => {
    if (c.type === 'image') {
      const url = mediaUrl(c.extra?.file_url || c.content);
      const idx = imageUrls.indexOf(url);
      const open = () => setLightbox({ urls: imageUrls, idx: idx < 0 ? 0 : idx });
      return <img loading="lazy" src={url} alt="收藏图片"
        role="button" tabIndex={0} aria-label="查看大图"
        onError={e => { e.currentTarget.style.display = 'none'; }}
        onClick={open}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
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

  const TYPES = [['', '全部'], ['text', '文字'], ['image', '图片'], ['file', '文件'], ['video', '视频']];

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {/* 搜索栏 + 类型过滤（对齐后端 /collections/search 的 q + type） */}
      <div style={{ padding: '10px 14px', position: 'sticky', top: 0, background: 'var(--bg-primary, #fff)', zIndex: 1, borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ position: 'relative' }}>
          <input data-testid="collection-search-input" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="搜索收藏…" aria-label="搜索收藏"
            style={{ width: '100%', padding: '7px 28px 7px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 14, boxSizing: 'border-box' }} />
          {query && (
            <button type="button" aria-label="清除搜索" title="清除" onClick={() => setQuery('')}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, border: 'none', borderRadius: 9, background: 'var(--border-color)', color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {TYPES.map(([val, label]) => (
            <button key={val || 'all'} data-testid={`collection-type-${val || 'all'}`} onClick={() => setTypeFilter(val)}
              style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                border: '1px solid var(--border-color)',
                background: typeFilter === val ? 'var(--green)' : 'transparent',
                color: typeFilter === val ? '#fff' : 'var(--text-secondary)' }}>{label}</button>
          ))}
        </div>
      </div>
      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>加载中…</div>
      ) : loadError && list.length === 0 ? (
        <div role="status" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 13 }}>
          加载失败，<button onClick={load} style={{ color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>点击重试</button>
        </div>
      ) : searching ? (
        <div role="status" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>搜索中…</div>
      ) : shown.length === 0 ? (
        <div role="status" data-testid="collection-empty" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 13 }}>
          {(query.trim() || typeFilter) ? '没有匹配的收藏' : '暂无收藏'}
        </div>
      ) : (
        shown.map(c => (
          <div key={c.id} data-testid="collection-item" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ marginBottom: 8 }}>{renderContent(c)}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{ago(c.created_at)}</span>
              <button onClick={() => remove(c.id)}
                style={{ fontSize: 12, color: 'var(--color-badge)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>取消收藏</button>
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
