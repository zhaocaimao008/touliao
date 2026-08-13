import React from 'react';

/**
 * PanelSkeleton — 面板懒加载骨架屏
 * 替代原来的空 div，让用户感知到内容正在加载
 */
export function ConvListSkeleton() {
  return (
    <div style={{ padding: '12px 8px' }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 4px', marginBottom: 4,
          opacity: 1 - i * 0.1,
        }}>
          <div className="skeleton-box" style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton-box" style={{ height: 13, width: '55%', borderRadius: 6, marginBottom: 6 }} />
            <div className="skeleton-box" style={{ height: 11, width: '75%', borderRadius: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 16px', flex: 1 }}>
      {[{w:'45%',mine:false},{w:'60%',mine:true},{w:'35%',mine:false},{w:'70%',mine:true}].map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: r.mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8 }}>
          {!r.mine && <div className="skeleton-box" style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0 }} />}
          <div className="skeleton-box" style={{ height: 36, width: r.w, borderRadius: 12 }} />
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ rows = 6 }) {
  return (
    <div style={{ padding: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-box" style={{
          height: 48, borderRadius: 8, marginBottom: 10, opacity: 1 - i * 0.12,
        }} />
      ))}
    </div>
  );
}
