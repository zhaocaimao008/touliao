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
import { useSyncExternalStore } from 'react';

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

// Tickets belong to the exact issuing credential and server. Keep them in memory so old
// sessionStorage entries (including pre-revocation tickets) never survive a reload/login.
const mediaTickets = new Map();
const mediaListeners = new Set();
let ticketContext = { token: '', base: '', generation: 0 };
function clearMediaTickets() {
  mediaTickets.clear();
  ticketContext = { token: '', base: '', generation: ticketContext.generation + 1 };
}
export function invalidateMediaTickets() {
  clearMediaTickets();
  for (const listener of mediaListeners) listener();
}
function subscribeMedia(listener) {
  mediaListeners.add(listener);
  return () => mediaListeners.delete(listener);
}
const mediaSnapshot = () => ticketContext.generation;
// Subscribe at component top level; mediaUrl remains safe inside maps/event handlers.
// https://react.dev/reference/react/useSyncExternalStore
export function useMediaCredentials() {
  return useSyncExternalStore(subscribeMedia, mediaSnapshot);
}
window.addEventListener?.('touliao:credentials-updated', invalidateMediaTickets);
window.addEventListener?.('storage', event => {
  if (['touliao_electron_token', 'touliao_server_url', 'touliao_session_revision', null].includes(event.key)) invalidateMediaTickets();
});

function ticketExpiry(url, base) {
  try {
    const token = new URL(url, base).searchParams.get('token');
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Math.min(Date.now() + 9 * 60 * 1000, Number(payload.exp) * 1000 - 1000);
  } catch { return 0; } // A response with no readable expiry may be used once, never cached.
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
  if (ticketContext.token !== token || ticketContext.base !== base) {
    clearMediaTickets();
    ticketContext = { ...ticketContext, token, base };
  }
  const generation = ticketContext.generation;
  if (token && /\/uploads\//.test(abs)) {
    const file = new URL(abs).pathname;
    try {
      const cached = mediaTickets.get(file);
      if (cached?.url && cached.expiresAt > Date.now()) {
        return cached.url.startsWith('/') ? base + cached.url : cached.url;
      }

      // mediaUrl 的调用方需要同步字符串（img/video/href）。仅桌面/原生首次取票时
      // 同步请求一次，随后在当前凭据的有效期内复用，避免把登录 JWT 写入 URL。
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${base}/api/uploads/ticket?file=${encodeURIComponent(file)}`, false);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.withCredentials = true;
      xhr.send();
      // A credential/server update during the request must discard this old response.
      if (token !== bearerToken() || base !== getBaseUrl().replace(/\/$/, '') || generation !== ticketContext.generation) return abs;
      if (xhr.status >= 200 && xhr.status < 300) {
        const ticket = JSON.parse(xhr.responseText);
        if (typeof ticket.url !== 'string') return abs;
        if (mediaTickets.size >= 500) mediaTickets.delete(mediaTickets.keys().next().value);
        mediaTickets.set(file, { url: ticket.url, expiresAt: ticketExpiry(ticket.url, base) });
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
