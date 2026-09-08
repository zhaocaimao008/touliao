import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { clearCache } from '../utils/msgCache';
import { clearCsrfToken, notifyCredentialsUpdated } from '../utils/axiosInterceptor';
import { invalidateMediaTickets } from '../utils/url';
import { activateSession, captureSession, invalidateSession, isOperationCurrent, isOperationGenerationCurrent, SESSION_OWNER_KEY } from '../utils/sessionContext';

// 所有请求自动携带 httpOnly Cookie（同源时浏览器自动附加，跨域需此选项）
axios.defaults.withCredentials = true;

// ── CSRF 防护 ───────────────────────────────────────────────────
// 统一由 utils/axiosInterceptor.js 的拦截器处理（提取 + 附加 X-CSRF-Token），
// 本模块不再重复注册，避免两套拦截器并存互相覆盖（FE-002）。

const AuthContext = createContext(null);

// An Axios retry may rotate credentials, but cannot change the initiating identity.
const canPublishResponse = (operation, response) => isOperationGenerationCurrent(operation) &&
  isOperationCurrent(response.config?._sessionContext || operation);

// Electron 模式下 Cookie 跨域无法自动携带，用 sessionStorage 存 token，
// 设到 axios Authorization header 实现 Bearer 鉴权
const ELECTRON_TOKEN_KEY = 'touliao_electron_token';
// Electron(file://)与移动端(Capacitor 跨域 https://localhost)均无法可靠使用 Cookie，
// 统一改用 Bearer token；用 localStorage 持久化，App 重启后免重新登录。
const isBearerClient = () => !!(window.__ELECTRON_CONFIG__ || window.Capacitor?.isNativePlatform?.());

// 清除 CSRF token 缓存（会话结束/切换账号或服务器时调用）：
// session 与 localStorage 兜底缓存必须一起清，否则旧会话的 token 会残留在
// localStorage，被下一个会话的首个 POST 取用（请求拦截器会 fallback 到它）导致 403。
// FE-002：CSRF 已统一由 utils/axiosInterceptor.js 管理，此处同时清其模块级缓存。
function clearCsrfCache() {
  sessionStorage.removeItem('csrf_token');
  localStorage.removeItem('touliao_csrf_cache');
  clearCsrfToken();
}

function setElectronToken(token) {
  if (!isBearerClient()) return;
  if (token) {
    localStorage.setItem(ELECTRON_TOKEN_KEY, token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    localStorage.removeItem(ELECTRON_TOKEN_KEY);
    delete axios.defaults.headers.common['Authorization'];
  }
  invalidateMediaTickets();
}

// ── 多账号"最近登录"记录 ──────────────────────────────────────────
// 只存 { id, user, lastLoginAt }，不存 token。
// token 始终只在后端签发的 httpOnly Cookie 中，JS 无法读取。
// 切换账号需重新登录（无静默换 Cookie 能力），这是正确的安全边界。
const ACCOUNTS_KEY = 'touliao_accounts_v2';   // v2 = 无 token 版本
const MAX_ACCOUNTS = 15;

function readAccounts() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(a => a?.id && a?.user) : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts.slice(0, MAX_ACCOUNTS)));
}

function upsertAccount(user) {
  const next = [
    { id: user.id, user, lastLoginAt: Date.now() },
    ...readAccounts().filter(a => a.id !== user.id),
  ].slice(0, MAX_ACCOUNTS);
  writeAccounts(next);
  return next;
}

export const AuthProvider = ({ children }) => {
  const [user, setUser]         = useState(null);
  const [accounts, setAccounts] = useState(() => readAccounts());
  const [loading, setLoading]   = useState(true);
  const [outboxScope, setOutboxScope] = useState(null);
  const bindOwner = userData => setOutboxScope(activateSession(
    new URL(axios.defaults.baseURL || '/', window.location.href).href.replace(/\/$/, ''), userData.id
  ));
  const userRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);

  // ── 401 自动踢出 ───────────────────────────────────────────────
  // 多标签页 refresh 竞态修复：同一账号两个标签页的 access token 同时临近过期时，
  // 各自独立触发 /api/auth/refresh（见 utils/axiosInterceptor.js），服务端对 refresh
  // 做"旧 token 用后即黑名单"（auth.controller.js），两个并发请求用的是同一个旧
  // token——先到的那个成功换发新 cookie 并拉黑旧 token，慢一步的那个此时旧 token
  // 已被拉黑，refresh 本身就会收到 401。这个 401 之前会被本拦截器当成"会话失效"
  // 直接强制登出+跳转登录，但实际上账号会话完全正常，只是这个标签页这一次没抢到
  // refresh——错误地把用户从一个好端端的会话里踢出去。
  // 修复：refresh/login 接口自身返回的 401 不算数（已经有各自的失败处理，见
  // axiosInterceptor.js 的 refreshToken()），只有其它接口在"刷新+重试"都失败后仍
  // 收到 401，才是会话真的失效，才应该强制登出。
  useEffect(() => {
    const id = axios.interceptors.response.use(
      res => res,
      err => {
        const url = err.config?.url || '';
        const isAuthBootstrap = url.includes('/auth/refresh') || url.includes('/auth/login');
        if (err.response?.status === 401 && userRef.current && !isAuthBootstrap) {
          if (err.config?._sessionStale) return Promise.reject(err);
          invalidateSession();
          setUser(null);
          setElectronToken(null);
          if (window.__ELECTRON_CONFIG__) window.location.hash = '#/login';
          else window.location.replace('/login');
        }
        return Promise.reject(err);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, []);

  // ── 初始化：恢复 Electron Bearer token，然后验证身份 ────────
  useEffect(() => {
    if (isBearerClient()) {
      const stored = localStorage.getItem(ELECTRON_TOKEN_KEY);
      if (stored) axios.defaults.headers.common['Authorization'] = `Bearer ${stored}`;
    }
    const operation = captureSession();
    let disposed = false;
    axios.get('/api/auth/me', { _sessionContext: operation })
      .then(r => {
        if (disposed || !canPublishResponse(operation, r)) return;
        bindOwner(r.data);
        setUser(r.data);
        setLoading(false);
        // 刷新"最近登录"记录中的用户信息（头像/昵称可能已更新）
        const next = readAccounts().map(a => a.id === r.data.id ? { ...a, user: r.data, lastLoginAt: Date.now() } : a);
        writeAccounts(next);
        setAccounts(next);
      })
      .catch(error => {
        if (disposed || !canPublishResponse(operation, error)) return;
        setUser(null);
        setLoading(false);
      });
    return () => { disposed = true; };
  }, []);

  // ── 登录成功回调（由 Login/Register 页面调用） ─────────────────
  const login = (userData, token) => {
    bindOwner(userData);
    setElectronToken(token || null);
    setUser(userData);
    setLoading(false);
    const next = upsertAccount(userData);
    setAccounts(next);
  };

  // ── 免密切换账号 ──────────────────────────────────────────────
  // 后端凭 httpOnly 的 wallet cookie 校验"本设备登录过该账号"，重签发 token。
  // 成功即换上新账号的 Cookie，reload 重建 socket / 拉取数据。
  // 失败（如 wallet 过期、该账号未在本设备登录过）抛错，调用方回退到密码登录。
  const switchAccount = async (accountId) => {
    invalidateSession();
    const operation = captureSession();
    const response = await axios.post('/api/auth/switch', { userId: accountId }, { _sessionContext: operation });
    if (!canPublishResponse(operation, response)) return;
    const { data } = response;
    const next = upsertAccount(data.user);
    setAccounts(next);
    setUser(data.user);
    bindOwner(data.user);
    clearCsrfCache();
    window.location.reload();
  };

  // ── 移除"最近登录"记录 + 从本设备钱包删除（删除账号，不再可免密切换） ────
  const removeAccount = (accountId) => {
    const next = readAccounts().filter(a => a.id !== accountId);
    writeAccounts(next);
    setAccounts(next);
    // 后端清掉本设备对该账号的免密切换凭证（best-effort）
    axios.post('/api/auth/forget', { userId: accountId }).catch(() => {});
  };

  // ── 登出 ──────────────────────────────────────────────────────
  const logout = async () => {
    invalidateSession();
    let operation = captureSession();
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (!isOperationCurrent(operation)) return;
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!isOperationCurrent(operation)) return;
        if (sub) {
          const cleanupResponse = await axios.delete('/api/notifications/web-subscribe', { data: { endpoint: sub.endpoint }, _sessionContext: operation })
            .catch(error => {
              // A failed cleanup remains best-effort, including after its own refresh.
              if (canPublishResponse(operation, error)) operation = error.config?._sessionContext || operation;
              throw error;
            });
          if (!canPublishResponse(operation, cleanupResponse)) return;
          // Adopt only the checked response revision, never a newly captured login.
          operation = cleanupResponse.config?._sessionContext || operation;
          await sub.unsubscribe();
        }
      }
    } catch { /* best-effort push cleanup; ignore */ }
    if (!isOperationCurrent(operation)) return;
    const response = await axios.post('/api/auth/logout', null, { _sessionContext: operation }).catch(error => error);
    if (!canPublishResponse(operation, response)) return;
    if (userRef.current?.id) removeAccount(userRef.current.id);
    clearCsrfCache();
    clearCache();   // 隐私红线：登出清空离线消息缓存
    setElectronToken(null);
    setUser(null);
  };

  // ── 修改密码：后端改密后旧 token 立即黑名单化，Bearer 客户端(Electron/Capacitor)
  // 必须用响应里的新 token 覆盖本地，否则下一个请求就 401 被强制登出（对齐 change-server 的处理）。
  const changePassword = async (oldPassword, newPassword) => {
    const operation = captureSession();
    const response = await axios.put('/api/auth/change-password', { oldPassword, newPassword }, { _sessionContext: operation });
    if (!canPublishResponse(operation, response)) return;
    const { data } = response;
    setElectronToken(data.token || null);
    notifyCredentialsUpdated();
  };

  // ── 注销账户（需当前密码确认）：账号已删，本地收尾同 logout 但不再调 /logout ──
  const deleteAccount = async (password) => {
    const requestScope = captureSession();
    const response = await axios.post('/api/auth/delete-account', { password }, { _sessionContext: requestScope });
    if (!canPublishResponse(requestScope, response)) return;
    invalidateSession();
    let operation = captureSession();
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (!isOperationCurrent(operation)) return;
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!isOperationCurrent(operation)) return;
        if (sub) {
          const cleanupResponse = await axios.delete('/api/notifications/web-subscribe', { data: { endpoint: sub.endpoint }, _sessionContext: operation })
            .catch(error => {
              if (canPublishResponse(operation, error)) operation = error.config?._sessionContext || operation;
              throw error;
            });
          if (!canPublishResponse(operation, cleanupResponse)) return;
          operation = cleanupResponse.config?._sessionContext || operation;
          await sub.unsubscribe();
        }
      }
    } catch { /* best-effort push cleanup; ignore */ }
    if (!isOperationCurrent(operation)) return;
    if (userRef.current?.id) removeAccount(userRef.current.id);
    clearCsrfCache();
    clearCache();   // 隐私红线：账号已注销，清空离线消息缓存
    setElectronToken(null);
    setUser(null);
  };

  // ── 切换服务器（无需重装客户端） ─────────────────────────────
  // 1. 保存新 URL 到 localStorage（Electron 运行时）和 electron-store（下次启动）
  // 2. 更新 axios baseURL
  // 3. 清除当前登录态 → PrivateRoute 自动跳转登录页 → 用户用新服务器账号重新登录
  const changeServer = async (newUrl) => {
    invalidateSession();
    const operation = captureSession();
    const clean = newUrl.trim().replace(/\/$/, '');
    const response = await axios.post('/api/auth/logout', null, { _sessionContext: operation }).catch(error => error);
    if (!canPublishResponse(operation, response)) return;
    if (window.__ELECTRON_CONFIG__) {
      localStorage.setItem('touliao_server_url', clean);
      window.electronAPI?.setServerUrl?.(clean);
    }
    axios.defaults.baseURL = clean;
    setElectronToken(null);
    clearCsrfCache();
    clearCache();   // 切换服务器=换账号域，清离线消息缓存避免串号
    setUser(null);
    setAccounts([]);
  };

  useEffect(() => {
    const onStorage = event => {
      if (event.key !== SESSION_OWNER_KEY) return;
      invalidateSession();
      setUser(null);
      window.location.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ── 更新本地用户缓存（头像/昵称变更后调用） ─────────────────
  const updateUser = (data) => {
    setUser(prev => {
      const updated = { ...prev, ...data };
      const next = readAccounts().map(a => a.id === updated.id ? { ...a, user: updated } : a);
      writeAccounts(next);
      // 在 updater 外部异步同步 accounts，避免在 updater 函数里调 setState
      setTimeout(() => setAccounts(next), 0);
      return updated;
    });
  };

  return (
    <AuthContext.Provider value={{
      user,
      outboxScope,
      login,
      logout,
      changePassword,
      deleteAccount,
      updateUser,
      changeServer,
      loading,
      accounts,
      switchAccount,
      removeAccount,
      maxAccounts: MAX_ACCOUNTS,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
