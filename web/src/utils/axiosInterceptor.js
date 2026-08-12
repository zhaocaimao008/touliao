/**
 * Axios 统一拦截器：CSRF token、token 刷新、错误重试、请求队列
 * 提升安全性和用户体验
 */

let csrfToken = null;
let tokenRefreshPromise = null;

/**
 * 从响应头或 Cookie 中提取 CSRF token
 */
function extractCsrfToken(response) {
  const headerToken = response.headers['x-csrf-token'];
  if (headerToken) {
    csrfToken = headerToken;
    return;
  }
  
  // 从 Cookie 中提取（备选方案）
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [key, value] = cookie.trim().split('=');
    if (key === 'csrf_token') {
      csrfToken = value;
      break;
    }
  }
}

/**
 * 刷新 token（防止在请求过程中 token 过期）
 */
async function refreshToken(axios) {
  if (tokenRefreshPromise) return tokenRefreshPromise;
  
  tokenRefreshPromise = axios.post('/api/auth/refresh')
    .then(res => {
      const newToken = res.data?.token;
      if (newToken && (window.__ELECTRON_CONFIG__ || window.Capacitor)) {
        localStorage.setItem('vxin_electron_token', newToken);
        axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
      }
      return newToken;
    })
    .catch(err => {
      // 刷新失败，清除认证状态
      console.error('[axios] Token refresh failed:', err);
      if (window.__ELECTRON_CONFIG__ || window.Capacitor) {
        localStorage.removeItem('vxin_electron_token');
        delete axios.defaults.headers.common['Authorization'];
      }
      // 跳转登录由各组件的 401 拦截处理
      throw err;
    })
    .finally(() => {
      tokenRefreshPromise = null;
    });
  
  return tokenRefreshPromise;
}

/**
 * 判断是否应该重试
 */
function shouldRetry(error) {
  if (!error.config || error.config.__retryCount >= 3) return false;
  
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
      // 提取 CSRF token
      extractCsrfToken(response);
      
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
      
      // 401 未授权 + 非登录接口 → 尝试刷新 token
      if (error.response?.status === 401 && 
          originalRequest && 
          !originalRequest._retry && 
          !originalRequest.url?.includes('/auth/login') &&
          !originalRequest.url?.includes('/auth/refresh')) {
        
        originalRequest._retry = true;
        
        try {
          await refreshToken(axios);
          // 重试原请求
          return axios(originalRequest);
        } catch (refreshError) {
          // 刷新失败，由各组件处理跳转登录
          return Promise.reject(error);
        }
      }
      
      // 自动重试（网络错误或 5xx）
      if (shouldRetry(error)) {
        originalRequest.__retryCount = (originalRequest.__retryCount || 0) + 1;
        const delay = getRetryDelay(originalRequest.__retryCount);
        
        console.log(`[axios] 重试请求 (${originalRequest.__retryCount}/3): ${originalRequest.url}, 延迟 ${Math.round(delay)}ms`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return axios(originalRequest);
      }
      
      // 性能监控（失败请求）
      if (originalRequest?.metadata) {
        const duration = Date.now() - originalRequest.metadata.startTime;
        console.error(`[axios] 请求失败: ${originalRequest.method?.toUpperCase()} ${originalRequest.url} ${duration}ms`, 
                      error.response?.status, error.message);
      }
      
      return Promise.reject(error);
    }
  );
  
  console.log('[axios] 拦截器已初始化');
}

/**
 * 手动设置 CSRF token（用于首次登录后）
 */
export function setCsrfToken(token) {
  csrfToken = token;
}

/**
 * 清除 CSRF token（用于登出）
 */
export function clearCsrfToken() {
  csrfToken = null;
}
