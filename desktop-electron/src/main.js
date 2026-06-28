'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog,
        globalShortcut, screen, Notification, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const Store = require('electron-store');

// 更新源回退地址（须与 package.json build.publish.url 一致；运行时优先读
// app-update.yml，读取失败才用此常量）。更新源在打包时固化，不随用户切换后端而变。
const UPDATE_FEED_FALLBACK = 'https://dipsin.com/downloads/updates';

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
autoUpdater.logger.transports.file.level = app.isPackaged ? 'error' : 'info';

// 全局异常兜底：主进程未捕获异常/未处理 Promise 拒绝写入日志，避免静默崩溃且无痕迹。
process.on('uncaughtException', (err) => {
  log.error('[main] 未捕获异常:', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('[main] 未处理的 Promise 拒绝:', reason);
});
// 安全：禁止"退出时静默安装"。下载可自动（仅字节，不执行），但安装必须
// 经用户在 UI 中显式确认后由 update:install 触发，避免无确认的代码落地。
// ⚠️ 生产前必须对安装包做代码签名，详见 desktop-electron/SECURITY-RELEASE.md
autoUpdater.autoInstallOnAppQuit = false;
// 安全：关闭自动下载，改由 update-available 事件中先对更新元数据(latest.yml)做
// Ed25519 二次验签，通过后再 downloadUpdate()。使更新真实性不单纯依赖 TLS。
autoUpdater.autoDownload = false;
log.info('v信 Desktop v2 启动');

// 截图读取上限，防止超大 temp 文件导致 OOM
const MAX_READ_BYTES = 20 * 1024 * 1024; // 20 MB

let mainWindow = null;
let tray = null;
let isQuitting = false;

// 引导配置地址（与 web/src/utils/config.js、Android/iOS RemoteConfig 一致）：
// 主进程在建窗口前据此拉 config.json，使 CSP connect-src 跟随远程配置，
// 实现「改 vxin-config 即可换服务器、桌面端无需重编译」。互不依赖，单点故障不影响引导。
const CONFIG_URLS = [
  'https://cdn.jsdelivr.net/gh/zhaocaimao008/vxin-config@main/config.json',
  'https://dipsin.com/config.json',
];

// 安全：校验存储中的 serverUrl，防止被篡改的配置污染 CSP connect-src/origin 推导
const _storedServerUrl = store.get('serverUrl');
// SERVER_URL / API_ORIGIN / WS_ORIGIN 为 let：启动时 loadRemoteServerUrl() 可据远程配置更新。
let SERVER_URL = isValidServerUrl(_storedServerUrl) ? _storedServerUrl : 'https://dipsin.com';

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
let API_ORIGIN = (() => {
  try { return new URL(SERVER_URL).origin; } catch { return 'https://dipsin.com'; }
})();
let WS_ORIGIN = API_ORIGIN.replace(/^http/, 'ws');
// 云存储/CDN 来源（用于 CSP connect-src，使图片/文件直传 xhr PUT 不被拦）。
// 从 config.json 的 cdn 字段解析；默认空(只走后端直传)。
let CDN_ORIGIN = '';

// 启动时从 CONFIG_URLS 依次拉 config.json，取 api(回退 socket) 作为后端地址并据此
// 刷新 SERVER_URL/API_ORIGIN/WS_ORIGIN（驱动 CSP connect-src）。须在 setupSecurity()
// 与 createWindow() 之前 await 调用。远程全部不可达则沿用 store/默认（manual override
// 仍生效，与渲染端 remote→cache→fallback 行为一致）。
async function loadRemoteServerUrl() {
  for (const url of CONFIG_URLS) {
    try {
      const buf = await fetchBuffer(url);
      const cfg = JSON.parse(buf.toString('utf8'));
      const api = (cfg.api && String(cfg.api).trim()) || (cfg.socket && String(cfg.socket).trim()) || '';
      if (api && isValidServerUrl(api)) {
        SERVER_URL = new URL(api).origin;
        API_ORIGIN = SERVER_URL;
        // socket 可与 api 分属不同主机(config.json 的 socket 字段)。单独解析,
        // 使 CSP connect-src 白名单包含真实 ws 主机,否则分离部署时桌面端实时连接被自家CSP拦死。
        const sock = (cfg.socket && String(cfg.socket).trim()) || '';
        const wsBase = (sock && isValidServerUrl(sock)) ? sock : API_ORIGIN;
        WS_ORIGIN  = new URL(wsBase).origin.replace(/^http/, 'ws');
        store.set('serverUrl', SERVER_URL);   // 缓存，供下次冷启动(联网前)使用
        // 更新源：config.json 可选 updates 字段；缺省则随后端同源 /downloads/updates。
        // 换服务器后，老客户端据此拿到新更新源，不被打包时固化的旧地址卡死。
        const upd = (cfg.updates && String(cfg.updates).trim()) || `${SERVER_URL}/downloads/updates`;
        if (isValidServerUrl(upd)) store.set('updateFeed', upd);
        // 云存储域名加入 CSP connect-src，使图片/文件直传(xhr PUT 预签名URL)不被拦截
        const cdn = (cfg.cdn && String(cfg.cdn).trim()) || '';
        if (cdn && isValidServerUrl(cdn)) { try { CDN_ORIGIN = new URL(cdn).origin; } catch {} }
        log.info(`[RemoteConfig] server = ${SERVER_URL} (from ${url})`);
        return;
      }
    } catch (e) {
      log.warn(`[RemoteConfig] ${url} 失败: ${e.message}`);
    }
  }
  log.info(`[RemoteConfig] 远程不可达，沿用 store/默认: ${SERVER_URL}`);
}

// 渲染进程加载的 Vite 打包产物 index.html 路径（开发/打包两种布局）
function indexHtmlPath() {
  return app.isPackaged
    ? path.join(app.getAppPath(), 'web/dist/index.html')
    : path.join(__dirname, '../../web/dist/index.html');
}

// 计算 index.html 中内联 <script>（无 src）的 sha256，用于 CSP script-src
// 以哈希白名单替代 'unsafe-inline'：注入的 <script>/onerror= 等内联脚本将被拦截。
// 哈希在启动时从实际随包发行的 index.html 现算，天然匹配该次构建，无需打包钩子。
function inlineScriptHashes() {
  try {
    const html = fs.readFileSync(indexHtmlPath(), 'utf8');
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    const hashes = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      if (/\bsrc\s*=/i.test(m[1])) continue;           // 外部脚本由 'self' 覆盖
      const digest = crypto.createHash('sha256').update(m[2], 'utf8').digest('base64');
      hashes.push(`'sha256-${digest}'`);
    }
    return hashes;
  } catch (e) {
    log.warn('计算内联脚本哈希失败，CSP 回退 unsafe-inline:', e.message);
    return null;
  }
}

// CSP 价值：禁跨源脚本/插件/iframe、connect 仅限后端、锁 base-uri/form-action。
// scriptSrc 由调用方传入（哈希白名单优先，失败回退 unsafe-inline）。
// style-src 保留 unsafe-inline：存在内联 <style> 且运行时有动态样式注入，风险低。
function buildCSP(scriptSrc) {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${API_ORIGIN} ${WS_ORIGIN}${CDN_ORIGIN && CDN_ORIGIN !== API_ORIGIN ? ' ' + CDN_ORIGIN : ''}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

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

  // 启动时按本次构建的内联脚本现算哈希；成功则去掉 'unsafe-inline'，失败回退。
  // 'unsafe-eval' 暂保留：打包产物经 grep 未见 eval/new Function，可在 GUI 验证
  // 无白屏后移除（详见 SECURITY-RELEASE.md）。
  const hashes = inlineScriptHashes();
  const scriptSrc = (hashes && hashes.length)
    ? `'self' ${hashes.join(' ')} 'unsafe-eval'`
    : `'self' 'unsafe-inline' 'unsafe-eval'`;
  if (hashes && hashes.length) log.info(`CSP: 已用 ${hashes.length} 个内联脚本哈希替代 unsafe-inline`);

  // 为主文档响应注入 CSP（不影响后端 API/WebSocket 响应）。
  // 每次按【当前】API_ORIGIN/WS_ORIGIN/CDN_ORIGIN 动态拼装,不冻结为常量——
  // 否则渲染层 switchServer 切到新服务器并 reload 后,CSP 仍是旧 origin→新后端连接被拦死。
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'mainFrame') {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [buildCSP(scriptSrc)],
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

  mainWindow.loadFile(indexHtmlPath());

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

// ── 更新元数据 Ed25519 二次验签 ─────────────────────────────
// 信任锚是 latest.yml（含安装包 sha512）：只要 latest.yml 经我方私钥签名且校验
// 通过，安装包完整性即被绑定。公钥随包内置（src/update-public-key.pem），私钥由
// 发布方离线保管，发布时用 scripts/sign-update.js 生成 *.sig 上传至更新源。

// 读取内置更新公钥；未配置(文件缺失/占位)返回 null → 跳过验签(回退 TLS)。
function loadUpdatePublicKey() {
  try {
    const pem = fs.readFileSync(path.join(__dirname, 'update-public-key.pem'), 'utf8');
    if (!pem.includes('BEGIN PUBLIC KEY') || pem.includes('PLACEHOLDER')) return null;
    return crypto.createPublicKey(pem);
  } catch {
    return null;
  }
}

// 更新源根地址：优先用远程 config.json 下发并缓存的 updateFeed（换服务器后能切换），
// 其次读 app-update.yml(打包固化)，最后回退常量。
function updateFeedBase() {
  const remote = store.get('updateFeed');
  if (remote && typeof remote === 'string' && isValidServerUrl(remote)) {
    return remote.replace(/\/+$/, '');
  }
  try {
    const cfg = app.isPackaged
      ? path.join(process.resourcesPath, 'app-update.yml')
      : path.join(__dirname, '../dev-app-update.yml');
    const m = fs.readFileSync(cfg, 'utf8').match(/^\s*url:\s*["']?([^"'\s]+)/m);
    if (m && m[1]) return m[1].replace(/\/+$/, '');
  } catch { /* fall through */ }
  return UPDATE_FEED_FALLBACK;
}

// 当前平台/通道对应的更新元数据文件名
function channelYmlName() {
  if (process.platform === 'darwin') return 'latest-mac.yml';
  if (process.platform === 'linux') return 'latest-linux.yml';
  return 'latest.yml';
}

// 拉取一个 https 资源为 Buffer；404 → 返回 null；其余错误 → reject。带超时与大小上限。
function fetchBuffer(url, { allowMissing = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (allowMissing && (res.statusCode === 404 || res.statusCode === 403)) {
        res.resume(); return resolve(null);
      }
      if (res.statusCode !== 200) {
        res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 5 * 1024 * 1024) { req.destroy(); reject(new Error('元数据过大')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

// 验证更新元数据签名。返回：'ok' | 'skip'(未启用) | 'fail'(疑似篡改/校验失败)
async function verifyUpdateSignature() {
  const pub = loadUpdatePublicKey();
  if (!pub) {
    log.warn('更新验签：未配置公钥，回退仅 TLS 信任');
    return 'skip';
  }
  const base = updateFeedBase();
  const ymlUrl = `${base}/${channelYmlName()}`;
  const sigUrl = `${ymlUrl}.sig`;
  let ymlBuf, sigBuf;
  try {
    [ymlBuf, sigBuf] = await Promise.all([
      fetchBuffer(ymlUrl),
      fetchBuffer(sigUrl, { allowMissing: true }),
    ]);
  } catch (e) {
    // 网络/拉取异常：不阻断合法更新(electron-updater 已能取到 yml)，回退 TLS。
    log.warn('更新验签：拉取元数据失败，回退仅 TLS：', e.message);
    return 'skip';
  }
  if (!sigBuf) {
    log.warn('更新验签：未找到 .sig，签名分发尚未启用，回退仅 TLS');
    return 'skip';
  }
  try {
    const ok = crypto.verify(null, ymlBuf, pub, sigBuf);
    if (ok) { log.info('更新验签：元数据签名校验通过'); return 'ok'; }
    log.error('更新验签：签名无效，疑似篡改，已阻止下载');
    return 'fail';
  } catch (e) {
    log.error('更新验签：校验异常，已阻止下载：', e.message);
    return 'fail';
  }
}

// ── 自动更新（验签 → 下载 → 用户确认后安装，不强制重启）──────────
function setupAutoUpdater() {
  autoUpdater.on('update-available', async (info) => {
    log.info('发现新版本:', info.version);
    mainWindow?.webContents.send('update:available', info);
    const verdict = await verifyUpdateSignature();
    if (verdict === 'fail') {
      mainWindow?.webContents.send('update:error', '更新校验失败，已阻止下载');
      return;
    }
    // 'ok' 或 'skip'(未启用/网络回退) 均放行下载；安装仍需用户确认。
    autoUpdater.downloadUpdate().catch((e) => log.error('下载更新失败:', e.message));
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

    // 先据远程 config.json 解析后端地址，再建窗口/装 CSP，使 connect-src 跟随远程配置
    await loadRemoteServerUrl();

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
