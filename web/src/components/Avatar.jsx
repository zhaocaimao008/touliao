import React, { useState, useEffect } from 'react';
import { mediaUrl } from '../utils/url';

// 无头像时的字母头像配色：明快多彩(含微信绿)，按名字 hash 稳定取色，去掉"整页灰"
const COLORS = [
  '#07C160', // 微信绿
  '#10AEFF', // 天蓝
  '#FA9D3B', // 橙
  '#6A8DFF', // 蓝紫
  '#FF7A45', // 橙红
  '#13C2C2', // 青
  '#9B59E8', // 紫
  '#52C41A', // 草绿
  '#FF85A2', // 粉
  '#36C5C0', // 蓝绿
];

export function getColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export default function Avatar({ src, name = '', size = 40, style = {}, online = false, className = '', onClick }) {
  const radius = Math.max(3, Math.round(size * 0.13)); // 微信风方圆角(原 0.22 偏圆)
  const baseStyle = { width: size, height: size, borderRadius: radius, overflow: 'hidden', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative', ...style };
  const letter = (name || '?')[0].toUpperCase();

  // 图片加载失败（如服务器上文件不存在）时回退到字母头像，避免显示浏览器碎图图标
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [src]);
  const showImg = src && !errored;

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, cursor: onClick ? 'pointer' : undefined, ...style }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => e.key === 'Enter' && onClick(e) : undefined}
    >
      {showImg
        ? <img src={mediaUrl(src)} alt={name} loading="lazy" onError={() => setErrored(true)} style={{ ...baseStyle, objectFit: 'cover' }} />
        : <div style={{ ...baseStyle, background: getColor(name), color: 'var(--text-inverse)', fontSize: size * 0.42, fontWeight: 600 }}>{letter}</div>
      }
      {online && <span className="wc-online-dot" />}
    </div>
  );
}
