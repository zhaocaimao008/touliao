// 把后端返回的相对资源路径（如 /uploads/avatars/x.jpg、/api/...）解析成可用的绝对地址。
//
// Web 端：同源，相对路径本就能用，原样返回。
// Electron 桌面端：页面跑在 file:// 下，<img src="/uploads/x.jpg"> 会解析成
//   file:///uploads/x.jpg（不存在）。必须补上服务器地址。
//   注意：axios.defaults.baseURL 只对 axios/fetch 生效，对 <img> 标签无效，
//   所以这里必须显式拼接。
//
// 地址优先级：
//   1. 运行时手动切换（localStorage vxin_server_url）
//   2. 远程配置（Config.api/socket）
//   3. 空值 → Web 同源，相对路径可用
import { getConfig, isConfigLoaded } from './config';

function getBaseUrl() {
  const manualUrl = localStorage.getItem('vxin_server_url');
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
  try { return localStorage.getItem('vxin_electron_token') || ''; } catch { return ''; }
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

  // /uploads 静态资源经 <img>/<video> 加载，无法携带 Authorization header；
  // 桌面/移动端为 Bearer 鉴权，给受保护的 /uploads 资源附带 ?token= 以通过后端兜底鉴权，
  // 不再依赖跨域 Cookie。仅对 /uploads 追加，尽量减少 token 暴露面。
  const token = bearerToken();
  if (token && /\/uploads\//.test(abs)) {
    abs += (abs.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
  }
  return abs;
}

// 跳转到登录页。Electron 跑在 file:// 下，不能用绝对路径 '/login'
// （会跳到 file:///login 白屏），必须用 HashRouter 的 hash 路由。
export function goLogin() {
  if (window.__ELECTRON_CONFIG__) window.location.hash = '#/login';
  else window.location.replace('/login');
}
