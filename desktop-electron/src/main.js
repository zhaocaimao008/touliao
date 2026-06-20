'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog,
        globalShortcut, screen, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const Store = require('electron-store');

// ── 配置持久化 ─────────────────────────────────────────────
const store = new Store({
  defaults: {
    serverUrl: 'https://dipsin.com',
    autoLaunch: false,
    windowBounds: { width: 1200, height: 800 },
    minimizeToTray: true,
    notifications: true,
  },
});

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoInstallOnAppQuit = true;
log.info('v信 Desktop v2 启动');

let mainWindow = null;
let tray = null;
let isQuitting = false;

const SERVER_URL = store.get('serverUrl');

// ── 安全：仅允许读取 temp 目录下的截图文件 ──────────────────
function isSafeReadPath(filePath) {
  const tmpDir = app.getPath('temp');
  const resolved = path.resolve(filePath);
  return resolved.startsWith(path.resolve(tmpDir) + path.sep);
}

// ── 安全：验证 URL 格式 ─────────────────────────────────────
function isValidServerUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// ── 主窗口 ─────────────────────────────────────────────────
function createWindow() {
  const bounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 600,
    title: 'v信',
    icon: path.join(__dirname, '../assets/icon.png'),
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,                // 安全：启用沙箱，隔离渲染进程
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false,
    backgroundColor: '#1A2033',
  });

  const webDist = path.join(__dirname, '../../web/dist/index.html');
  mainWindow.loadFile(webDist);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting && store.get('minimizeToTray')) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
    store.set('windowBounds', mainWindow.getBounds());
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // 阻止导航到外部 URL（防止渲染进程跳转）
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('maximize',   () => mainWindow?.webContents.send('window:maximized-change', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized-change', false));
}

// ── 自动更新（用户确认后安装，不强制重启）────────────────────
function setupAutoUpdater() {
  autoUpdater.on('update-available', (info) => {
    log.info('发现新版本:', info.version);
    mainWindow?.webContents.send('update:available', info);
  });

  autoUpdater.on('update-not-available', () => log.info('已是最新版本'));

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', Math.round(progress.percent));
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('更新已下载:', info.version);
    mainWindow?.webContents.send('update:downloaded', info);
    // 不自动安装 — 等用户在 UI 中确认后通过 IPC 触发
  });

  autoUpdater.on('error', (err) => log.error('更新错误:', err.message));
}

// ── 系统托盘 ───────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('v信');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 v信',
      click: () => { mainWindow?.show(); mainWindow?.focus(); },
    },
    { type: 'separator' },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: store.get('autoLaunch'),
      click: (item) => {
        store.set('autoLaunch', item.checked);
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── IPC 处理器（白名单模式）───────────────────────────────
function setupIPC() {
  // 窗口操作
  ipcMain.handle('window:minimize',    () => mainWindow?.minimize());
  ipcMain.handle('window:maximize',    () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('window:close',       () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  // 原生通知
  ipcMain.handle('notification:show', (_, payload) => {
    if (!store.get('notifications')) return;
    // 输入校验
    const title = String(payload?.title || '').slice(0, 100);
    const body  = String(payload?.body  || '').slice(0, 300);
    if (!title) return;
    try {
      const notif = new Notification({ title, body });
      notif.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
      notif.show();
    } catch (e) {
      log.warn('通知失败:', e.message);
    }
  });

  // 选择文件（仅用户操作触发，主进程打开对话框）
  ipcMain.handle('dialog:selectFile', async (_, options) => {
    const filters = Array.isArray(options?.filters) ? options.filters : [
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
      { name: '所有文件', extensions: ['*'] },
    ];
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters,
    });
    return result.canceled ? [] : result.filePaths;
  });

  // 截图：主进程截取 → 写入 temp → 返回路径
  ipcMain.handle('screenshot:capture', async () => {
    mainWindow?.minimize();
    return new Promise((resolve) => {
      setTimeout(async () => {
        try {
          const { createCapturer } = require('./screenshot');
          const imgPath = await createCapturer();
          resolve(imgPath);
        } catch (e) {
          log.error('截图失败:', e);
          resolve(null);
        } finally {
          mainWindow?.show();
          mainWindow?.focus();
        }
      }, 300);
    });
  });

  // 安全读文件：仅允许读取 temp 目录下的截图（renderer 不能读任意路径）
  ipcMain.handle('file:readAsBase64', async (_, filePath) => {
    if (typeof filePath !== 'string') return null;
    if (!isSafeReadPath(filePath)) {
      log.warn('file:readAsBase64 被拒绝（路径越权）:', filePath);
      return null;
    }
    try {
      const data = fs.readFileSync(filePath);
      const ext  = path.extname(filePath).toLowerCase();
      const mimeMap = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp',
      };
      const mime = mimeMap[ext] || 'image/png';
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch (e) {
      log.error('读取截图文件失败:', e.message);
      return null;
    }
  });

  // 服务器配置（仅允许 http/https URL）
  ipcMain.handle('config:setServerUrl', (_, url) => {
    if (typeof url !== 'string' || !isValidServerUrl(url)) {
      log.warn('config:setServerUrl 非法 URL:', url);
      return false;
    }
    store.set('serverUrl', url);
    return true;
  });
  ipcMain.handle('config:getServerUrl', () => store.get('serverUrl'));

  // 系统信息
  ipcMain.handle('system:getPlatform', () => process.platform);

  // 更新：用户在 UI 确认后主动触发安装
  ipcMain.handle('update:install', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });
}

// ── 全局快捷键（截图） ─────────────────────────────────────
// 使用 IPC 通知渲染进程触发截图流程，避免 executeJavaScript
function setupShortcuts() {
  globalShortcut.register('CommandOrControl+Alt+A', () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('shortcut:screenshot');
  });
}

// ── 应用生命周期 ───────────────────────────────────────────
app.whenReady().then(async () => {
  if (store.get('autoLaunch')) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  setupIPC();
  createWindow();
  createTray();
  setupAutoUpdater();
  setupShortcuts();

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
    else mainWindow.show();
  });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

app.on('window-all-closed', () => {
  // 托盘模式：不退出
});
