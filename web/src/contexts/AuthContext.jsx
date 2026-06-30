import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';

// 所有请求自动携带 httpOnly Cookie（同源时浏览器自动附加，跨域需此选项）
axios.defaults.withCredentials = true;

// ── CSRF 防护：响应拦截器 ──────────────────────────────────────────
// 从任何 API 响应头中读取 X-CSRF-Token 并存入 sessionStorage
// 注：使用 sessionStorage 而非 localStorage，标签页关闭即清除，
//     XSS 仍可读取（SameSite=Strict Cookie 是防 CSRF 的主力），
//     但至少不会跨会话持久化。
axios.interceptors.response.use(
  (res) => {
    const csrfHeader = res.headers['x-csrf-token'];
    if (csrfHeader) {
      sessionStorage.setItem('csrf_token', csrfHeader);
      // 移动端浏览器刷新后 sessionStorage 清空但 Cookie 保留会导致 403，
      // 用 localStorage 作为兜底，避免首次 POST 前 token 尚未到达时失败。
      localStorage.setItem('csrf_token_cache', csrfHeader);
    }
    return res;
  },
  (err) => Promise.reject(err)
);

// ── CSRF 防护：请求拦截器 ──────────────────────────────────────────
axios.interceptors.request.use(
  (config) => {
    if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase())) {
      const csrfToken = sessionStorage.getItem('csrf_token') || localStorage.getItem('csrf_token_cache');
      if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
    }
    return config;
  },
  (err) => Promise.reject(err)
);

const AuthContext = createContext(null);

// Electron 模式下 Cookie 跨域无法自动携带，用 sessionStorage 存 token，
// 设到 axios Authorization header 实现 Bearer 鉴权
const ELECTRON_TOKEN_KEY = 'vxin_electron_token';
// Electron(file://)与移动端(Capacitor 跨域 https://localhost)均无法可靠使用 Cookie，
// 统一改用 Bearer token；用 localStorage 持久化，App 重启后免重新登录。
const isBearerClient = () => !!(window.__ELECTRON_CONFIG__ || window.Capacitor?.isNativePlatform?.());

function setElectronToken(token) {
  if (!isBearerClient()) return;
  if (token) {
    localStorage.setItem(ELECTRON_TOKEN_KEY, token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    localStorage.removeItem(ELECTRON_TOKEN_KEY);
    delete axios.defaults.headers.common['Authorization'];
  }
}

// ── 多账号"最近登录"记录 ──────────────────────────────────────────
// 只存 { id, user, lastLoginAt }，不存 token。
// token 始终只在后端签发的 httpOnly Cookie 中，JS 无法读取。
// 切换账号需重新登录（无静默换 Cookie 能力），这是正确的安全边界。
const ACCOUNTS_KEY = 'vxin_accounts_v2';   // v2 = 无 token 版本
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
  const userRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);

  // ── 401 自动踢出 ───────────────────────────────────────────────
  useEffect(() => {
    const id = axios.interceptors.response.use(
      res => res,
      err => {
        if (err.response?.status === 401 && userRef.current) {
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
    axios.get('/api/auth/me')
      .then(r => {
        setUser(r.data);
        // 刷新"最近登录"记录中的用户信息（头像/昵称可能已更新）
        const next = readAccounts().map(a => a.id === r.data.id ? { ...a, user: r.data, lastLoginAt: Date.now() } : a);
        writeAccounts(next);
        setAccounts(next);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // ── 登录成功回调（由 Login/Register 页面调用） ─────────────────
  const login = (userData, token) => {
    setElectronToken(token || null);
    setUser(userData);
    const next = upsertAccount(userData);
    setAccounts(next);
  };

  // ── 免密切换账号 ──────────────────────────────────────────────
  // 后端凭 httpOnly 的 wallet cookie 校验"本设备登录过该账号"，重签发 token。
  // 成功即换上新账号的 Cookie，reload 重建 socket / 拉取数据。
  // 失败（如 wallet 过期、该账号未在本设备登录过）抛错，调用方回退到密码登录。
  const switchAccount = async (accountId) => {
    const { data } = await axios.post('/api/auth/switch', { userId: accountId });
    const next = upsertAccount(data.user);
    setAccounts(next);
    setUser(data.user);
    sessionStorage.removeItem('csrf_token');
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
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) {
          await axios.delete('/api/notifications/web-subscribe', { data: { endpoint: sub.endpoint } });
          await sub.unsubscribe();
        }
      }
    } catch {}
    await axios.post('/api/auth/logout').catch(() => {});
    if (userRef.current?.id) removeAccount(userRef.current.id);
    sessionStorage.removeItem('csrf_token');
    setElectronToken(null);
    setUser(null);
  };

  // ── 切换服务器（无需重装客户端） ─────────────────────────────
  // 1. 保存新 URL 到 localStorage（Electron 运行时）和 electron-store（下次启动）
  // 2. 更新 axios baseURL
  // 3. 清除当前登录态 → PrivateRoute 自动跳转登录页 → 用户用新服务器账号重新登录
  const changeServer = async (newUrl) => {
    const clean = newUrl.trim().replace(/\/$/, '');
    try { await axios.post('/api/auth/logout'); } catch {}
    if (window.__ELECTRON_CONFIG__) {
      localStorage.setItem('vxin_server_url', clean);
      window.electron?.setServerUrl?.(clean);
    }
    axios.defaults.baseURL = clean;
    setElectronToken(null);
    sessionStorage.removeItem('csrf_token');
    setUser(null);
    setAccounts([]);
  };

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
      login,
      logout,
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
