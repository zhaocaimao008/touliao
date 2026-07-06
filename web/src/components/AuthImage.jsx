import React, { useState, useEffect } from 'react';
import axios from 'axios';

// 用于需要鉴权的图片端点（如 /api/users/me/qrcode）。
// Web 端 <img> 靠同源 cookie 能直接加载；但 Electron 桌面端 <img> 无法携带
// Authorization Bearer 头，会 401。这里统一用 axios（自动带 cookie 或 Bearer）
// 拉成 blob 再显示，两端都能用。
export default function AuthImage({ src, alt = '', style, className }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objUrl = null;
    setFailed(false);
    setBlobUrl(null);
    // src 为空时不发请求（axios.get(undefined) 会误请求当前页面）
    if (!src) { setFailed(true); return; }
    axios.get(src, { responseType: 'blob' })
      .then(res => {
        if (revoked) return;
        objUrl = URL.createObjectURL(res.data);
        setBlobUrl(objUrl);
      })
      .catch(() => { if (!revoked) setFailed(true); });
    return () => { revoked = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [src]);

  if (failed) return <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }} className={className}>加载失败</div>;
  if (!blobUrl) return <div style={{ ...style, background: 'var(--bg-search)' }} className={className} />;
  return <img src={blobUrl} alt={alt} loading="lazy" style={style} className={className} onError={() => setFailed(true)} />;
}
