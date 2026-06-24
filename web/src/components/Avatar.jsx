import React, { useState, useEffect } from 'react';
import { mediaUrl } from '../utils/url';

// 低饱和灰蓝系：统一干净，按名字 hash 取色仍可区分不同人
const COLORS = ['#8A93A6','#7F8A9B','#939DAD','#76808F','#9BA4B2'];

function getColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export default function Avatar({ src, name = '', size = 40, style = {}, online = false, className = '', onClick }) {
  const radius = Math.round(size * 0.22);
  const baseStyle = { width: size, height: size, borderRadius: radius, overflow: 'hidden', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative', ...style };
  const letter = (name || '?')[0].toUpperCase();

  // 图片加载失败（如服务器上文件不存在）时回退到字母头像，避免显示浏览器碎图图标
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [src]);
  const showImg = src && !errored;

  return (
    <div style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, cursor: onClick ? 'pointer' : undefined, ...style }} onClick={onClick}>
      {showImg
        ? <img src={mediaUrl(src)} alt={name} loading="lazy" onError={() => setErrored(true)} style={{ ...baseStyle, objectFit: 'cover' }} />
        : <div style={{ ...baseStyle, background: getColor(name), color: 'var(--text-inverse)', fontSize: size * 0.42, fontWeight: 600 }}>{letter}</div>
      }
      {online && <span className="wc-online-dot" />}
    </div>
  );
}
