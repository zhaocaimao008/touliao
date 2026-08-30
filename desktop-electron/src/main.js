'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog,
        globalShortcut, screen, Notification, shell, session, clipboard, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const Store = require('electron-store');

// ── Windows 渲染修复：硬件加速冲突导致的气泡/图片重叠残影 ──
// 现象：Web 端正常，桌面端出现消息气泡、图片局部残影错乱（GPU 合成器驱动 bug 的典型症状）。
// 方案：全局禁用硬件加速 + GPU 合成 + GPU 缓存，渲染全部走软件光栅化，彻底规避驱动层残影。
// 代价：滚动/动画由 GPU 合成改为 CPU，聊天列表滚动仍流畅（Chromium 软件光栅化足够），
//       视频通话走 WebRTC 软编解码不受影响。若后续换驱动可移除本行恢复硬件加速。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-cache');
// 显式开启高 DPI 感知：Windows 125%/150% 缩放下按物理像素渲染，
// 避免 Chromium 默认模糊缩放导致的边框/气泡边缘错位重绘。
app.commandLine.appendSwitch('high-dpi-support', '1');

// WebAudio 提示音「叮咚」由 AudioContext 合成。Chromium 默认 autoplay 策略要求
// 用户手势后才允许出声，导致 App 刚启动或后台收消息时 AudioContext 被静默阻止 → 没声音。
// 关闭 autoplay 手势门槛，让提示音无条件可播（桌面 IM 提醒的刚需，非网页滥用场景）。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 更新源回退地址（须与 package.json build.publish.url 一致；运行时优先读
// app-update.yml，读取失败才用此常量）。更新源在打包时固化，不随用户切换后端而变。
const UPDATE_FEED_FALLBACK = 'https://touliao.cc/downloads/updates';

// 任务栏红点角标（16x16 PNG，纯红实心圆）。Windows 无原生数字角标，
// 用此 overlay 表示"有未读"。内联 base64 避免运行时绘图依赖（canvas 等）。
const BADGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAKtJREFUOI2t' +
  'k7ENwjAQRZ+jNGnpKZgAiQmYIBUTMAcTMAETMAETMAEbMAETMAETMAETMAETMAEd9lIkIQi8yZad' +
  '7q7f2ffCWMMImIAFVAqpQxAKaWklFJAKaXfKKUUgDHGGFprBTDGGGOMcc45xxjjnHOOMcY55xhj' +
  'jHPOMcYY55xjjDHOOccYY5xzjjHGOOccY4xxzjnGGOOcc4wxxjnnGGOMcc45xxhjnHOOMQYA/8w1' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAgB8Z2AXYyYqZBQAAAABJRU5ErkJggg==';
let _badgeOverlayCache = null;
function buildBadgeOverlay() {
  if (_badgeOverlayCache) return _badgeOverlayCache;
  try {
    _badgeOverlayCache = nativeImage.createFromBuffer(Buffer.from(BADGE_PNG_BASE64, 'base64'));
  } catch { _badgeOverlayCache = nativeImage.createEmpty(); }
  return _badgeOverlayCache;
}

// ── 配置持久化 ─────────────────────────────────────────────
const store = new Store({
  clearInvalidConfig: true,   // 安全：磁盘上配置被篡改/损坏时回退默认值
  defaults: {
    serverUrl: 'https://touliao.cc',
    autoLaunch: false,
    windowBounds: { width: 1200, height: 800 },
    minimizeToTray: true,
    notifications: true,
    shortcuts: {
      screenshot: 'CommandOrControl+Alt+A',
    },
  },
});

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = app.isPackaged ? 'error' : 'info';

// 彻底禁用 electron-updater 的发布者签名校验（publisherName 验证）。
// 根因：electron-builder 打包时把 publisherName:"vxin" 嵌入 app-update.yml，
// updater 下载新 exe 后调用 verifyUpdateCodeSignature 验证 Windows 代码签名发布者，
// 无签名证书的 exe → Status:2 "not digitally signed" → 报错拒绝安装。
// 改 package.json 只影响新打的包，已装用户的旧 app-update.yml 不变，仍会触发验签。
// 覆盖 verifyUpdateCodeSignature 为空实现后，新包里不再做发布者验证，
// 从此次版本起更新不再报错。安全仍由 HTTPS + 我们的 Ed25519 二次验签保障。
autoUpdater.verifyUpdateCodeSignature = () => Promise.resolve(null);

// 全局异常兜底：主进程未捕获异常/未处理 Promise 拒绝写入日志，避免静默崩溃且无痕迹。
process.on('uncaughtException', (err) => {
  log.error('[main] 未捕获异常:', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('[main] 未处理的 Promise 拒绝:', reason);
});
// 安全（优化）：autoInstallOnAppQuit = true 允许用户点"稍后"后，在下次正常退出 App 时
// 自动完成覆盖安装，避免手动卸载重装的繁琐。这不降低安全性，因为：
//   - 安装包已在 download 前通过 TLS + Ed25519 二次验签（见下方 autoDownload 逻辑），
//     不是"无确认的任意代码落地"。
//   - 退出时安装是 Electron 原生的覆盖安装流程，保留用户数据，不引入新的执行路径。
//   - update-downloaded 事件仍保留确认弹框（立即重启安装），与"最终无感"互补。
// ⚠️ 生产前必须对安装包做代码签名，详见 desktop-electron/SECURITY-RELEASE.md
autoUpdater.autoInstallOnAppQuit = true;
// 安全：关闭自动下载，改由 update-available 事件中先对更新元数据(latest.yml)做
// Ed25519 二次验签，通过后再 downloadUpdate()。使更新真实性不单纯依赖 TLS。
autoUpdater.autoDownload = false;
log.info('投聊 Desktop v2 启动');

// 截图读取上限，防止超大 temp 文件导致 OOM
const MAX_READ_BYTES = 20 * 1024 * 1024; // 20 MB

// 下载完成后「自动打开」的黑名单：可执行 / 脚本 / 安装包类不自动运行，
// 仅在文件管理器中定位，交用户自行决定，避免下载即执行（drive-by）。
const NO_AUTO_OPEN_EXTS = new Set([
  '.exe', '.msi', '.msix', '.bat', '.cmd', '.com', '.scr', '.ps1', '.psm1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.jar', '.reg', '.lnk',
  '.dll', '.sys', '.sh', '.bash', '.zsh', '.command', '.app', '.dmg', '.pkg',
  '.deb', '.rpm', '.apk', '.appimage', '.run', '.bin',
]);

let mainWindow = null;
let tray = null;
let _trayBaseIcon = null;    // 托盘正常态图标缓存（闪烁时还原用）
let _trayFlashTimer = null;  // 托盘闪烁定时器句柄
// 下一个下载项的文件名（渲染进程经 file:download 传入，will-download 消费一次）
let g_pendingDownloadName = null;
// 2026-08-29 统一附件系统：下载完成后是否自动用系统默认应用打开该文件。
// 默认 false——PDF/Word/Excel/PPT/图片/视频/音频这些格式投聊自己就能App内预览
// (见 web 端 FilePreview/ImagePreview/VideoPreview)，用户点"保存到本地"只是想要
// 一份本地文件，不需要（也不应该）再弹出系统默认程序（Windows上PDF的系统默认
// 程序常年是Edge，这正是本次要修的"点PDF跳浏览器"根因）。只有点了"用其他应用
// 打开"这个需要用户主动选择的动作时才传 true。
let g_pendingAutoOpen = false;
let isQuitting = false;

// 引导配置地址（与 web/src/utils/config.js、Android/iOS RemoteConfig 一致）：
// 主进程在建窗口前据此拉 config.json，使 CSP connect-src 跟随远程配置，
// 实现「改 touliao 配置即可换服务器、桌面端无需重编译」。互不依赖，单点故障不影响引导。
const CONFIG_URLS = [
  'https://touliao.cc/config.json',
  'https://www.touliao.cc/config.json',
];

// 渲染进程(src/utils/config.js)也会拉这些 config 源做后端发现；其 origin 必须进 CSP
// connect-src，否则被自家 CSP 拦（onHeadersReceived 注入的策略同样作用于渲染层 fetch）。
// 去重后供 buildCSP 使用。缺了它：桌面端拉主 config 源(jsDelivr)必被拦，弱网/换服务器时
// 后端发现退化，控制台刷 CSP 报错。
const CONFIG_ORIGINS = [...new Set(
  CONFIG_URLS.map((u) => { try { return new URL(u).origin; } catch { return ''; } }).filter(Boolean)
)];

// 安全：校验存储中的 serverUrl，防止被篡改的配置污染 CSP connect-src/origin 推导
const _storedServerUrl = store.get('serverUrl');
// SERVER_URL / API_ORIGIN / WS_ORIGIN 为 let：启动时 loadRemoteServerUrl() 可据远程配置更新。
let SERVER_URL = isValidServerUrl(_storedServerUrl) ? _storedServerUrl : 'https://touliao.cc';

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
  try { return new URL(SERVER_URL).origin; } catch { return 'https://touliao.cc'; }
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
  await Promise.race([
    loadRemoteServerUrlInner(),
    // 兜底超时：两个 config 源各 15s 超时，国内直连 jsDelivr 常年超时/被墙，
    // 顺序 await 导致启动最长卡 30s，此间 createWindow() 都还没调用——表现为
    // 双击图标后长时间无任何窗口（黑屏/无反应）。5s 后不再等待，直接用
    // store/默认地址建窗，remote 配置若稍后到达仍会在下次冷启动生效。
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
}

async function loadRemoteServerUrlInner() {
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
    // connect-src：后端 API/WS + 可选 CDN + config 发现源(jsDelivr 等)。config 源
    // 若与 API/CDN 重复由后续去重过滤，避免重复 token。
    `connect-src ${[...new Set(["'self'", API_ORIGIN, WS_ORIGIN,
      ...(CDN_ORIGIN && CDN_ORIGIN !== API_ORIGIN ? [CDN_ORIGIN] : []),
      ...CONFIG_ORIGINS].filter(Boolean))].join(' ')}`,
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

  // 文件下载：主进程接管（渲染进程跑 file://，fetch 跨域取 /uploads 会被 CORS 拦、<a download> 跨域也失效）。
  // 流式落盘到「下载」目录、不弹保存框，完成后用系统默认应用打开 → 满足「不跳网页、下完直接点开」。
  ses.on('will-download', (_e, item) => {
    const raw = g_pendingDownloadName || item.getFilename() || `file_${Date.now()}`;
    g_pendingDownloadName = null;
    const autoOpen = g_pendingAutoOpen;
    g_pendingAutoOpen = false;
    const safe = String(raw).replace(/[/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || `file_${Date.now()}`;
    // 同名去重：设了显式保存路径就绕过 Electron 的自动改名,这里手动补「file (1).ext」,避免静默覆盖已存在文件
    const dir = app.getPath('downloads');
    let savePath = path.join(dir, safe);
    if (fs.existsSync(savePath)) {
      const ext = path.extname(safe);
      const base = safe.slice(0, safe.length - ext.length);
      for (let i = 1; i < 1000; i++) {
        const cand = path.join(dir, `${base} (${i})${ext}`);
        if (!fs.existsSync(cand)) { savePath = cand; break; }
      }
    }
    item.setSavePath(savePath);
    item.once('done', (_ev, state) => {
      if (state !== 'completed') return;
      // 可执行/脚本/安装包：不自动运行，仅在文件管理器中定位，交用户决定
      const ext = path.extname(savePath).toLowerCase();
      if (NO_AUTO_OPEN_EXTS.has(ext)) {
        log.info('下载完成（可执行类，不自动打开，仅定位）:', savePath);
        shell.showItemInFolder(savePath);
      } else if (autoOpen) {
        shell.openPath(savePath).catch(() => {});
      } else {
        log.info('下载完成（App内可预览的格式，不自动打开，仅落盘）:', savePath);
      }
    });
  });

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

// 校验/收敛持久化的窗口尺寸：防止磁盘配置被改成非法值（NaN/负数/过大）导致
// BrowserWindow 构造异常或创建不可见窗口。宽高钳制到合理区间，缺省回退默认。
function sanitizeBounds(raw) {
  const def = { width: 1200, height: 800 };
  const b = (raw && typeof raw === 'object') ? raw : def;
  const clamp = (v, min, max, fallback) =>
    (Number.isFinite(v) && v >= min ? Math.min(v, max) : fallback);
  return {
    width:  clamp(b.width, 900, 10000, def.width),
    height: clamp(b.height, 600, 10000, def.height),
  };
}

// ── 主窗口 ─────────────────────────────────────────────────
function createWindow() {
  const bounds = sanitizeBounds(store.get('windowBounds'));

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 600,
    title: '投聊',
    icon: path.join(__dirname, '../assets/icon.png'),
    frame: false,
    titleBarStyle: 'hidden',
    // 高 DPI 适配：以内容区尺寸为准计算窗口尺寸，避免 Windows 125%/150% 缩放下
    // 边框/标题栏补偿导致的内容偏移与撕裂
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,                // 安全：启用沙箱，隔离渲染进程
      // 固定页面缩放 100%（Windows 系统缩放由 high-dpi-support 以物理像素处理，
      // 避免 Chromium 默认缩放 + 系统缩放叠加导致模糊/错位）
      zoomFactor: 1.0,
      // 沙箱化 preload 无法可靠 require 本地文件；用 app.getVersion()(取自打包 package.json)
      // 经启动参数同步下发真实版本，替代 preload 里读错文件(读到仓库根 2.0.0)的旧写法。
      // 一并下发运行时解析出的真实后端地址，避免 preload 里硬编码旧域名误导渲染层。
      additionalArguments: [
        `--vxin-app-version=${app.getVersion()}`,
        `--vxin-server-url=${SERVER_URL}`,
      ],
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,    // 安全：生产构建禁用 DevTools
      spellcheck: false,            // 不向外部拼写服务发送输入内容
      // 窗口失焦/最小化/后台时不节流：否则 WebAudio 提示音、定时器被暂停 → 后台收消息
      // 听不到「叮咚」。桌面 IM 需要后台常驻提醒，关闭节流是刚需。
      backgroundThrottling: false,
    },
    show: false,
    backgroundColor: '#1A2033',
  });

  mainWindow.loadFile(indexHtmlPath());

  // 加载失败/渲染进程崩溃兜底：否则用户只见纯色空窗、无提示无入口。
  // did-fail-load 的 errorCode -3 是主动中断(如 loadFile 被后续导航取代)，忽略。
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc, url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !mainWindow) return;
    log.error('页面加载失败:', errorCode, errorDesc, url);
    dialog.showMessageBox(mainWindow, {
      type: 'error', title: '投聊',
      message: '界面加载失败',
      detail: `错误：${errorDesc || errorCode}`,
      buttons: ['重试', '退出'], defaultId: 0, cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) mainWindow?.loadFile(indexHtmlPath());
      else { isQuitting = true; app.quit(); }
    }).catch(() => {});
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error('渲染进程退出:', details?.reason);
    if (details?.reason === 'clean-exit' || !mainWindow) return;
    mainWindow.loadFile(indexHtmlPath());
  });

  let hasShownWindow = false;
  const showWindowOnce = () => {
    if (hasShownWindow || mainWindow.isDestroyed()) return;
    hasShownWindow = true;
    mainWindow.show();
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  };

  mainWindow.once('ready-to-show', showWindowOnce);

  // 兜底：若渲染进程崩溃/被 CSP 拦截等异常导致 ready-to-show 永不触发，
  // 窗口会一直停留在 show:false 状态——表现为双击图标后完全无窗口（俗称"黑屏"）。
  // 10s 后强制显示，即使内容还没渲染完，也比长期无任何窗口要好，
  // 且此时用户至少能看到窗口/背景色，可判断是白屏/崩溃还是网络问题。
  setTimeout(() => {
    if (!hasShownWindow) {
      log.warn('[Window] ready-to-show 10s 未触发，强制显示窗口兜底');
      showWindowOnce();
    }
  }, 10000);

  // 记住窗口尺寸：仅在非最大化/非最小化时记录正常尺寸，否则下次会以 0/怪异尺寸启动。
  const saveBounds = () => {
    if (mainWindow && !mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  };

  mainWindow.on('close', (e) => {
    // 无论走托盘还是真正退出，都先保存当前尺寸，避免「缩放后关到托盘 → 尺寸丢失」。
    saveBounds();
    // 仅在托盘存在时才「关到托盘」：否则窗口隐藏后无入口可恢复，等于失联。
    if (!isQuitting && store.get('minimizeToTray') && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // 导航/弹窗/webview 的加固已在 setupSecurity() 中按应用级统一处理

  mainWindow.on('maximize',   () => mainWindow?.webContents.send('window:maximized-change', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized-change', false));

  // 窗口重新聚焦 → 停止任务栏闪烁（用户已回到窗口，无需继续提醒）
  mainWindow.on('focus', () => { try { mainWindow?.flashFrame(false); } catch { /* noop */ } stopTrayFlash(); });
  mainWindow.on('show',  () => { stopTrayFlash(); });
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

// 验证更新元数据签名。返回：'ok' | 'skip'(未启用验签) | 'fail'(疑似篡改/校验失败)
// 安全策略（P1 修复）：只有「公钥未配置」才允许回退仅 TLS（skip）——那是验签功能
// 压根没启用。一旦公钥已配置，任何「拉取元数据失败 / .sig 缺失 / 网络异常」都视为
// fail 并阻止下载：若回退 TLS，攻击者只需让 .sig 拉取失败即可降级到无签名校验，
// 使整条 Ed25519 防线形同虚设。
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
    // 公钥已配置但元数据拉取失败：阻止下载（安全优先）。合法更新重试即可，
    // 若持续失败说明更新源异常，不应降级到无签名校验。
    log.error('更新验签：拉取元数据失败，已阻止下载（安全策略）：', e.message);
    return 'fail';
  }
  if (!sigBuf) {
    // 公钥已配置但 .sig 缺失：阻止下载。发布侧须确保 sign-update.js 已生成并
    // 上传 .sig（发布流水线强校验），否则视为更新通道不完整。
    log.error('更新验签：未找到 .sig 签名文件，已阻止下载（安全策略）');
    return 'fail';
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
    // 渲染层 UpdateBanner 已有「立即重启安装」按钮，由它统一接管确认逻辑；
    // 主进程不再弹原生 dialog，避免两套 UI 同时出现打架、且 dialog 阻塞事件循环。
    // autoInstallOnAppQuit=true 兜底：用户不点 banner 时，退出 App 自动安装。
    // 安全说明：能走到 update-downloaded 说明元数据已通过 Ed25519 验签（fail 会
    // 在 update-available 阶段阻止 downloadUpdate），自动安装仅覆盖已验签的包。
    mainWindow?.webContents.send('update:downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    log.error('更新错误:', err.message);
    mainWindow?.webContents.send('update:error', err.message);
  });
}

// ── 系统托盘 ───────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  let trayIcon = nativeImage.createFromPath(iconPath);
  // 图标缺失/损坏时 createFromPath 返回空图，new Tray(空图) 在部分平台会抛异常导致
  // 启动崩溃。空图则退回一个 1x1 占位图，保证托盘可创建、应用能正常起。
  if (trayIcon.isEmpty()) {
    log.warn('托盘图标缺失或无法读取:', iconPath);
    trayIcon = nativeImage.createEmpty();
  } else {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }
  _trayBaseIcon = trayIcon;   // 缓存正常态图标，供闪烁时还原
  try {
    tray = new Tray(trayIcon);
  } catch (e) {
    log.error('创建系统托盘失败，跳过托盘（应用仍可用）:', e.message);
    return;
  }
  tray.setToolTip('投聊');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 投聊',
      click: () => { mainWindow?.show(); mainWindow?.focus(); },
    },
    {
      label: '检查更新',
      click: () => {
        mainWindow?.show(); mainWindow?.focus();
        autoUpdater.checkForUpdates().catch((e) => {
          mainWindow?.webContents.send('update:error', `检查失败：${e.message}`);
        });
      },
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
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });  // 单击也打开（Windows 习惯）
}

// ── 托盘图标闪烁（关到托盘时提示未读，不弹窗口，符合微信/QQ 习惯）──────
// 在「正常图标」与「空图标」间切换，形成闪烁；用户打开窗口后停止并还原。
function startTrayFlash() {
  if (!tray || _trayFlashTimer) return;
  let on = true;
  _trayFlashTimer = setInterval(() => {
    if (!tray || tray.isDestroyed?.()) { stopTrayFlash(); return; }
    try {
      tray.setImage(on ? nativeImage.createEmpty() : (_trayBaseIcon || nativeImage.createEmpty()));
      tray.setToolTip(on ? '投聊 · 有新消息' : '投聊');
    } catch { /* noop */ }
    on = !on;
  }, 600);
}

function stopTrayFlash() {
  if (_trayFlashTimer) { clearInterval(_trayFlashTimer); _trayFlashTimer = null; }
  if (tray && _trayBaseIcon) {
    try { tray.setImage(_trayBaseIcon); tray.setToolTip('投聊'); } catch { /* noop */ }
  }
}

// 安全：IPC 来源校验。仅接受来自本应用主窗口 webContents 的调用，拒绝任何其它
// webContents（如将来意外附加的 webview / 子窗口，或被劫持的帧）触发敏感 IPC。
function isTrustedSender(event) {
  return !!mainWindow && event?.sender === mainWindow.webContents;
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

  // 文件下载：渲染进程请求 → 主进程 downloadURL（配合 setupSecurity 的 will-download 落盘+打开）
  ipcMain.handle('file:download', (_e, payload) => {
    if (!isTrustedSender(_e)) return;
    const url = payload?.url;
    if (typeof url !== 'string' || !url || !mainWindow) return;
    // 安全：仅允许从当前后端 / 已配置 CDN 下载。否则被注入的渲染进程可让主进程
    // 从任意域拉文件并自动打开（drive-by 下载）。API_ORIGIN/CDN_ORIGIN 为 let，
    // 随 switchServer 动态更新，故在调用时求值（与 CSP connect-src 白名单同源）。
    let origin;
    try { origin = new URL(url).origin; } catch { log.warn('file:download 非法 URL:', url); return; }
    const allowed = [API_ORIGIN, CDN_ORIGIN].filter(Boolean);
    if (!allowed.includes(origin)) {
      log.warn('file:download 拒绝非白名单来源:', origin);
      return;
    }
    g_pendingDownloadName = (typeof payload?.filename === 'string' && payload.filename.trim())
      ? payload.filename.trim() : null;
    g_pendingAutoOpen = payload?.autoOpen === true;
    mainWindow.webContents.downloadURL(url);
  });

  // 复制图片到系统剪贴板：渲染进程跑在 file://，图片是跨源 https(带 ?token=)，
  // fetch/canvas 会撞 CORS/画布污染，故由主进程拉取后写入原生剪贴板。
  // 安全：与 file:download 同款白名单，仅允许后端 / 已配置 CDN 来源，防注入的渲染进程拉任意域。
  ipcMain.handle('clipboard:copyImage', async (_e, url) => {
    if (!isTrustedSender(_e)) return false;
    if (typeof url !== 'string' || !url) return false;
    let origin;
    try { origin = new URL(url).origin; } catch { return false; }
    const allowed = [API_ORIGIN, CDN_ORIGIN].filter(Boolean);
    if (!allowed.includes(origin)) { log.warn('clipboard:copyImage 拒绝非白名单来源:', origin); return false; }
    try {
      const buf = await fetchBuffer(url);        // 复用带超时+大小上限的 https 拉取
      if (!buf) return false;
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return false;           // 非图片/解码失败
      clipboard.writeImage(img);
      return true;
    } catch (err) {
      log.warn('clipboard:copyImage 失败:', err.message);
      return false;
    }
  });

  // 原生通知
  ipcMain.handle('notification:show', (_e, payload) => {
    if (!isTrustedSender(_e)) return;
    if (!store.get('notifications')) return;
    // 输入校验
    const title = String(payload?.title || '').slice(0, 100);
    const body  = String(payload?.body  || '').slice(0, 300);
    if (!title) return;
    try {
      const notif = new Notification({ title, body });
      notif.on('click', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();   // 最小化时 show() 不会还原,需显式 restore
        mainWindow.show();
        mainWindow.focus();
      });
      notif.show();
    } catch (e) {
      log.warn('通知失败:', e.message);
    }
  });

  // 任务栏/Dock 闪烁：他人来消息且窗口失焦时引起注意。
  // 渲染端已在调用 electronAPI.flashFrame，但此前主进程未实现 → 调用被静默吞掉。
  ipcMain.handle('window:flashFrame', (_e, on) => {
    if (!isTrustedSender(_e)) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // 窗口已聚焦时不闪（用户正在看）
    if (mainWindow.isFocused()) { mainWindow.flashFrame(false); return; }
    // ⚠ 不主动 show 窗口：关到托盘时弹出窗口会打断用户（上一版 showInactive 的错误）。
    //   窗口可见（最小化/后台）→ flashFrame 让任务栏图标闪烁；
    //   窗口隐藏到托盘 → flashFrame 无效，改由托盘图标闪烁 + overlay 红点提示（见下）。
    mainWindow.flashFrame(!!on);
    // 托盘隐藏态：用托盘图标闪烁提示未读（不弹窗口，符合微信/QQ 桌面习惯）
    if (!mainWindow.isVisible()) startTrayFlash();
  });

  // 未读角标：Windows 用任务栏 overlay 图标，macOS 用 Dock badge。
  // count 归一化为非负整数；0 清除角标。
  ipcMain.handle('window:setBadge', (_e, count) => {
    if (!isTrustedSender(_e)) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const n = Math.max(0, Math.min(999, parseInt(count, 10) || 0));
    try {
      if (process.platform === 'darwin') {
        app.dock?.setBadge?.(n > 0 ? String(n) : '');
      } else if (process.platform === 'win32') {
        // Windows 无原生数字角标，用红点 overlay 表示"有未读"；n=0 清除
        mainWindow.setOverlayIcon(n > 0 ? buildBadgeOverlay(n) : null,
          n > 0 ? `${n} 条未读` : '');
      }
      // Linux 部分 DE 支持 Unity launcher count
      app.setBadgeCount?.(n);
    } catch (e) { log.warn('setBadge 失败:', e.message); }
  });

  // 来电时把窗口拉到前台并闪烁：后台/最小化时用户能立刻看到来电界面。
  ipcMain.handle('window:focusForCall', (_e) => {
    if (!isTrustedSender(_e)) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.flashFrame(true);
    mainWindow.focus();
  });

  // 选择文件（仅用户操作触发，主进程打开对话框）
  ipcMain.handle('dialog:selectFile', async (_e, options) => {
    if (!isTrustedSender(_e)) return [];   // 与其它 IPC 一致：拒绝非受信帧，防注入帧反复弹框骚扰
    if (!mainWindow || mainWindow.isDestroyed()) return [];
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

  // 截图：先把窗口透明度归零（视觉立即消失）再 hide()，
  // 避免 Windows DWM 合成器 hide() 后仍需数百毫秒才真正从屏幕移除的问题。
  // 延时从 250ms 提升到 450ms 以覆盖慢速 GPU/虚拟机场景。
  ipcMain.handle('screenshot:capture', async (_e) => {
    if (!isTrustedSender(_e)) return null;
    if (!mainWindow) return null;
    const wasVisible = mainWindow.isVisible() && !mainWindow.isMinimized();
    if (wasVisible) {
      // 透明度先清零：视觉上立即消失；再 hide 确保窗口真正从 z-order 移除
      mainWindow.setOpacity(0);
      mainWindow.hide();
    }
    await new Promise((r) => setTimeout(r, 450));
    let imgPath = null;
    try {
      const { createCapturer } = require('./screenshot');
      imgPath = await createCapturer();
    } catch (e) {
      log.error('截图失败:', e);
    } finally {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.setOpacity(1);
        mainWindow.focus();
      }
    }
    return imgPath;
  });

  // 安全读文件：仅允许读取本应用在 temp 下生成的截图文件
  // 收窄到 vxin-screenshot-*.png（而非整个 temp 目录），并设大小上限
  ipcMain.handle('file:readAsBase64', async (_e, filePath) => {
    if (!isTrustedSender(_e)) return null;
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
  ipcMain.handle('config:setServerUrl', async (_e, url) => {
    if (!isTrustedSender(_e)) return false;
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
      message: '确认将 投聊 连接的服务器切换为：',
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

  // 快捷键设置：读取 / 修改 / 重置
  ipcMain.handle('shortcuts:getAll', (_e) => {
    if (!isTrustedSender(_e)) return null;
    return store.get('shortcuts');
  });
  ipcMain.handle('shortcuts:set', (_e, key, accelerator) => {
    if (!isTrustedSender(_e)) return false;
    if (typeof key !== 'string' || typeof accelerator !== 'string') return false;
    // 允许的快捷键名白名单（目前只有 screenshot，后续扩展在此加）
    const ALLOWED_KEYS = new Set(['screenshot']);
    if (!ALLOWED_KEYS.has(key)) return false;
    // 简单格式校验：必须含至少一个修饰键 + 普通键
    const valid = /^(CommandOrControl|Ctrl|Alt|Shift|Super)(\+(CommandOrControl|Ctrl|Alt|Shift|Super))*\+.+$/i.test(accelerator);
    if (!valid) return false;
    const shortcuts = store.get('shortcuts') || {};
    shortcuts[key] = accelerator;
    store.set('shortcuts', shortcuts);
    // 重新注册（先全清再装）
    globalShortcut.unregisterAll();
    setupShortcuts();
    return true;
  });
  ipcMain.handle('shortcuts:reset', (_e, key) => {
    if (!isTrustedSender(_e)) return false;
    const DEFAULTS = { screenshot: 'CommandOrControl+Alt+A' };
    const shortcuts = store.get('shortcuts') || {};
    if (key && DEFAULTS[key]) shortcuts[key] = DEFAULTS[key];
    else Object.assign(shortcuts, DEFAULTS);
    store.set('shortcuts', shortcuts);
    globalShortcut.unregisterAll();
    setupShortcuts();
    return true;
  });

  // 系统信息
  ipcMain.handle('system:getPlatform', () => process.platform);

  // 更新：用户在 UI 确认后主动触发安装
  ipcMain.handle('update:install', (_e) => {
    if (!isTrustedSender(_e)) return;
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });

  // 更新：用户手动点「检查更新」按钮触发
  ipcMain.handle('update:check', (_e) => {
    if (!isTrustedSender(_e)) return;
    autoUpdater.checkForUpdates().catch((e) => {
      mainWindow?.webContents.send('update:error', `检查失败：${e.message}`);
    });
  });
}

// ── 全局快捷键（截图等）──────────────────────────────────
// 从 store 读取用户自定义快捷键（默认 Ctrl+Alt+A），支持运行时热更新。
function setupShortcuts() {
  const shortcuts = store.get('shortcuts') || {};
  const screenshotKey = shortcuts.screenshot || 'CommandOrControl+Alt+A';
  const ok = globalShortcut.register(screenshotKey, () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('shortcut:screenshot');
  });
  if (!ok) log.warn(`快捷键注册失败（可能被系统/其它 App 占用）: ${screenshotKey}`);
}

// ── 休眠唤醒重连（AUDIT.md 十二节🟡）──────────────────────
// 渲染层 socket.io-client 只能靠 pingTimeout(20秒) 超时才判定断线，笔记本合盖唤醒后
// 最坏要等 20 秒才开始重连。系统级 powerMonitor 能在唤醒瞬间就通知渲染层主动检查连接，
// 把这个滞后从"最多20秒"降到"几乎瞬间"。只通知，不代主进程判断连接死活——
// 连接是否真的需要重连、怎么重连，仍由渲染层 socket.io 自己的状态和逻辑决定。
function setupPowerMonitor() {
  powerMonitor.on('resume', () => {
    log.info('[power] 系统从休眠唤醒，通知渲染层立即检查连接');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('power:resume');
    }
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

  // ── 清理渲染缓存：修复旧缓存导致的气泡/图片残影重绘 ──
// 桌面端曾出现消息气泡、图片局部残影错乱（旧 GPU/磁盘缓存里的损坏图层被复用）。
// 每次启动清理 Chromium 磁盘/GPU 缓存目录（保留 localStorage/登录态，不清 userData 配置）。
// 仅清理 Cache/Code Cache/GPUCache/DawnCache 子目录，不动 indexdb/localStorage。
async function clearRenderCaches() {
  const userData = app.getPath('userData');
  const cacheDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'ShaderCache'];
  for (const d of cacheDirs) {
    const p = path.join(userData, d);
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        log.info('已清理渲染缓存目录:', d);
      }
    } catch (e) {
      log.warn('清理缓存目录失败(可能被占用,忽略):', d, e.message);
    }
  }
  // 会话级缓存(内存中的 HTTP cache 等)也一并清空
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearCodeCaches({});
  } catch (e) {
    log.warn('clearCache 失败(忽略):', e.message);
  }
}

app.whenReady().then(async () => {
    if (store.get('autoLaunch')) {
      app.setLoginItemSettings({ openAtLogin: true });
    }

    // 先据远程 config.json 解析后端地址，再建窗口/装 CSP，使 connect-src 跟随远程配置
    await loadRemoteServerUrl();

    // 启动时清理渲染缓存（残影修复）：必须在创建窗口之前执行，
    // 否则 Chromium 已打开缓存文件句柄，Windows 上删除会失败/部分生效
    await clearRenderCaches();

    setupSecurity();
    setupIPC();
    createWindow();
    createTray();
    setupAutoUpdater();
    setupShortcuts();
    setupPowerMonitor();

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
