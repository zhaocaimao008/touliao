// 把后端返回的相对资源路径（如 /uploads/avatars/x.jpg、/api/...）解析成可用的绝对地址。
//
// Web 端：同源，相对路径本就能用，原样返回。
// Electron 桌面端：页面跑在 file:// 下，<img src="/uploads/x.jpg"> 会解析成
//   file:///uploads/x.jpg（不存在）。必须补上服务器地址。
//   注意：axios.defaults.baseURL 只对 axios/fetch 生效，对 <img> 标签无效，
//   所以这里必须显式拼接。
//
// 地址优先级：
//   1. 运行时手动切换（localStorage touliao_server_url）
//   2. 远程配置（Config.api/socket）
//   3. 空值 → Web 同源，相对路径可用
import { getConfig, isConfigLoaded } from './config';

function getBaseUrl() {
  const manualUrl = localStorage.getItem('touliao_server_url');
  if (manualUrl) return manualUrl;

  // config 可能还未加载（页面渲染时资源先于配置加载）
  if (isConfigLoaded()) {
    const cfg = getConfig();
    if (cfg.api) return cfg.api;
    if (cfg.socket) return cfg.socket;
  }

  return '';
}

function bearerToken() {
  try { return localStorage.getItem('touliao_electron_token') || ''; } catch { return ''; }
}

export function mediaUrl(u) {
  if (!u) return u;
  // 已经是绝对地址 / data / blob，原样返回
  if (/^(https?:|data:|blob:)/i.test(u)) return u;

  const isElectron = !!window.__ELECTRON_CONFIG__;
  const isNative   = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (!isElectron && !isNative) return u; // Web 同源，相对路径(带 Cookie)可用

  const base = getBaseUrl().replace(/\/$/, '');
  if (!base) return u;
  let abs = u.startsWith('/') ? base + u : `${base}/${u}`;

  // 桌面/移动端用 Bearer 请求短时、单文件资源票据；登录 JWT 不进入媒体 URL。
  const token = bearerToken();
  if (token && /\/uploads\//.test(abs)) {
    const file = new URL(abs).pathname;
    const cacheKey = `touliao_media_ticket:${file}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (cached?.url && cached.expiresAt > Date.now()) {
        return cached.url.startsWith('/') ? base + cached.url : cached.url;
      }

      // mediaUrl 的调用方需要同步字符串（img/video/href）。仅桌面/原生首次取票时
      // 同步请求一次，之后 9 分钟均命中 sessionStorage，避免把登录 JWT 写入 URL。
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${base}/api/uploads/ticket?file=${encodeURIComponent(file)}`, false);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.withCredentials = true;
      xhr.send();
      if (xhr.status >= 200 && xhr.status < 300) {
        const ticket = JSON.parse(xhr.responseText);
        sessionStorage.setItem(cacheKey, JSON.stringify({ url: ticket.url, expiresAt: Date.now() + 9 * 60 * 1000 }));
        return ticket.url.startsWith('/') ? base + ticket.url : ticket.url;
      }
    } catch { /* 取票失败时返回无凭证 URL，由现有加载错误路径处理 */ }
  }
  return abs;
}

// 由原图 URL 推导缩略图 URL：/uploads/<category>/<uuid>.<ext> → 同目录下的
// <uuid>_thumb.webp（后端命名约定，见 backend-v2/src/utils/upload.js generateThumbnail）。
// 纯字符串变换，不发请求、不查后端——旧图（此功能上线前上传的）没有对应缩略图文件，
// 请求会 404，调用方必须在 <img onError> 里回退到原图 URL，绝不能假设缩略图一定存在。
export function getThumbUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (!/^\/uploads\//.test(url)) return url; // 只有本站已上传文件路径才可能有缩略图
  if (/_thumb\.webp$/.test(url)) return url; // 已经是缩略图 URL，原样返回（防重复推导）
  const m = url.match(/^(.*\/)([^/.]+)\.[a-zA-Z0-9]+$/);
  if (!m) return url;
  return `${m[1]}${m[2]}_thumb.webp`;
}

// 跳转到登录页。Electron 跑在 file:// 下，不能用绝对路径 '/login'
// （会跳到 file:///login 白屏），必须用 HashRouter 的 hash 路由。
export function goLogin() {
  if (window.__ELECTRON_CONFIG__) window.location.hash = '#/login';
  else window.location.replace('/login');
}
