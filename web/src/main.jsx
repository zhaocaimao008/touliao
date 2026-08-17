import './perf-monitor.js';   // 端到端性能打点（注入 window.__touliaoPerf，须在 App 之前）
import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
// Sentry 异步加载（不阻塞首屏渲染）
import App from './App';
import './design-tokens.css';
import './index.css';
import './mobile-adapt.css';
import { loadRemoteConfig, getConfig } from './utils/config';
import { migrateStorage } from './utils/migrateStorage';
import { initWebVitals } from './utils/webVitals';
import { initImageOptimizer } from './utils/imageOptimizer';
import { setupAxiosInterceptors } from './utils/axiosInterceptor';

// ── Sentry 错误监控（异步懒加载，不阻塞首屏）─────────────
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  const loadSentry = () => import('@sentry/react').then(Sentry => {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      release: `touliao@${__APP_VERSION__}`,
      tracesSampleRate: 0.05,
    });
  }).catch(() => {});
  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadSentry, { timeout: 5000 });
  } else {
    setTimeout(loadSentry, 3000);
  }
}

// ── 通用加载流程 ──────────────────────────────────────────
// 1. 加载远程配置（所有平台统一入口）
// 2. 设置 Axios baseURL
// 3. 启动 React

(async function boot() {
  // 迁移旧版 vxin_* localStorage key
  migrateStorage();

  // 平台判断
  const isElectron = !!window.__ELECTRON_CONFIG__;
  const isMobile   = !!(window.Capacitor && window.Capacitor.isNativePlatform());

  // 1. 加载远程配置
  //    FE-001：Web 端不阻塞首屏——最多等 800ms，超时先用同源相对路径渲染，
  //    config 到达后再补设 baseURL（后续请求自动生效）。
  //    Electron/Capacitor 必须等到完整 URL（相对路径无效），保持原行为。
  const manualUrl = localStorage.getItem('touliao_server_url');
  let cfg = null;
  if (isElectron || isMobile) {
    await loadRemoteConfig();
    cfg = getConfig();
  } else {
    cfg = await Promise.race([
      loadRemoteConfig().catch(() => null),
      new Promise(resolve => setTimeout(() => resolve(null), 800)),
    ]);
  }

  // 2. 设置 Axios baseURL
  //    优先级：运行时手动切换的 URL > 远程配置 > Vite 环境变量
  const apiBase = manualUrl || cfg?.api || import.meta.env.VITE_API_BASE || '';

  if (apiBase) {
    axios.defaults.baseURL = apiBase;
  }
  // 跨域请求必须携带 Cookie，全局开启
  axios.defaults.withCredentials = true;

  // Web 端 config 迟到时补设 baseURL（仅当首次未设置，避免覆盖手动切换）
  if (!isElectron && !isMobile && !manualUrl && !axios.defaults.baseURL) {
    loadRemoteConfig().then(() => {
      const late = getConfig()?.api;
      if (late && !axios.defaults.baseURL) axios.defaults.baseURL = late;
    }).catch(() => {});
  }

  // 设置 Axios 拦截器（CSRF、token 刷新、错误重试）
  setupAxiosInterceptors(axios);

  // 3. Electron / 移动端恢复 Bearer token（localStorage 持久化）
  if (isElectron || isMobile) {
    const stored = localStorage.getItem('touliao_electron_token');
    if (stored) axios.defaults.headers.common['Authorization'] = `Bearer ${stored}`;
  }

  // 4. 平台初始化
  if (isElectron) {
    import('./utils/electron').then(mod => mod.initElectronFeatures()).catch(() => {});
  }

  // 5. 性能监控初始化（非阻塞）
  if (!isElectron && !isMobile) {
    initWebVitals();
    initImageOptimizer();
  }

  // 6. 渲染 React
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
