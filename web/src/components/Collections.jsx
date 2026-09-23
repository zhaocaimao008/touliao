import TouliaoIcon from '../ui-kit/Icon';
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { mediaUrl, useMediaCredentials } from '../utils/url';
import { showConfirm, showToast } from '../utils/toast';
import { downloadFile } from '../utils/download';
import ImagePreview from './ImagePreview';
import { Skeleton } from './StateViews';
import { useI18n } from '../contexts/I18nContext';
import { fetchAllPages } from '../utils/paginateAll';

function formatDate(sec) {
  const dt = new Date(sec * 1000);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function Collections() {
  useMediaCredentials();
  const { t } = useI18n();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { urls, idx } | null
  const [query, setQuery] = useState('');          // 搜索关键词
  const [typeFilter, setTypeFilter] = useState(''); // ''=全部 | text | image | file | video
  const [results, setResults] = useState(null);    // { key, items, error }：只展示当前查询的完整结果
  const [searchRetry, setSearchRetry] = useState(0);

  // Q13 全修：收藏最多 1000 条，服务端 limit/offset 分页上限 100——原来只请求一次
  // 默认页,超过 100 条的旧收藏在列表/本地类型筛选里都摸不到。改成续页拉全量
  // （worst case 10 次请求，收藏页本就是低频、非首屏路径，不做虚拟滚动/增量渲染）。
  // 重试用（显示转圈后重拉），也是初次挂载拉取的唯一实现，接受 AbortSignal 供卸载取消。
  const load = useCallback((signal) => {
    setLoading(true);
    fetchAllPages({
      requestPage: (offset, limit) => axios.get('/api/users/me/collections', { params: { offset, limit }, signal }).then(r => r.data),
      signal,
    })
      .then(items => { if (!signal?.aborted) { setList(items); setLoadError(false); } })
      .catch(err => { if (!axios.isCancel?.(err) && err.code !== 'ERR_CANCELED') setLoadError(true); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, []);
  // 初次挂载拉取：load() 内的 setLoading(true) 是幂等 no-op（初值已为 true），
  // 真正的状态变化在 fetchAllPages 的 promise 回调里，非可派生同步状态。
  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：load() 内 setState 幂等，非派生同步
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // 搜索按关键词和类型去抖；加载完所有分页才发布结果，失败可重试。
  // 查询键隔离旧结果，清空关键词时回到全量列表。
  const kwTrimmed = query.trim();
  const searchKey = JSON.stringify([kwTrimmed, typeFilter, searchRetry]);
  useEffect(() => {
    const kw = kwTrimmed;
    if (!kw) return;
    // AbortController：快速输入时取消上一次未完成请求,防止慢响应覆盖新结果(旧数据竞态)
    const ac = new AbortController();
    const timer = setTimeout(() => {
      fetchAllPages({
        requestPage: (offset, limit) => axios.get('/api/users/me/collections/search', {
          params: { q: kw, type: typeFilter || undefined, offset, limit }, signal: ac.signal,
        }).then(r => r.data),
        signal: ac.signal,
      })
        .then(items => { if (!ac.signal.aborted) setResults({ key: searchKey, items }); })
        .catch(() => { if (!ac.signal.aborted) setResults({ key: searchKey, items: [], error: true }); });
    }, 300);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [kwTrimmed, typeFilter, searchKey]);

  const inSearch = kwTrimmed.length > 0;
  const searching = inSearch && results?.key !== searchKey;
  const searchError = inSearch && results?.key === searchKey && results.error;
  const shown = inSearch
    ? (results?.key === searchKey ? results.items : [])
    : (typeFilter ? list.filter(c => c.type === typeFilter) : list);

  // 所有图片收藏的完整 URL，供灯箱左右切换（跟随当前展示的列表）
  const imageUrls = shown
    .filter(c => c.type === 'image')
    .map(c => c.extra?.file_url || c.content);

  const remove = async (id) => {
    if (!(await showConfirm(t('coll.confirmRemove')))) return;
    try {
      await axios.delete(`/api/users/me/collections/${id}`);
      setList(p => p.filter(c => c.id !== id));
      setResults(p => p == null ? p : { ...p, items: p.items.filter(c => c.id !== id) });
    }
    catch (e) { showToast(e.response?.data?.error || t('coll.removeFailed'), 'error'); }
  };

  // 跳转到原消息：派发全局事件，由 Home 打开对应会话并滚动定位
  const jumpToSource = (c) => {
    const convId = c.extra?.source_conv_id;
    const msgId = c.extra?.source_msg_id;
    if (!convId) return;
    window.dispatchEvent(new CustomEvent('touliao:open-conversation', {
      detail: { conversationId: convId, scrollToId: msgId },
    }));
  };

  const renderContent = (c) => {
    if (c.type === 'image') {
      const url = mediaUrl(c.extra?.file_url || c.content);
      const idx = imageUrls.indexOf(c.extra?.file_url || c.content);
      const open = () => setLightbox({ urls: imageUrls, idx: idx < 0 ? 0 : idx });
      return <img key={url} loading="lazy" src={url} alt={t('coll.collectedImageAlt')}
        role="button" tabIndex={0} aria-label={t('moments.viewLargeImage')}
        onError={e => { e.currentTarget.style.display = 'none'; }}
        onClick={open}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        style={{ maxWidth: 180, maxHeight: 180, borderRadius: 'var(--radius-input)', objectFit: 'cover', cursor: 'zoom-in' }} />;
    }
    if (c.type === 'file' || c.type === 'video') {
      const fileUrl = c.extra?.file_url;
      const label = <span className="tl-icon-label"><TouliaoIcon name={c.type === 'video' ? 'video' : 'fileContent'} size="sm" />{c.content || (c.type === 'video' ? t('coll.typeVideo') : t('coll.typeFile'))}</span>;
      // 有 file_url 才可下载；老数据无 url 则只显示（与聊天窗口一致：点击=下载，不跳网页）
      if (!fileUrl) return <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>{label}</span>;
      return (
        <button onClick={() => downloadFile(fileUrl, c.content)}
          style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
          {label}
        </button>
      );
    }
    return <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.content}</span>;
  };

  const TYPES = [['', t('coll.typeAll')], ['text', t('coll.typeText')], ['image', t('coll.typeImage')], ['file', t('coll.typeFile')], ['video', t('coll.typeVideo')]];

  return (
    <div className="tl-collections" style={{ height: '100%', overflowY: 'auto' }}>
      {/* 搜索栏 + 类型过滤（对齐后端 /collections/search 的 q + type） */}
      <div className="tl-collection-filters" style={{ padding: '10px 14px', position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 1, borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ position: 'relative' }}>
          <input data-testid="collection-search-input" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={t('coll.searchPlaceholder')} aria-label={t('coll.searchAriaLabel')}
            style={{ background: 'var(--bg-input-search)', color: 'var(--text-primary)', width: '100%', padding: '7px 28px 7px 10px', borderRadius: 'var(--radius-input)', border: '1px solid var(--border-color)', fontSize: 'var(--text-base)', boxSizing: 'border-box' }} />
          {query && (
            <button type="button" aria-label={t('fwd.clearSearchAriaLabel')} title={t('common.clear')} onClick={() => setQuery('')}
              style={{ position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, border: 'none', borderRadius: 'var(--radius-full)', background: 'var(--border-color)', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><TouliaoIcon name="close" size="sm" /></button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {TYPES.map(([val, label]) => (
            <button key={val || 'all'} aria-pressed={typeFilter === val} data-testid={`collection-type-${val || 'all'}`} onClick={() => setTypeFilter(val)}
              style={{ fontSize: 'var(--text-sm)', padding: '11px 12px', borderRadius: 'var(--radius-bubble-tip)', cursor: 'pointer',
                border: '1px solid var(--border-color)', display: 'inline-flex', alignItems: 'center',
                background: typeFilter === val ? 'var(--color-primary-solid)' : 'transparent',
                color: typeFilter === val ? '#fff' : 'var(--text-secondary)' }}>{label}</button>
          ))}
        </div>
      </div>
      {loading ? (
        <Skeleton rows={6} avatar />
      ) : loadError && list.length === 0 ? (
        <div role="status" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm2)' }}>
          {t('moments.loadFailed')}<button onClick={() => load()} style={{ color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{t('moments.clickRetry')}</button>
        </div>
      ) : (inSearch && searching) ? (
        <div role="status" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm2)' }}>{t('convSearch.searching')}</div>
      ) : searchError ? (
        <div role="alert" className="wc-moment-state moments-state-pad40">
          {t('moments.loadFailed')} <button onClick={() => setSearchRetry(n => n + 1)}>{t('common.retry')}</button>
        </div>
      ) : shown.length === 0 ? (
        <div role="status" data-testid="collection-empty" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm2)' }}>
          {(query.trim() || typeFilter) ? t('coll.noMatchingResults') : t('coll.empty')}
        </div>
      ) : (
        shown.map(c => (
          <div key={c.id} className="tl-collection-card" data-testid="collection-item" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ marginBottom: 8 }}>{renderContent(c)}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>{formatDate(c.created_at)}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {c.extra?.source_conv_id && (
                  <button onClick={() => jumpToSource(c)}
                    style={{ fontSize: 'var(--text-sm)', color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 8px' }}>{t('coll.jumpToSource')}</button>
                )}
                <button onClick={() => remove(c.id)}
                  style={{ fontSize: 'var(--text-sm)', color: 'var(--text-danger)', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 8px' }}>{t('coll.unfavorite')}</button>
              </div>
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
