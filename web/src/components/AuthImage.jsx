import React, { useState, useEffect } from 'react';
import axios from 'axios';

// 用于需要鉴权的图片端点（如 /api/users/me/qrcode）。
// Web 端 <img> 靠同源 cookie 能直接加载；但 Electron 桌面端 <img> 无法携带
// Authorization Bearer 头，会 401。这里统一用 axios（自动带 cookie 或 Bearer）
// 拉成 blob 再显示，两端都能用。
export default function AuthImage({ src, alt = '', style, className }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);   // 点击「加载失败」重试计数,变化即重新拉取

  // src/retry 变化时同步重置加载态：render 期派生（存上一次的 src+retry 组合），
  // 避免 effect 内 setState 造成的额外渲染帧与残图闪烁。
  const [loadKey, setLoadKey] = useState(`${src}#${retry}`);
  const nextKey = `${src}#${retry}`;
  if (nextKey !== loadKey) {
    setLoadKey(nextKey);
    setFailed(false);
    setBlobUrl(null);
  }

  useEffect(() => {
    let revoked = false;
    let objUrl = null;
    // src 为空时不发请求（axios.get(undefined) 会误请求当前页面）；
    // 空 src 的失败态由下方 render 派生（emptySrc）处理，无需在此 setState。
    if (!src) return;
    axios.get(src, { responseType: 'blob' })
      .then(res => {
        if (revoked) return;
        objUrl = URL.createObjectURL(res.data);
        setBlobUrl(objUrl);
      })
      .catch(() => { if (!revoked) setFailed(true); });
    return () => { revoked = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [src, retry]);

  if (failed || !src) return (
    <div
      style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
      className={className}
      role="button" tabIndex={0}
      title="点击重试"
      aria-label="图片加载失败，点击重试"
      onClick={() => setRetry(n => n + 1)}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setRetry(n => n + 1))}
    >加载失败，点击重试</div>
  );
  if (!blobUrl) return <div style={{ ...style, background: 'var(--bg-search)' }} className={className} aria-busy="true" />;
  return <img src={blobUrl} alt={alt} loading="lazy" style={style} className={className} onError={() => { setBlobUrl(null); setFailed(true); }} />;
}
