/**
 * VXinSocketHandler.main.patch.js
 * ─── 在 main.js 末尾（setupShortcuts 之后）添加 ───
 *
 * 插入位置：在 590 行 `// ── 应用生命周期` 之前
 */

// ── Power Monitor：系统休眠/唤醒推送至渲染进程 ──────────────────
function setupPowerMonitor() {
  const { powerMonitor } = require('electron');

  powerMonitor.on('suspend', () => {
    log.info('[Power] 系统休眠');
    // 推送给所有渲染进程
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('power:sleep');
    });
  });

  powerMonitor.on('resume', () => {
    log.info('[Power] 系统唤醒');
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('power:resume');
    });
  });
}

/**
 * 然后在 app.whenReady() 中 setupShortcuts() 之后调用：
 *
 *   setupPowerMonitor();       // ← 新加
 *
 * 完整的 whenReady 调用链：
 *
 *   app.whenReady().then(async () => {
 *     if (store.get('autoLaunch')) {
 *       app.setLoginItemSettings({ openAtLogin: true });
 *     }
 *     await loadRemoteServerUrl();
 *     setupSecurity();
 *     setupIPC();
 *     createWindow();
 *     createTray();
 *     setupAutoUpdater();
 *     setupShortcuts();
 *     setupPowerMonitor();     // ← 新加
 *     app.on('activate', () => { ... });
 *   });
 */


/**
 * VXinSocketHandler.preload.patch.js
 * ─── 在 preload.js 中 electronAPI 后面追加 ───
 *
 * 插入位置：在 electronAPI 对象的最后一个方法之后、contextBridge.exposeInMainWorld 之前
 */

// ── 新增属性到 electronAPI ──
const electronAPI = {
  // 原有方法保持不变
  minimize:         () => ipcRenderer.invoke('window:minimize'),
  maximize:         () => ipcRenderer.invoke('window:maximize'),
  close:            () => ipcRenderer.invoke('window:close'),
  isMaximized:      () => ipcRenderer.invoke('window:isMaximized'),
  showNotification: (opts) => { /* 原有实现不变 */ },
  selectFile:       (opts) => ipcRenderer.invoke('dialog:selectFile', opts),
  screenshot:       ()    => ipcRenderer.invoke('screenshot:capture'),
  readFileAsBase64: (fp)  => ipcRenderer.invoke('file:readAsBase64', fp),
  setServerUrl:     (url) => ipcRenderer.invoke('config:setServerUrl', url),
  getServerUrl:     ()    => ipcRenderer.invoke('config:getServerUrl'),
  getPlatform:      ()    => ipcRenderer.invoke('system:getPlatform'),
  installUpdate:    ()    => ipcRenderer.invoke('update:install'),

  // ═══ 新增：系统电源事件（VXinSocketHandler 监听） ═══
  /** 注册系统休眠回调 */
  onPowerSleep: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('power:sleep', handler);
    // 返回取消订阅函数
    return () => ipcRenderer.removeListener('power:sleep', handler);
  },
  /** 注册系统唤醒回调 */
  onPowerResume: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('power:resume', handler);
    return () => ipcRenderer.removeListener('power:resume', handler);
  },
};
