'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog,
        globalShortcut, screen, Notification, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const Store = require('electron-store');

// ── 配置持久化 ─────────────────────────────────────────────
const store = new Store({
  clearInvalidConfig: true,   // 安全：磁盘上配置被篡改/损坏时回退默认值
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
// 安全：禁止"退出时静默安装"。下载可自动（仅字节，不执行），但安装必须
// 经用户在 UI 中显式确认后由 update:install 触发，避免无确认的代码落地。
// ⚠️ 生产前必须对安装包做代码签名，详见 desktop-electron/SECURITY-RELEASE.md
autoUpdater.autoInstallOnAppQuit = false;
log.info('v信 Desktop v2 启动');

// 截图读取上限，防止超大 temp 文件导致 OOM
const MAX_READ_BYTES = 20 * 1024 * 1024; // 20 MB

let mainWindow = null;
let tray = null;
let isQuitting = false;

// 安全：校验存储中的 serverUrl，防止被篡改的配置污染 CSP connect-src/origin 推导
const _storedServerUrl = store.get('serverUrl');
const SERVER_URL = isValidServerUrl(_storedServerUrl) ? _storedServerUrl : 'https://dipsin.com';

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

// ── 安全：后端来源（用于 CSP connect-src）──────────────────────
const API_ORIGIN = (() => {
  try { return new URL(SERVER_URL).origin; } catch { return 'https://dipsin.com'; }
})();
const WS_ORIGIN = API_ORIGIN.replace(/^http/, 'ws');

// 渲染进程从本地 file:// 加载 Vite 打包产物（含内联 module 脚本），
// 故 script-src 必须允许 inline；CSP 的价值集中在：禁止跨源脚本/插件/
// iframe、限制 connect 仅到后端、锁定 base-uri 与 form-action。
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN} ${WS_ORIGIN}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// 权限白名单：聊天客户端需要的最小集合，其余一律拒绝
// （geolocation / serial / hid / usb / bluetooth / midiSysex 等敏感权限均拒绝）
const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media',                    // 语音/视频通话（如启用）
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',               // UI 全屏（视频/图片查看）
  'pointerLock',
]);

// ── 安全加固：CSP / 权限 / 导航 / webview（应用级，覆盖所有 webContents）──
function setupSecurity() {
  const ses = session.defaultSession;

  // 为主文档响应注入 CSP（不影响后端 API/WebSocket 响应）
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'mainFrame') {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP],
          'X-Content-Type-Options': ['nosniff'],
        },
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  // 权限请求：白名单之外全部拒绝
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  // 禁止任何设备访问（HID / 串口 / USB / 蓝牙 / 屏幕共享选源）
  ses.setDevicePermissionHandler(() => false);

  // 所有 webContents 统一加固：禁止外部导航、弹窗、附加 webview
  app.on('web-contents-created', (_e, contents) => {
    const denyExternalNav = (e, url) => {
      // 仅允许停留在本地应用内（file://）；外链交由系统浏览器
      if (!url.startsWith('file://')) {
        e.preventDefault();
        if (/^https?:\/\//.test(url)) shell.openExternal(url).catch(() => {});
      }
    };
    contents.on('will-navigate', denyExternalNav);
    contents.on('will-redirect', denyExternalNav);

    // window.open / target=_blank：拒绝新建窗口，安全外链走系统浏览器
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });

    // 禁止嵌入 <webview>，并清除其潜在的不安全 webPreferences
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });
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
      devTools: !app.isPackaged,    // 安全：生产构建禁用 DevTools
      spellcheck: false,            // 不向外部拼写服务发送输入内容
    },
    show: false,
    backgroundColor: '#1A2033',
  });

  const webDist = app.isPackaged
    ? path.join(app.getAppPath(), 'web/dist/index.html')
    : path.join(__dirname, '../../web/dist/index.html');
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

  // 导航/弹窗/webview 的加固已在 setupSecurity() 中按应用级统一处理

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

  autoUpdater.on('update-downloaded', async (info) => {
    log.info('更新已下载:', info.version);
    mainWindow?.webContents.send('update:downloaded', info);
    // 不静默安装：主进程弹原生确认框，用户同意后才重启安装
    // （渲染层尚无安装按钮；此处保证更新可落地且必经用户确认）
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['稍后', '立即重启安装'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: '发现新版本',
      message: `v信 ${info?.version || ''} 已下载完成`,
      detail: '是否立即重启并安装？你也可以稍后退出应用时再安装。',
    });
    if (response === 1) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
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

  // 安全读文件：仅允许读取本应用在 temp 下生成的截图文件
  // 收窄到 vxin-screenshot-*.png（而非整个 temp 目录），并设大小上限
  ipcMain.handle('file:readAsBase64', async (_, filePath) => {
    if (typeof filePath !== 'string') return null;
    const resolved = path.resolve(filePath);
    if (!isSafeReadPath(resolved)) {
      log.warn('file:readAsBase64 被拒绝（路径越权）:', filePath);
      return null;
    }
    if (!/^vxin-screenshot-\d+\.png$/.test(path.basename(resolved))) {
      log.warn('file:readAsBase64 被拒绝（非本应用截图）:', filePath);
      return null;
    }
    try {
      const { size } = fs.statSync(resolved);
      if (size > MAX_READ_BYTES) {
        log.warn('file:readAsBase64 被拒绝（文件过大）:', size);
        return null;
      }
      const data = fs.readFileSync(resolved);
      return `data:image/png;base64,${data.toString('base64')}`;
    } catch (e) {
      log.error('读取截图文件失败:', e.message);
      return null;
    }
  });

  // 服务器配置（仅 https；并需用户在主进程侧确认，防止渲染进程被注入后
  // 静默把后端重定向到恶意服务器。为支持私有化部署，不限制具体域名）
  ipcMain.handle('config:setServerUrl', async (_, url) => {
    if (typeof url !== 'string' || !isValidServerUrl(url)) {
      log.warn('config:setServerUrl 非法 URL:', url);
      return false;
    }
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:') {
      log.warn('config:setServerUrl 拒绝非 https 地址:', url);
      return false;
    }
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['取消', '确认切换'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: '切换服务器',
      message: '确认将 v信 连接的服务器切换为：',
      detail: u.origin,
    });
    if (response !== 1) {
      log.info('用户取消切换服务器:', u.origin);
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
// 单实例锁：避免多实例导致托盘/配置竞争，第二次启动聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 强制所有渲染进程启用沙箱（即使将来新增窗口忘记设置）
  app.enableSandbox();

  app.whenReady().then(async () => {
    if (store.get('autoLaunch')) {
      app.setLoginItemSettings({ openAtLogin: true });
    }

    setupSecurity();
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
}

app.on('before-quit', () => { isQuitting = true; });

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

app.on('window-all-closed', () => {
  // 托盘模式：不退出
});
