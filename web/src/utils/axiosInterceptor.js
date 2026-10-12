/**
 * Axios 统一拦截器：CSRF token、token 刷新、错误重试、请求队列
 * 提升安全性和用户体验
 */

import { clientStorage as localStorage } from './clientStorage';
import { captureSession, isOperationCurrent, isOperationGenerationCurrent } from './sessionContext';
import { isBearerClient, isIsolatedWindow } from './clientStorage';

let csrfToken = null;
let csrfRevision = null;
let tokenRefreshPromise = null;
// API 健康追踪：连续失败达阈值时通知全局 banner
let apiFailCount = 0;
let apiDegraded = false;
const API_FAIL_THRESHOLD = 3;
function trackApiSuccess() {
  apiFailCount = 0;
  if (apiDegraded) {
    apiDegraded = false;
    window.dispatchEvent(new Event('touliao:api-recovered'));
  }
}
function trackApiFailure() {
  apiFailCount += 1;
  if (!apiDegraded && apiFailCount >= API_FAIL_THRESHOLD) {
    apiDegraded = true;
    window.dispatchEvent(new Event('touliao:api-degraded'));
  }
}
const revision = () => localStorage.getItem('touliao_session_revision');
const currentRequest = config => !config || isOperationCurrent(config._sessionContext);
function staleRequest(config) {
  config._sessionStale = true;
  return Object.assign(new Error('Session changed during request'), { config, code: 'ERR_CANCELED' });
}

// Signal only after the response has installed the new Cookie/Bearer credential.
export function notifyCredentialsUpdated() {
  // Other tabs share cookies but do not receive this tab's HTTP response callback.
  localStorage.setItem('touliao_session_revision', `${Date.now()}:${Math.random()}`);
  window.dispatchEvent(new Event('touliao:credentials-updated'));
}

/**
 * 从响应头或 Cookie 中提取 CSRF token
 */
function extractCsrfToken(response) {
  if (!currentRequest(response.config)) return;
  csrfRevision = revision();
  const headerToken = response.headers['x-csrf-token'];
  if (headerToken) {
    csrfToken = headerToken;
    return;
  }
  
  // 从 Cookie 中提取（备选方案）
  const cookies = isIsolatedWindow() ? [] : document.cookie.split(';');
  for (const cookie of cookies) {
    const [key, value] = cookie.trim().split('=');
    if (key === 'csrf_token') {
      csrfToken = value;
      break;
    }
  }
}

// ── 刷新熔断 ──────────────────────────────────────────────────────
// refresh 被明确拒绝（401/403）或限流（429 + Retry-After）后，在凭证变化前不再发 refresh：
// 否则每个后续 401 请求都会各自触发一次 refresh + 重放，形成 refresh / me 请求风暴
// （后端对持续发坏 token 的客户端会返回 429）。凭证变化 = session revision 变化
// （本标签页/其它标签页刷新成功、登录），或显式 resetRefreshBlock()（登录/登出）。
let refreshBlock = null; // { until: number, revision }
const DEFAULT_RETRY_AFTER_MS = 60_000;

function parseRetryAfter(value) {
  if (value == null || value === '') return DEFAULT_RETRY_AFTER_MS;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 15 * 60_000);
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), 15 * 60_000));
  return DEFAULT_RETRY_AFTER_MS;
}

function refreshBlocked() {
  if (!refreshBlock) return false;
  if (refreshBlock.revision !== revision() || Date.now() >= refreshBlock.until) {
    refreshBlock = null;
    return false;
  }
  return true;
}

/** 登录 / 切换账号 / 登出后调用：新凭证允许重新尝试 refresh。 */
export function resetRefreshBlock() { refreshBlock = null; }
/** 测试/诊断用 */
export function isRefreshBlocked() { return refreshBlocked(); }

/**
 * 刷新 token（防止在请求过程中 token 过期）
 */
async function refreshToken(axios) {
  if (tokenRefreshPromise && isOperationCurrent(tokenRefreshPromise.scope)) return tokenRefreshPromise.promise;
  const scope = captureSession();
  const flight = { scope, promise: null };
  
  const promise = axios.post('/api/auth/refresh', null, { _sessionContext: scope })
    .then(res => {
      if (!currentRequest(res.config)) throw staleRequest(res.config);
      const newToken = res.data?.token;
      if (newToken && isBearerClient()) {
        localStorage.setItem('touliao_electron_token', newToken);
        axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
      }
      notifyCredentialsUpdated();
      // Rotation may synchronously notify subscribers; never adopt a new login.
      if (!isOperationGenerationCurrent(scope)) throw staleRequest(res.config);
      return { token: newToken, scope: captureSession() };
    })
    .catch(err => {
      if (err.config?._sessionStale || !isOperationCurrent(scope)) throw staleRequest(err.config || { _sessionContext: scope });
      // Rotation is a one-use POST: never retry an uncertain response. Preserve
      // the credential on transport/5xx failures so a later request can recover;
      // only a definitive authentication rejection invalidates it locally.
      console.error('[axios] Token refresh failed:', err);
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        refreshBlock = { until: Infinity, revision: revision() };
      } else if (status === 429) {
        const ra = err.response?.headers?.['retry-after'] ?? err.response?.headers?.get?.('retry-after');
        refreshBlock = { until: Date.now() + parseRetryAfter(ra), revision: revision() };
      }
      if (isBearerClient() && [401, 403].includes(status)) {
        localStorage.removeItem('touliao_electron_token');
        delete axios.defaults.headers.common['Authorization'];
      }
      // 跳转登录由各组件的 401 拦截处理
      throw err;
    })
    .finally(() => {
      if (tokenRefreshPromise === flight) tokenRefreshPromise = null;
    });
  flight.promise = promise;
  tokenRefreshPromise = flight;
  return promise;
}

/**
 * 判断是否应该重试
 */
function shouldRetry(error) {
  if (!error.config || error.config.__retryCount >= 3) return false;
  if (error.config.skipRetry || error.code === 'ERR_CANCELED' || error.config.signal?.aborted) return false;
  if (!/^(get|head|options)$/i.test(error.config.method || 'get')) return false;
  if (error.response?.data?.error_code === 'CLOUD_STORAGE_UNCONFIGURED') return false;
  
  // 网络错误或 5xx 服务器错误才重试
  if (!error.response) return true; // 网络错误
  const status = error.response.status;
  return status >= 500 && status < 600;
}

/**
 * 计算重试延迟（指数退避 + 抖动）
 */
function getRetryDelay(retryCount) {
  const baseDelay = 300;
  const maxDelay = 3000;
  const exponential = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  const jitter = Math.random() * 200; // 0-200ms 抖动
  return exponential + jitter;
}

/**
 * 初始化 Axios 拦截器
 */
export function setupAxiosInterceptors(axios) {
  // ── 请求拦截器 ──
  axios.interceptors.request.use(
    config => {
      if (isIsolatedWindow()) config.headers['X-Touliao-Session'] = 'isolated';
      if (config._sessionContext && !currentRequest(config)) throw staleRequest(config);
      config._sessionRevision = revision();
      config._sessionContext ??= captureSession();
      if (csrfRevision !== revision()) { csrfToken = null; csrfRevision = revision(); }
      const cookieToken = !isIsolatedWindow() && document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('csrf_token='))?.slice(11);
      if (cookieToken) csrfToken = cookieToken;
      // 自动附加 CSRF token（非 GET/HEAD/OPTIONS）
      if (csrfToken && !/^(get|head|options)$/i.test(config.method)) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
      
      // 请求计时（用于性能监控）
      config.metadata = { startTime: Date.now() };
      
      return config;
    },
    error => Promise.reject(error)
  );
  
  // ── 响应拦截器 ──
  axios.interceptors.response.use(
    response => {
      if (!currentRequest(response.config)) return Promise.reject(staleRequest(response.config));
      // 提取 CSRF token
      extractCsrfToken(response);
      trackApiSuccess();
      
      // 性能监控
      if (response.config.metadata) {
        const duration = Date.now() - response.config.metadata.startTime;
        if (duration > 1000) {
          console.warn(`[axios] 慢请求: ${response.config.method?.toUpperCase()} ${response.config.url} ${duration}ms`);
        }
      }
      
      return response;
    },
    async error => {
      const originalRequest = error.config;
      if (originalRequest && (!currentRequest(originalRequest) || originalRequest._sessionStale)) {
        return Promise.reject(staleRequest(originalRequest));
      }
      
      // 401 未授权 + 非登录接口 → 尝试刷新 token
      if (error.response?.status === 401 && 
          originalRequest && 
          !originalRequest.skipRetry &&
          error.code !== 'ERR_CANCELED' && !originalRequest.signal?.aborted &&
          !originalRequest._retry && 
          !originalRequest.url?.includes('/auth/login') &&
          !originalRequest.url?.includes('/auth/refresh')) {
        
        originalRequest._retry = true;

        // refresh 已被明确拒绝/限流且凭证未变：不再 refresh、不再重放，直接交给
        // AuthContext 的 401 拦截器干净登出（避免每个 401 请求各引发一轮 refresh）
        if (refreshBlocked()) return Promise.reject(error);

        try {
          const refreshed = await refreshToken(axios);
          if (!isOperationGenerationCurrent(originalRequest._sessionContext) || !isOperationCurrent(refreshed.scope)) {
            throw staleRequest(originalRequest);
          }
          const newToken = refreshed.token;
          originalRequest._sessionRevision = revision();
          originalRequest._sessionContext = refreshed.scope;
          if (newToken && isBearerClient()) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          // 重试原请求
          return axios(originalRequest);
        } catch (refreshError) {
          if (refreshError.config?._sessionStale) return Promise.reject(staleRequest(originalRequest));
          // 429 限流：服务端已明确要求退避，不再重放原请求
          if (refreshError.response?.status === 429) return Promise.reject(error);
          // 多标签页竞态：本标签页的 refresh 可能因为另一个标签页并发 refresh 抢先
          // 一步而失败（服务端对 refresh 做"旧 token 用后即拉黑"，见 auth.controller.js
          // 的 refresh），但 cookie 是同源共享的——另一个标签页那次成功的 refresh 早
          // 已把新 cookie 写回浏览器。这里刷新失败不代表账号真的掉线，重试一次原始
          // 请求：大概率会带上那个新 cookie 直接成功，避免把这个标签页错误地登出。
          try {
            const retried = await axios(originalRequest);
            refreshBlock = null; // 原请求凭新 cookie 成功 → 会话其实有效，解除熔断
            return retried;
          } catch (retryErr) {
            // 重试也失败 → 才是真的没有可用会话了，交给各组件/全局拦截器处理登出
            return Promise.reject(retryErr);
          }
        }
      }
      
      // 自动重试（网络错误或 5xx）
      if (shouldRetry(error)) {
        originalRequest.__retryCount = (originalRequest.__retryCount || 0) + 1;
        const delay = getRetryDelay(originalRequest.__retryCount);
        
        console.debug(`[axios] 重试请求 (${originalRequest.__retryCount}/3): ${originalRequest.url}, 延迟 ${Math.round(delay)}ms`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        if (!currentRequest(originalRequest)) return Promise.reject(staleRequest(originalRequest));
        return axios(originalRequest);
      }
      
      // 性能监控（失败请求）
      if (originalRequest?.metadata) {
        const duration = Date.now() - originalRequest.metadata.startTime;
        console.error(`[axios] 请求失败: ${originalRequest.method?.toUpperCase()} ${originalRequest.url} ${duration}ms`, 
                      error.response?.status, error.message);
      }
      // 网络错误或 5xx 计入 API 健康统计（401/403 等业务拒绝不计）
      if (!error.response || (error.response.status >= 500 && error.response.status < 600)) {
        trackApiFailure();
      }
      
      return Promise.reject(error);
    }
  );
  
  console.debug('[axios] 拦截器已初始化');
}

/**
 * 手动设置 CSRF token（用于首次登录后）
 */
export function setCsrfToken(token) {
  csrfToken = token;
  csrfRevision = revision();
}

/**
 * 清除 CSRF token（用于登出）
 */
export function clearCsrfToken() {
  csrfToken = null;
  csrfRevision = null;
}

/** 仅测试用：重置模块级 refresh 状态 */
export function __resetAuthRefreshForTests() {
  refreshBlock = null;
  tokenRefreshPromise = null;
}
