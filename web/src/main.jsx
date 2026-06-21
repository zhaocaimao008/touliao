import './perf-monitor.js';   // 端到端性能打点（注入 window.__vxinPerf，须在 App 之前）
import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import App from './App';
import './design-tokens.css';
import './index.css';
import './mobile-adapt.css';
import { loadRemoteConfig, getConfig } from './utils/config';

// ── 通用加载流程 ──────────────────────────────────────────
// 1. 加载远程配置（所有平台统一入口）
// 2. 设置 Axios baseURL
// 3. 启动 React

(async function boot() {
  // 平台判断
  const isElectron = !!window.__ELECTRON_CONFIG__;
  const isMobile   = !!(window.Capacitor && window.Capacitor.isNativePlatform());

  // 1. 加载远程配置
  await loadRemoteConfig();
  const cfg = getConfig();

  // 2. 设置 Axios baseURL
  //    优先级：运行时手动切换的 URL > 远程配置 > Vite 环境变量
  const manualUrl = localStorage.getItem('vxin_server_url');
  const apiBase = manualUrl || cfg.api || import.meta.env.VITE_API_BASE || '';

  if (apiBase) {
    axios.defaults.baseURL = apiBase;
  }
  // 跨域请求必须携带 Cookie，全局开启
  axios.defaults.withCredentials = true;

  // 3. Electron / 移动端恢复 Bearer token（localStorage 持久化）
  if (isElectron || isMobile) {
    const stored = localStorage.getItem('vxin_electron_token');
    if (stored) axios.defaults.headers.common['Authorization'] = `Bearer ${stored}`;
  }

  // 4. 平台初始化
  if (isElectron) {
    import('./utils/electron').then(mod => mod.initElectronFeatures()).catch(() => {});
  }

  // 5. 渲染 React
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
