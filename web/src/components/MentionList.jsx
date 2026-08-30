import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { formatFull } from '../utils/time';

/**
 * @我消息聚合入口：展示所有会话中 @当前用户 的消息。
 * 点击某条 → 通过 onJumpToMsg({ convId, msgId }) 跳转到对应会话并定位消息。
 *
 * Props:
 *   onClose     — 关闭/返回回调
 *   onJumpToMsg — ({ convId, msgId }) 跳转回调，由父级 (Home/App) 处理
 */
export default function MentionList({ onClose, onJumpToMsg }) {
  const [items, setItems]   = useState([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const LIMIT = 20;
  const abortRef = useRef(null);

  // 分页方式：offset → (createdAt, msgId) 复合游标（见 AUDIT.md 第九节"分页方式"🟡）。
  // 首屏加载不带 cursor（等价于 before=null）；"加载更多"时带上当前列表最后一条的
  // createdAt+msgId 作为游标。offset 计数在翻页途中有新@我消息插入时会整体错位，
  // 导致重复看到已经出现过的消息；游标锚定在具体某条消息上，不受这个影响。
  const load = useCallback(async (cursor = null) => {
    if (loading) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/messages/mentions/me', {
        params: {
          limit: LIMIT,
          ...(cursor ? { before: cursor.createdAt, beforeId: cursor.msgId } : {}),
        },
        signal: ac.signal,
      });
      setItems(prev => cursor === null ? data.items : [...prev, ...data.items]);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (err) {
      if (!axios.isCancel?.(err) && err.code !== 'ERR_CANCELED') {
        // 静默失败
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    // 挂载时首次拉取；load 内部的 setLoading 是刻意的加载态，非级联渲染问题
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(null);
    return () => { abortRef.current?.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // "加载更多"用当前已加载列表里最后一条（时间上最旧的一条）作为下一页游标
  const loadMore = useCallback(() => {
    const last = items[items.length - 1];
    if (last) load({ createdAt: last.createdAt, msgId: last.msgId });
  }, [items, load]);

  const handleClick = (item) => {
    onJumpToMsg?.({ convId: item.convId, msgId: item.msgId });
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', background: 'var(--bg-panel)',
    }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
        borderBottom: '1px solid var(--border-default)',
        background: 'var(--bg-card)',
      }}>
        <button
          onClick={onClose}
          aria-label="返回"
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            padding: 4, color: 'var(--text-secondary)' }}
        >
          <svg viewBox="0 0 24 24" style={{ width: 20, height: 20, fill: 'currentColor' }}>
            <path d="M20 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H20c.55 0 1-.45 1-1s-.45-1-1-1z"/>
          </svg>
        </button>
        <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>@我的消息</span>
        {total > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            共 {total} 条
          </span>
        )}
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {items.length === 0 && !loading && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '60%',
            color: 'var(--text-tertiary)', fontSize: 'var(--text-sm2)',
          }}>
            <svg viewBox="0 0 24 24" style={{ width: 48, height: 48, fill: 'currentColor', opacity: .3, marginBottom: 8 }}>
              <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
            </svg>
            暂无 @我 的消息
          </div>
        )}

        {items.map(item => (
          <div
            key={item.msgId}
            role="button"
            tabIndex={0}
            onClick={() => handleClick(item)}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleClick(item)}
            style={{
              padding: '12px 16px', cursor: 'pointer',
              borderBottom: '1px solid var(--border-subtle)',
              transition: 'background .1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; }}
          >
            {/* 会话名 + 时间 */}
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 'var(--text-sm2)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                [{item.convName}]
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                {formatFull(item.createdAt * 1000)}
              </span>
            </div>
            {/* 发送者名 + 内容摘要 */}
            <div style={{ fontSize: 'var(--text-sm2)', color: 'var(--text-primary)', lineHeight: 1.4 }}>
              <span style={{ color: 'var(--text-secondary)', marginRight: 4 }}>
                {item.senderName}:
              </span>
              {/* 高亮 @我 */}
              <MentionHighlight text={item.content} />
            </div>
          </div>
        ))}

        {hasMore && !loading && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <button
              onClick={loadMore}
              style={{ background: 'none', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-tag)', padding: '6px 18px', cursor: 'pointer',
                fontSize: 'var(--text-sm2)', color: 'var(--text-secondary)' }}
            >
              加载更多
            </button>
          </div>
        )}
        {loading && (
          <div style={{ textAlign: 'center', padding: '16px 0',
            color: 'var(--text-tertiary)', fontSize: 'var(--text-sm2)' }}>
            加载中…
          </div>
        )}
      </div>
    </div>
  );
}

// 对内容中的 @xxx 片段做绿色高亮渲染
function MentionHighlight({ text }) {
  if (!text) return null;
  const parts = text.split(/(@[^\s,，。！？]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('@')
          ? <span key={i} style={{ color: 'var(--green)', fontWeight: 500 }}>{p}</span>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}
