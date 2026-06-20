'use strict';

const {
  app, BrowserWindow, ipcMain, Notification,
  shell, nativeTheme, session, desktopCapturer,
} = require('electron');
const path = require('path');
const fs   = require('fs');
const { net } = require('electron');

const CONFIG_URL  = 'https://dipsin.com/config.json';
const PROD_INDEX  = path.join(__dirname, '../dist/index.html');
const IS_DEV      = process.env.ELECTRON_DEV === '1';
const IS_LINUX    = process.platform === 'linux';
const IS_MAC      = process.platform === 'darwin';

nativeTheme.themeSource = 'system';

let g_config = {
  api:    'https://dipsin.com',
  socket: 'https://dipsin.com',
  cdn:    'https://dipsin.com',
  version:'2.0.1',
};

async function fetchRemoteConfig() {
  try {
    const res = await net.fetch(CONFIG_URL, { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      g_config = {
        api:    data.api    || 'https://dipsin.com',
        socket: data.socket || 'https://dipsin.com',
        cdn:    data.cdn    || 'https://dipsin.com',
        version:data.version|| '2.0.1',
      };
      return true;
    }
  } catch (e) {
    console.warn('[config] 远程配置加载失败，使用默认值:', e.message);
  }
  return false;
}

function createWindow() {
  const IS_WIN = process.platform === 'win32';

  const win = new BrowserWindow({
    width:     1280,
    height:    800,
    minWidth:  900,
    minHeight: 600,
    show:      false,
    frame:     false,
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' } : {}),
    ...(IS_WIN ? { backgroundColor: '#1A2033' } : {}),
    icon: path.join(__dirname, '../dist/icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
      spellcheck:       false,
    },
  });

  win.setMenu(null);
  win.once('ready-to-show', () => win.show());

  win.on('maximize',   () => win.webContents.send('maximize'));
  win.on('unmaximize', () => win.webContents.send('unmaximize'));
  if (IS_LINUX) {
    win.on('enter-full-screen', () => win.webContents.send('maximize'));
    win.on('leave-full-screen', () => win.webContents.send('unmaximize'));
  }

  if (IS_DEV) {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(PROD_INDEX);
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(async () => {
  await fetchRemoteConfig();

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});

// ── IPC ──────────────────────────────────────────────────────

ipcMain.handle('config:get', () => g_config);

ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('window:maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  if (IS_LINUX && win.isFullScreen()) win.setFullScreen(false);
  else win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close());
ipcMain.handle('window:isMaximized', () => {
  const win = BrowserWindow.getFocusedWindow();
  return win ? (win.isMaximized() || (IS_LINUX && win.isFullScreen())) : false;
});

ipcMain.handle('notify:show', (_e, { title, body } = {}) => {
  if (!Notification.isSupported()) return;
  try { new Notification({ title: String(title || '').slice(0,100), body: String(body || '').slice(0,300) }).show(); } catch {}
});

// 截图：最小化窗口 → desktopCapturer 抓屏 → 写 temp → 返回路径
ipcMain.handle('screenshot:capture', async () => {
  const win = BrowserWindow.getFocusedWindow();
  win?.minimize();
  await new Promise(r => setTimeout(r, 350));
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    if (!sources.length) return null;
    const imgPath = path.join(app.getPath('temp'), `vxin-shot-${Date.now()}.png`);
    fs.writeFileSync(imgPath, sources[0].thumbnail.toPNG());
    return imgPath;
  } catch (e) {
    console.error('[screenshot] 失败:', e.message);
    return null;
  } finally {
    win?.show();
    win?.focus();
  }
});

// 安全读文件：只允许读取 temp 目录下的截图
ipcMain.handle('file:readAsBase64', (_e, filePath) => {
  if (typeof filePath !== 'string') return null;
  const tmpDir  = path.resolve(app.getPath('temp'));
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(tmpDir + path.sep)) return null;
  try {
    return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch { return null; }
});
