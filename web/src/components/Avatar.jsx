import React, { memo, useState } from 'react';
import { mediaUrl, getThumbUrl } from '../utils/url';

// 无头像时的字母头像配色：AURORA 极光系多彩，按名字 hash 稳定取色，去掉"整页灰"
const COLORS = [
  'var(--color-primary)', // 极光靛(主)——跟随品牌主色 token，暗色自动切换
  '#17B8A6', // 青碧(辅)
  '#5B7BF0', // 靛蓝
  '#9B7BF5', // 薰衣草紫
  '#F0A020', // 琥珀
  '#FF7A93', // 珊瑚粉
  '#13C2C2', // 青
  '#7C6BF7', // 蓝紫
  '#E8619D', // 品红
  '#38C0A8', // 薄荷
];

export function getColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export const AVATAR_TIERS = {
  micro: 24,  // 微：群聊发送者小头像、会话多账号头像
  xs: 28,     // 特小：账号切换行
  sm: 36,     // 小：消息气泡发送者、成员列表、通知行
  md: 40,     // 中：会话/联系人/朋友圈列表（默认）
  lg: 48,     // 大：好友请求、新朋友行
  xl: 64,     // 特大：个人资料卡、二维码名片
  hero: 92,   // 主头像：「我」页头部横幅
};
export const avatarPx = (size) => (typeof size === 'string' ? AVATAR_TIERS[size] || 40 : size);

export default memo(function Avatar({ src, name = '', size = 'md', style = {}, online = false, className: _className = '', onClick }) {
  const px = avatarPx(size);
  const radius = Math.max(3, Math.round(px * 0.13)); // 微信风方圆角(原 0.22 偏圆)
  const baseStyle = { width: px, height: px, borderRadius: radius, overflow: 'hidden', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative', ...style };
  const letter = (name || '?')[0].toUpperCase();

  // 图片加载失败（如服务器上文件不存在）时回退到字母头像，避免显示浏览器碎图图标。
  // src 变化即重置错误态：用 render 期派生（存上一次 src）替代 effect，避免多余一帧闪烁。
  const [errored, setErrored] = useState(false);
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setErrored(false);
  }
  const showImg = src && !errored;
  const thumbUrl = mediaUrl(getThumbUrl(src));
  const originalUrl = mediaUrl(src);

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, cursor: onClick ? 'pointer' : undefined, ...style }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
    >
      {showImg
        ? <>
            {/* 字母垫底：图片加载出来前透出彩色字母而非空白，加载完被图覆盖（无 opacity 切换，规避缓存图不触发 onLoad 的失效） */}
            <div aria-hidden="true" style={{ ...baseStyle, position: 'absolute', inset: 0, background: getColor(name), color: 'var(--text-inverse)', fontSize: px * 0.42, fontWeight: 600 }}>{letter}</div>
            <img
              src={thumbUrl}
              alt={name}
              loading="lazy"
              crossOrigin="anonymous"
              onError={e => {
                // 缩略图失败（旧头像无缩略图/生成失败）先回退原图，原图也失败才落到字母头像
                const el = e.currentTarget;
                if (thumbUrl !== originalUrl && el.src !== originalUrl) { el.src = originalUrl; return; }
                setErrored(true);
              }}
              style={{ ...baseStyle, objectFit: 'cover', position: 'relative', zIndex: 1 }}
            />
          </>
        : <div style={{ ...baseStyle, background: getColor(name), color: 'var(--text-inverse)', fontSize: px * 0.42, fontWeight: 600, transition: 'opacity .15s' }}>{letter}</div>
      }
      {online && <span className="wc-online-dot" />}
    </div>
  );
});
