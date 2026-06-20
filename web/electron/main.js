'use strict';

const {
  app, BrowserWindow, ipcMain, Notification,
  shell, nativeTheme, session, Menu, systemPreferences,
} = require('electron');
const path = require('path');
const { net } = require('electron');

// ── 唯一固定的配置入口 ─────────────────────────────────────
// 客户端只硬编码这一个 URL：远程配置服务器地址。
// 以后迁移服务器只需修改 config.dipsin.com/config.json，
// 客户端无需重新编译。
const CONFIG_URL = 'https://config.dipsin.com/config.json';

// ── 环境检测 ──────────────────────────────────────────────────
const IS_DEV     = process.env.ELECTRON_DEV === '1';
const IS_LINUX   = process.platform === 'linux';
const IS_MAC     = process.platform === 'darwin';
const PROD_INDEX = path.join(__dirname, '../dist/index.html');

nativeTheme.themeSource = 'system';

// ── 远程配置缓存（会话级） ──────────────────────────────────
let g_config = {
  api:    '',
  socket: '',
  cdn:    '',
  version:'2.0.0',
};

/**
 * 从 CONFIG_URL 拉取远程配置，超时 5 秒。
 * 失败时使用空值（Electron 生产模式需要 api/socket 字段，
 * 空值会导致后续从 localStorage 或手动切换中读取）。
 */
async function fetchRemoteConfig() {
  try {
    const res = await net.fetch(CONFIG_URL, { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      g_config = {
        api:    data.api    || '',
        socket: data.socket || '',
        cdn:    data.cdn    || '',
        version:data.version|| '2.0.0',
      };
      console.log(`[config] 已加载远程配置: api=${g_config.api}, socket=${g_config.socket}`);
      return true;
    }
  } catch (e) {
    console.warn('[config] 远程配置加载失败:', e.message);
  }
  return false;
}

// ── 窗口工厂 ─────────────────────────────────────────────────
function createWindow() {
  const IS_WIN = process.platform === 'win32';

  // 🎨 Windows 无边框窗口配置（支持Mica背景材质）
  const windowConfig = {
    width:     1280,
    height:    800,
    minWidth:  900,
    minHeight: 600,
    show: false,

    // 🔥 物理超度原生边框（全平台无边框沉浸式）
    frame: false,
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' } : {}),

    // 🔴 Windows Mica/Acrylic 毛玻璃材质 (Windows 11)
    ...(IS_WIN ? {
      vibrancy: 'acrylic',
      visualEffectState: 'active',
      backgroundColor: '#00000000', // 透明背景，配合毛玻璃
    } : {}),

    // 🎯 运行时窗口图标（三端统一配置）
    icon: path.join(__dirname, '../build/icons/icon.ico'),

    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
      spellcheck:       false,
      // 🎨 启用 V8代码缓存，提速渲染
      v8CacheDir:       path.join(__dirname, '.v8cache'),
    },
  };

  const win = new BrowserWindow(windowConfig);

  // 🔥 彻底干掉顶部菜单栏（File/Edit/View...）
  win.setMenu(null);

  // 内容就绪后再显示（防白屏）
  win.once('ready-to-show', () => win.show());

  // ── 向渲染层推送窗口最大化状态 ──────────────────────────────
  win.on('maximize',   () => win.webContents.send('maximize'));
  win.on('unmaximize', () => win.webContents.send('unmaximize'));

  if (IS_LINUX) {
    win.on('enter-full-screen', () => win.webContents.send('maximize'));
    win.on('leave-full-screen', () => win.webContents.send('unmaximize'));
  }

  // ── 加载策略 ───────────────────────────────────────────────
  if (IS_DEV) {
    // 开发模式：加载 Vite HMR（端口由 vite.config.js 决定，默认 3000）
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // ✅ 生产模式：永远加载本地 dist/index.html
    //    渲染进程启动后从远程配置 + localStorage 获取服务器地址
    //    → 无需在 Electron 层面硬编码任何服务器域名
    win.loadFile(PROD_INDEX);
  }

  // target="_blank" 链接交给系统默认浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ── 应用生命周期 ──────────────────────────────────────────────
app.whenReady().then(async () => {
  // 1. 先拉取远程配置（主进程获取后也可通过 IPC 传递给渲染进程）
  await fetchRemoteConfig();

  // 2. 放宽 CSP 允许远程配置加载和实际 API 请求
  //    注意：由于 api/socket 地址是运行时动态的，CSP 中使用 * 通配。
  //    生产环境若需严格 CSP，可将已知域名写入 config.json 的 csp 字段，
  //    然后在 fetchRemoteConfig 成功后动态设置更严格的策略。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' * data: blob: mediastream:; " +
          "connect-src 'self' * data: blob: mediastream:; " +
          "img-src 'self' * data: blob:; " +
          "media-src 'self' * data: blob: mediastream:; " +
          "font-src 'self' * data:;",
        ],
      },
    });
  });

  createWindow();

  // macOS：点击 Dock 图标重建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Windows / Linux：所有窗口关闭时退出应用
app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});

// ── IPC 通道 ──────────────────────────────────────────────────

// 渲染进程请求远程配置（启动时由 preload 调用获取初始配置）
ipcMain.handle('config:get', () => g_config);

// 自定义标题栏窗口控制按钮
ipcMain.on('window:minimize', (_e) => {
  BrowserWindow.getFocusedWindow()?.minimize();
});
ipcMain.on('window:maximize', (_e) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  if (IS_LINUX && win.isFullScreen()) {
    win.setFullScreen(false);
  } else {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  }
});
ipcMain.on('window:close', (_e) => {
  BrowserWindow.getFocusedWindow()?.close();
});

// 查询最大化状态
ipcMain.handle('window:isMaximized', (_e) => {
  const win = BrowserWindow.getFocusedWindow();
  return win ? (win.isMaximized() || (IS_LINUX && win.isFullScreen())) : false;
});

// 系统原生通知
ipcMain.handle('notify:show', (_e, { title, body, icon } = {}) => {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon }).show();
});
