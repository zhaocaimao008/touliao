'use strict';

const {
  app, BrowserWindow, ipcMain, Notification,
  shell, nativeTheme, session, desktopCapturer,
  Tray, Menu, nativeImage,
} = require('electron');
const path = require('path');
const fs   = require('fs');
const { net } = require('electron');

// 引导配置地址（按顺序尝试，任意一个成功即用）— 与 web/src/utils/config.js 保持一致
const CONFIG_URLS = [
  'https://cdn.jsdelivr.net/gh/zhaocaimao008/vxin-config@main/config.json',
  'https://dipsin.com/config.json',
];
const PROD_INDEX  = path.join(__dirname, '../dist/index.html');
const IS_DEV      = process.env.ELECTRON_DEV === '1';
const IS_LINUX    = process.platform === 'linux';
const IS_MAC      = process.platform === 'darwin';

nativeTheme.themeSource = 'system';

let g_win = null;      // 主窗口引用（供托盘/角标/闪烁复用）
let g_tray = null;     // 系统托盘
let g_quitting = false; // true=真正退出；否则关闭窗口=隐藏到托盘
let g_unread = 0;      // 记住未读数，用于托盘 tooltip

let g_config = {
  api:    'https://dipsin.com',
  socket: 'https://dipsin.com',
  cdn:    'https://dipsin.com',
  version:'2.0.1',
};

async function fetchRemoteConfig() {
  for (const url of CONFIG_URLS) {
    try {
      const res = await net.fetch(url, { method: 'GET' });
      if (!res.ok) continue;
      const data = await res.json();
      g_config = {
        api:    data.api    || 'https://dipsin.com',
        socket: data.socket || 'https://dipsin.com',
        cdn:    data.cdn    || 'https://dipsin.com',
        version:data.version|| '2.0.1',
      };
      return true;
    } catch (e) {
      console.warn('[config] 引导地址不可达，尝试下一个:', url, e.message);
    }
  }
  console.warn('[config] 所有引导地址均失败，使用默认值');
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
  // 窗口重新聚焦 → 停止任务栏闪烁(用户已注意到)
  win.on('focus', () => { try { win.flashFrame(false); } catch {} });
  // 关闭窗口 = 隐藏到托盘(后台常驻收消息)，而非退出；仅托盘「退出」或 app.quit 才真退。
  win.on('close', (e) => {
    if (!g_quitting) {
      e.preventDefault();
      win.hide();
      if (IS_MAC) app.dock?.hide?.();   // mac 隐藏 Dock 图标，靠菜单栏托盘常驻
    }
  });
  g_win = win;
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
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

// 隐藏到托盘后窗口全关不退出(靠托盘常驻)；真正退出走托盘「退出」→ g_quitting。
app.on('window-all-closed', () => {
  // 有托盘时不自动退出(mac 惯例本就不退；win/linux 也保持后台收消息)
  if (!g_tray && !IS_MAC) app.quit();
});

app.on('before-quit', () => { g_quitting = true; });

/** 显示并聚焦主窗口(从托盘/Dock 唤起) */
function showMainWindow() {
  const win = g_win || BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (IS_MAC) app.dock?.show?.();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** 创建系统托盘：左键唤起窗口，右键菜单(显示/退出)，tooltip 反映未读。 */
function createTray() {
  if (g_tray) return;
  try {
    const iconPath = path.join(__dirname, '../dist/icon.png');
    let img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) img = nativeImage.createEmpty();
    // mac 托盘图标需 template + 小尺寸
    const trayImg = IS_MAC ? img.resize({ width: 18, height: 18 }) : img;
    g_tray = new Tray(trayImg);
    g_tray.setToolTip('v信');
    g_tray.setContextMenu(buildTrayMenu());
    // 左键点击：切换显示/隐藏(win/linux)；mac 左键默认弹菜单，这里也显示窗口
    g_tray.on('click', () => showMainWindow());
    g_tray.on('double-click', () => showMainWindow());
  } catch (e) {
    console.warn('[tray] 创建失败:', e.message);
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开 v信', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { g_quitting = true; app.quit(); } },
  ]);
}

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

// ── 未读角标 ──────────────────────────────────────────────────
// 渲染进程把「未读总数」推给主进程 → 反映到 Dock(mac)/任务栏(win/linux) 角标。
// macOS/Linux(部分 DE): app.setBadgeCount(n) 直接显示数字。
// Windows: 无原生数字角标，用任务栏 overlayIcon 画一个红底数字提示有未读。
ipcMain.on('badge:set', (_e, rawCount) => {
  const count = Math.max(0, Math.min(9999, parseInt(rawCount, 10) || 0));
  g_unread = count;
  try { app.setBadgeCount(count); } catch { /* 平台不支持则忽略 */ }
  // 托盘 tooltip 反映未读
  try { g_tray?.setToolTip(count > 0 ? `v信 · ${count > 99 ? '99+' : count} 条未读` : 'v信'); } catch {}
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  if (process.platform === 'win32') {
    try {
      if (count > 0) {
        const label = count > 99 ? '99+' : String(count);
        win.setOverlayIcon(makeBadgeOverlay(label), `${count} 条未读`);
      } else {
        win.setOverlayIcon(null, '');
      }
    } catch { /* overlay 不支持则忽略 */ }
  }
});

// ── 窗口闪烁提醒 ───────────────────────────────────────────────
// 窗口失焦时收到新消息 → 任务栏/Dock 图标闪烁引起注意(对齐一线 IM 桌面端)。
// 仅在窗口当前未聚焦时闪；聚焦态或渲染进程也可主动 stop。
ipcMain.on('window:flash', (_e, on) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  try {
    if (on && !win.isFocused()) win.flashFrame(true);
    else win.flashFrame(false);
  } catch { /* 平台不支持则忽略 */ }
});

/** 生成一个小红圆底白字的任务栏 overlay 图标（Windows）。用 nativeImage 从 SVG 渲染。 */
function makeBadgeOverlay(label) {
  const { nativeImage } = require('electron');
  const fontSize = label.length >= 3 ? 9 : 11;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'>` +
    `<circle cx='16' cy='16' r='15' fill='#FA5151'/>` +
    `<text x='16' y='16' font-size='${fontSize}' fill='#fff' font-family='sans-serif' font-weight='700' ` +
    `text-anchor='middle' dominant-baseline='central'>${label}</text></svg>`;
  return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}

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
