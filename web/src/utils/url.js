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
import { clientStorage as localStorage } from './clientStorage';
import { getConfig, isConfigLoaded } from './config';
import { useSyncExternalStore } from 'react';
import { isIsolatedWindow } from './clientStorage';

function getBaseUrl() {
  const manualUrl = localStorage.getItem('touliao_server_url');
  if (manualUrl) return manualUrl;

  // config 可能还未加载（页面渲染时资源先于配置加载）
  if (isConfigLoaded()) {
    const cfg = getConfig();
    if (cfg.api) return cfg.api;
    if (cfg.socket) return cfg.socket;
  }

  return isIsolatedWindow() ? window.location.origin : '';
}

function bearerToken() {
  try { return localStorage.getItem('touliao_electron_token') || ''; } catch { return ''; }
}

// Tickets belong to the exact issuing credential and server. Keep them in memory so old
// sessionStorage entries (including pre-revocation tickets) never survive a reload/login.
const mediaTickets = new Map();
const mediaListeners = new Set();
let revision = 0;
let ticketContext = { token: '', base: '', generation: 0 };
function publish() {
  revision++;
  for (const listener of mediaListeners) listener();
}
function clearMediaTickets() {
  for (const entry of mediaTickets.values()) entry.controller?.abort();
  mediaTickets.clear();
  ticketContext = { token: '', base: '', generation: ticketContext.generation + 1 };
}
export function invalidateMediaTickets() {
  clearMediaTickets();
  publish();
}
function subscribeMedia(listener) {
  mediaListeners.add(listener);
  return () => mediaListeners.delete(listener);
}
const mediaSnapshot = () => revision;
export function useMediaCredentials() {
  return useSyncExternalStore(subscribeMedia, mediaSnapshot);
}
window.addEventListener?.('touliao:credentials-updated', invalidateMediaTickets);
window.addEventListener?.('storage', event => {
  if (isIsolatedWindow()) return;
  if (['touliao_electron_token', 'touliao_server_url', 'touliao_session_revision', null].includes(event.key)) invalidateMediaTickets();
});

function ticketExpiry(url, base) {
  try {
    const token = new URL(url, base).searchParams.get('token');
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Math.min(Date.now() + 9 * 60 * 1000, Number(payload.exp) * 1000 - 1000);
  } catch { return 0; }
}

function resourceInfo(u) {
  if (!u || /^(data:|blob:)/i.test(u)) return { url: u };
  const native = window.Capacitor?.isNativePlatform?.();
  if (!window.__ELECTRON_CONFIG__ && !native && !isIsolatedWindow()) return { url: u };
  const base = getBaseUrl().replace(/\/$/, '');
  if (!base) return { url: u };
  let resource;
  try {
    resource = new URL(u, `${base}/`);
    if (resource.origin !== new URL(base).origin) return { url: u };
  } catch { return { url: u }; }
  const token = bearerToken();
  if (ticketContext.token !== token || ticketContext.base !== base) {
    clearMediaTickets();
    ticketContext = { ...ticketContext, token, base };
  }
  if (!resource.pathname.startsWith('/uploads/')) return { url: resource.href };
  // No renderer may fall back to a shared cookie or reuse a supplied stale ticket.
  const denied = new URL(resource);
  denied.searchParams.set('token', 'unavailable');
  if (!token) return { url: denied.href };
  return { file: resource.pathname, base, token, generation: ticketContext.generation, denied: denied.href };
}

function requestTicket(info, retry = false) {
  const { file, base, token, generation } = info;
  const existing = mediaTickets.get(file);
  if (existing?.promise || existing?.expiresAt > Date.now() || (!retry && existing?.retryAt > Date.now())) return existing;
  const controller = new AbortController();
  const entry = { controller, url: undefined, expiresAt: 0 };
  const current = () => generation === ticketContext.generation && token === bearerToken()
    && base === getBaseUrl().replace(/\/$/, '');
  const timeout = setTimeout(() => controller.abort(), 10000);
  entry.promise = (async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      if (isIsolatedWindow()) headers['X-Touliao-Session'] = 'isolated';
      const response = await fetch(`${base}/api/uploads/ticket?file=${encodeURIComponent(file)}`, {
        headers, credentials: 'include', signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const ticket = await response.json();
      if (typeof ticket.url !== 'string') throw new Error('Invalid media ticket');
      const url = new URL(ticket.url, base);
      const expiresAt = ticketExpiry(url.href, base);
      if (url.origin !== new URL(base).origin || url.pathname !== file || !(expiresAt > Date.now()))
        throw new Error('Invalid media ticket');
      if (!current() || controller.signal.aborted) return undefined;
      entry.url = url.href;
      entry.expiresAt = expiresAt;
      return entry.url;
    } catch {
      if (current()) entry.retryAt = Date.now() + 5000;
      return undefined;
    } finally {
      clearTimeout(timeout);
      entry.promise = null;
      if (current()) publish();
    }
  })();
  if (mediaTickets.size >= 500) {
    for (const [key, value] of mediaTickets) {
      if (!value.promise) { mediaTickets.delete(key); break; }
    }
  }
  mediaTickets.set(file, entry);
  return entry;
}

// Render path is synchronous but never waits for the network. Undefined omits src
// while a deduplicated request is pending; subscribers rerender when it completes.
export function mediaUrl(u) {
  const info = resourceInfo(u);
  if (!info.file) return info.url;
  const entry = requestTicket(info);
  return entry.url || (entry.promise ? undefined : info.denied);
}

// Downloads, clipboard and sharing must await authority before using a URL.
export async function resolveMediaUrl(u) {
  const info = resourceInfo(u);
  if (!info.file) return info.url;
  const entry = requestTicket(info, true);
  const url = entry.promise ? await entry.promise : entry.url;
  if (!url || info.generation !== ticketContext.generation || info.token !== bearerToken()
    || info.base !== getBaseUrl().replace(/\/$/, '')) throw new Error('媒体授权失败，请重试');
  return url;
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
