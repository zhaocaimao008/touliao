import { clientStorage as localStorage } from './utils/clientStorage';
import { redact } from './utils/redactTelemetry';
import './perf-monitor.js';   // 端到端性能打点（注入 window.__touliaoPerf，须在 App 之前）
import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
// Sentry 异步加载（不阻塞首屏渲染）
import App from './App';
import './design-tokens.css';
import './index.css';
import './skins.css';   // 皮肤层:微信绿 / 企业微信蓝 (body[data-skin] 变量覆盖,必须在 index.css 之后)
import './mobile-adapt.css';
import { isWindowsDesktop } from './utils/desktopPlatform';
import { loadRemoteConfig, getConfig } from './utils/config';
import { migrateStorage } from './utils/migrateStorage';
import { initWebVitals } from './utils/webVitals';
import { initImageOptimizer } from './utils/imageOptimizer';
import { setupAxiosInterceptors } from './utils/axiosInterceptor';
import { accountWindowId, initAccountWindow, isBearerClient, isIsolatedWindow } from './utils/clientStorage';

// ── Sentry 错误监控（异步懒加载，不阻塞首屏）─────────────
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  const loadSentry = () => import('@sentry/react').then(Sentry => {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      release: `touliao@${__APP_VERSION__}`,
      tracesSampleRate: 0.05,
      beforeSend: event => redact(event),
      beforeSendTransaction: event => redact(event),
      beforeBreadcrumb: breadcrumb => redact(breadcrumb),
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
  if (isWindowsDesktop()) {
    document.documentElement.classList.add('windows-desktop');
    await import('./windows-desktop.css');
  }
  document.documentElement.classList.add('touliao-ui');
  await import('./ui-kit/design-system.css');
  initAccountWindow();
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
  let cfg;
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
  // 全局请求超时兜底：此前没有任何超时配置，一个"连接建立了但服务端/中间设备静默不回包"的
  // 挂起请求会无限期悬挂（不 resolve 也不 reject，axiosInterceptor 的重试逻辑压根不会被触发，
  // 见 AUDIT.md 十二节🟡）。20s 覆盖绝大多数普通 API 调用；大文件上传/下载单独按调用点覆盖
  // 更宽松的超时（见 ChatWindow/Moments/GroupInfo/StickerPanel/Profile 里的 timeout 覆盖）。
  axios.defaults.timeout = 20000;

  // Web 端 config 迟到时处理：
  // 之前是静默补设 baseURL，导致 800ms 超时前发出的请求走了同源、
  // 之后的请求走了远程 api，前后不一致（混合后端 bug）。
  // 修复：记录启动时用的地址；迟到配置的 api 如果不同，只重载一次页面
  // （用 sessionStorage 防循环），保证整个会话地址一致。
  // 同源 /config.json 优先后，标准部署下配置几乎总是及时到达，此分支极少触发。
  if (!isElectron && !isMobile && !manualUrl && !axios.defaults.baseURL) {
    const bootApi = ''; // 启动时 baseURL 为空，即用了同源相对路径
    loadRemoteConfig().then(() => {
      const late = getConfig()?.api || '';
      if (!late || late === bootApi) {
        if (late) axios.defaults.baseURL = late;
        return;
      }
      // 迟到配置指向了不同后端：重载一次，保证会话内地址一致
      const reloaded = sessionStorage.getItem('touliao_cfg_reloaded');
      if (!reloaded) {
        try { sessionStorage.setItem('touliao_cfg_reloaded', '1'); } catch { /* ignore */ }
        console.warn('[config] 迟到配置与启动地址不一致，重载以统一后端:', late);
        location.reload();
      } else {
        // 已重载过仍不一致（极端情况）：接受新地址，不再循环
        axios.defaults.baseURL = late;
      }
    }).catch(() => {});
  }

  // 设置 Axios 拦截器（CSRF、token 刷新、错误重试）
  setupAxiosInterceptors(axios);

  // An older server would silently overwrite the shared login cookie.
  if (isIsolatedWindow()) {
    try {
      // Older service workers cache /api/config without varying by session headers.
      const response = await axios.get('/api/config', { params: { accountWindow: accountWindowId() } });
      if (response.headers['x-touliao-session'] !== 'isolated') throw new Error('unsupported');
    } catch {
      document.getElementById('root').textContent = '独立账号窗口暂不可用，请确认服务器在线并已升级到支持多开的版本。';
      return;
    }
  }

  // 3. Electron / 移动端恢复 Bearer token（localStorage 持久化）
  if (isBearerClient()) {
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
