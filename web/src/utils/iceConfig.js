import axios from 'axios';
import { captureSession, isOperationGenerationCurrent } from './sessionContext';

/**
 * WebRTC ICE 配置拉取（1v1 CallModal 与 GroupCallModal 共用）。
 *
 *  · GET /api/turn/credentials 返回 { iceServers, ttl }（TURN 为 coturn REST 时效凭证，
 *    见 backend-v2/src/modules/turn/turn.routes.js，ttl 默认 3600s）。
 *  · 凭证按 ttl 缓存，到期前 REFRESH_MARGIN_MS 内视为过期重新拉取；缓存绑定当前会话
 *    （换账号/登出后 generation 变化即失效——TURN username 内含 userId）。
 *  · 401：全局 axios 拦截器已做「refresh token → 重放一次」；若仍 401（多标签页 refresh
 *    竞态等），这里再发起一次全新请求——它会再走一遍拦截器的 refresh 流程，只重试一次。
 *  · 仍失败 → 兜底 STUN：先本站 coturn 的 STUN（无需凭证），再 Google STUN；并 console.warn，
 *    避免静默退化成「无 TURN」导致对称 NAT 下打不通。
 */

const TURN_DEFAULT_HOST = 'touliao.cc';
const TURN_STUN_PORT = 3478;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_TTL_S = 3600;

let cache = null; // { config, expiresAt, scope }
let inflight = null; // { scope, promise }
let lastTurnHost = null;

function rememberTurnHost(iceServers) {
  for (const s of iceServers) {
    const urls = Array.isArray(s?.urls) ? s.urls : [s?.urls];
    for (const u of urls) {
      const m = /^turns?:([^:?/]+)/i.exec(String(u || ''));
      if (m) { lastTurnHost = m[1]; return; }
    }
  }
}

export function fallbackIceConfig() {
  return {
    iceServers: [
      { urls: `stun:${lastTurnHost || TURN_DEFAULT_HOST}:${TURN_STUN_PORT}` },
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };
}

async function requestCredentials() {
  try {
    return await axios.get('/api/turn/credentials');
  } catch (err) {
    if (err?.response?.status !== 401) throw err;
    return axios.get('/api/turn/credentials');
  }
}

async function loadIceConfig(scope) {
  try {
    const { data } = await requestCredentials();
    if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
      const config = { iceServers: data.iceServers };
      rememberTurnHost(data.iceServers);
      const ttlMs = (Number(data.ttl) > 0 ? Number(data.ttl) : DEFAULT_TTL_S) * 1000;
      // ttl 很短时 margin 取 ttl 的一半，避免永远判定为过期
      const margin = Math.min(REFRESH_MARGIN_MS, ttlMs / 2);
      if (isOperationGenerationCurrent(scope)) cache = { config, expiresAt: Date.now() + ttlMs - margin, scope };
      return config;
    }
    console.warn('[call] /api/turn/credentials 返回空 iceServers，使用兜底 STUN');
  } catch (err) {
    console.warn('[call] 拉取 TURN 凭证失败，使用兜底 STUN（无 TURN 中继）:', err?.response?.status || err?.message || err);
  }
  return fallbackIceConfig();
}

export async function fetchIceConfig() {
  if (cache && cache.expiresAt > Date.now() && isOperationGenerationCurrent(cache.scope)) return cache.config;
  cache = null;
  if (inflight && isOperationGenerationCurrent(inflight.scope)) return inflight.promise;
  const scope = captureSession();
  const flight = { scope, promise: null };
  flight.promise = loadIceConfig(scope).finally(() => { if (inflight === flight) inflight = null; });
  inflight = flight;
  return flight.promise;
}

// 测试用
export function resetIceConfigCache() { cache = null; inflight = null; lastTurnHost = null; }
