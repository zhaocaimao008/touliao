/**
 * v信 远程配置模块
 *
 * 启动时从 https://config.dipsin.com/config.json 读取服务器地址，
 * 缓存到 localStorage。配置服务器挂了时读取缓存。
 *
 * 以后迁移服务器只需修改 config.dipsin.com/config.json 内容，
 * 无需重新编译客户端。
 *
 * config.json 格式：
 * {
 *   "api":    "https://api.vxin.com",     // API 服务器（Axios baseURL）
 *   "socket": "https://ws.vxin.com",       // WebSocket 服务器（Socket.io）
 *   "cdn":    "https://cdn.vxin.com",      // CDN（图片/文件/头像等静态资源）
 *   "version":"2.0.0"                     // 版本号
 * }
 *
 * Web 端：api/socket 为空时使用同源相对路径（默认行为）。
 * Electron / Capacitor：必须指定完整 URL。
 */

const CONFIG_URL  = 'https://dipsin.com/config.json';
const CACHE_KEY   = 'vxin_remote_config';
const CACHE_TS    = 'vxin_remote_config_ts';

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
    // 1. 尝试远程拉取
    try {
      const res = await fetch(CONFIG_URL, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        _config = { ...DEFAULTS, ...data };
        // 缓存到 localStorage
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(_config));
          localStorage.setItem(CACHE_TS, Date.now().toString());
        } catch { /* localStorage 不可用时静默忽略 */ }
        _loaded = true;
        return _config;
      }
    } catch { /* 网络错误，静默走缓存 */ }

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
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(6000) });
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
  if (!clean.startsWith('http')) return false;
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
