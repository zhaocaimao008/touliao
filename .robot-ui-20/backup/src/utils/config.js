/**
 * v信 远程配置模块（永不重编译换服务器）
 *
 * 启动时依次尝试 CONFIG_URLS 里的每个地址读取服务器配置，任意一个成功即用，
 * 全部失败再读 localStorage 缓存，最后才用硬编码兜底。
 *
 * 关键设计：把「去哪找配置」(CONFIG_URLS) 和「配置里写的服务器」(api/socket/cdn)
 * 彻底分开。以后换服务器只需改 config.json 内容，无需重新编译任何端。
 * CONFIG_URLS 里放多个互不依赖的稳定地址（CDN / 应用服务器），单点挂掉不影响引导。
 *
 * config.json 格式：
 * {
 *   "api":    "https://api.vxin.com",     // API 服务器（Axios baseURL）
 *   "socket": "https://ws.vxin.com",       // WebSocket 服务器（Socket.io）
 *   "cdn":    "https://cdn.vxin.com",      // CDN（图片/文件/头像等静态资源）
 *   "version":"2.0.0"                     // 版本号
 * }
 *
 * 换服务器步骤：编辑 vxin-config 仓库的 config.json → git push（jsDelivr 自动同步，
 * 需立即生效可调 https://purge.jsdelivr.net/gh/zhaocaimao008/vxin-config@main/config.json）。
 *
 * Web 端：api/socket 为空时使用同源相对路径（默认行为）。
 * Electron / Capacitor：必须指定完整 URL。
 */

// 引导配置地址（按顺序尝试，任意一个成功即用）。互不依赖，单点故障不影响整体。
const CONFIG_URLS = [
  'https://cdn.jsdelivr.net/gh/zhaocaimao008/vxin-config@main/config.json', // 主：GitHub+jsDelivr CDN
  'https://dipsin.com/config.json',                                          // 兜底：当前应用服务器（过渡期）
];
const CACHE_KEY   = 'vxin_remote_config';
const CACHE_TS    = 'vxin_remote_config_ts';

// AbortSignal.timeout 在旧 WKWebView(旧版 iOS Capacitor)上可能缺失,直接用会抛 TypeError
// 让所有引导地址「假失败」→ 无谓退化到缓存/兜底。用手写定时器兜底,保证超时控制普遍可用。
export function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const ac = new AbortController();
  setTimeout(() => ac.abort(), ms);
  return ac.signal;
}

const DEFAULTS = {
  api:    '',    // Web 同域时为空（使用相对路径）
  socket: '',    // Web 同域时为空（使用相对路径）
  cdn:    '',
  version:'2.0.1',
};

// Electron 下远程配置和缓存均失败时的硬编码兜底
const ELECTRON_FALLBACK = window?.__ELECTRON_CONFIG__ ? 'https://dipsin.com' : '';

let _config   = null;
let _loaded   = false;
let _loading  = null; // promise singleton

/**
 * 加载远程配置（首次调用触发网络请求，并发调用复用同一个请求）
 * @returns {Promise<object>} 配置对象 { api, socket, cdn, version }
 */
export function loadRemoteConfig() {
  if (_loaded && _config) return Promise.resolve(_config);
  if (_loading) return _loading;

  _loading = (async () => {
    // 1. 依次尝试每个引导地址，任意一个成功即用
    for (const url of CONFIG_URLS) {
      try {
        const res = await fetch(url, { signal: timeoutSignal(5000) });
        if (!res.ok) continue;
        const data = await res.json();
        _config = { ...DEFAULTS, ...data };
        // 缓存到 localStorage
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(_config));
          localStorage.setItem(CACHE_TS, Date.now().toString());
        } catch { /* localStorage 不可用时静默忽略 */ }
        _loaded = true;
        return _config;
      } catch { /* 该地址不可达，尝试下一个 */ }
    }

    // 2. 回退到缓存
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        _config = { ...DEFAULTS, ...JSON.parse(cached) };
        _loaded = true;
        console.warn('[config] 使用缓存配置（远程不可达）');
        return _config;
      }
    } catch { /* 缓存损坏 */ }

    // 3. 最终回退：Electron 用硬编码地址，Web 用空值（同域相对路径）
    _config = {
      ...DEFAULTS,
      ...(ELECTRON_FALLBACK ? { api: ELECTRON_FALLBACK, socket: ELECTRON_FALLBACK, cdn: ELECTRON_FALLBACK } : {}),
    };
    _loaded = true;
    console.warn('[config] 无可用配置（远程+缓存均失败），使用默认值');
    return _config;
  })();

  return _loading;
}

/**
 * 获取已加载的配置
 * @returns {object} { api, socket, cdn, version }
 * @throws {Error} 配置尚未加载
 */
export function getConfig() {
  if (!_loaded) throw new Error('远程配置尚未加载完成，请先调用 loadRemoteConfig()');
  return _config;
}

/**
 * 检查配置是否已加载
 */
export function isConfigLoaded() {
  return _loaded;
}

/**
 * 测试连接（供运行时切换服务器 UI 使用）
 */
export async function testServerConnection(url) {
  if (!url || !url.startsWith('http')) return { ok: false, msg: '格式错误' };
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: timeoutSignal(6000) });
    if (res.ok || res.status < 500) return { ok: true, msg: '连接成功 ✓' };
    return { ok: false, msg: `服务器返回 ${res.status}` };
  } catch {
    return { ok: false, msg: '无法连接到该服务器' };
  }
}

/**
 * 手动切换服务器（Electron 运行时切换 UI）
 * 保存到 localStorage 和配置缓存，重载页面生效
 */
export function switchServer(newUrl) {
  const clean = newUrl.trim().replace(/\/$/, '');
  if (!clean.startsWith('https://')) return false;
  const cfg = {
    api:    clean,
    socket: clean,
    cdn:    clean,
    version: _config?.version || '2.0.0',
  };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cfg));
    localStorage.setItem(CACHE_TS, Date.now().toString());
    _config = cfg;
    _loaded = true;
    return true;
  } catch { return false; }
}
