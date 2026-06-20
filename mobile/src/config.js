// v信 移动端远程配置
// 启动时从远程读取服务器地址，缓存到 AsyncStorage。
// 以后迁移服务器只需修改 config.dipsin.com/config.json，无需重新编译。

import AsyncStorage from '@react-native-async-storage/async-storage';

const CONFIG_URL   = 'https://config.dipsin.com/config.json';
const STORAGE_KEY  = 'vxin_server_url';
const CACHE_TS_KEY = 'vxin_server_url_ts';

let _serverUrl = '';

/**
 * 加载远程配置并缓存
 * 优先级：1. 远程配置 2. AsyncStorage 缓存 3. 空值
 */
export async function loadServerUrl() {
  // 1. 尝试远程拉取
  try {
    const res = await fetch(CONFIG_URL, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const url = (data.api || data.socket || '').replace(/\/$/, '');
      if (url) {
        _serverUrl = url;
        try {
          await AsyncStorage.setItem(STORAGE_KEY, _serverUrl);
          await AsyncStorage.setItem(CACHE_TS_KEY, Date.now().toString());
        } catch {}
        console.log('[config] 已加载远程配置:', _serverUrl);
        return _serverUrl;
      }
    }
  } catch { /* 网络错误，静默走缓存 */ }

  // 2. 回退到缓存
  try {
    const cached = await AsyncStorage.getItem(STORAGE_KEY);
    if (cached) {
      _serverUrl = cached;
      console.warn('[config] 使用缓存配置（远程不可达）:', _serverUrl);
      return _serverUrl;
    }
  } catch {}

  // 3. 最终回退：空值
  _serverUrl = '';
  console.warn('[config] 无可用配置，服务器地址为空');
  return _serverUrl;
}

export async function saveServerUrl(url) {
  _serverUrl = url.replace(/\/$/, '');
  try {
    await AsyncStorage.setItem(STORAGE_KEY, _serverUrl);
    await AsyncStorage.setItem(CACHE_TS_KEY, Date.now().toString());
  } catch {}
}

export function getServerUrl() { return _serverUrl; }

/**
 * 把后端返回的相对资源路径补成绝对地址
 */
export function mediaUrl(u) {
  if (!u) return u;
  if (/^(https?:|data:|file:|content:)/i.test(u)) return u;
  const base = _serverUrl.replace(/\/$/, '');
  if (!base) return u;
  return u.startsWith('/') ? base + u : `${base}/${u}`;
}

export const API_BASE   = () => _serverUrl;
export const SOCKET_URL = () => _serverUrl;
