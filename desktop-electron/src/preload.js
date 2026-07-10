'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 真实应用版本由主进程经 additionalArguments 下发（app.getVersion()，取自打包 package.json）。
// 不再 require('../../package.json')：沙箱化 preload 不能可靠读本地文件，且旧路径读到的是
// 仓库根 package.json(2.0.0) 而非桌面端版本。process.argv 在沙箱 preload 中可用。
const argValue = (prefix) => {
  const a = process.argv.find(x => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : '';
};
const APP_VERSION = argValue('--vxin-app-version=');
// 真实后端地址由主进程据远程 config.json 解析后经启动参数下发；缺省回退默认域名。
// 不再硬编码，避免换服务器后此字段与实际连接的后端不一致。
const SERVER_URL = argValue('--vxin-server-url=') || 'https://dipsin.com';

// 渲染进程通过 window.__ELECTRON_CONFIG__ 判断 Electron 环境
contextBridge.exposeInMainWorld('__ELECTRON_CONFIG__', {
  isElectron: true,
  serverUrl: SERVER_URL,
  appVersion: APP_VERSION,
});

// ── 白名单 IPC API（最小暴露原则）──────────────────────────
const electronAPI = {
  // 窗口控制
  minimize:         () => ipcRenderer.invoke('window:minimize'),
  maximize:         () => ipcRenderer.invoke('window:maximize'),
  close:            () => ipcRenderer.invoke('window:close'),
  isMaximized:      () => ipcRenderer.invoke('window:isMaximized'),

  // 后台提醒：任务栏闪烁 / 未读角标 / 来电时窗口置顶
  flashFrame:       (on)    => ipcRenderer.invoke('window:flashFrame', !!on),
  setBadge:         (count) => ipcRenderer.invoke('window:setBadge', count),
  focusForCall:     ()      => ipcRenderer.invoke('window:focusForCall'),

  // 通知（仅接受 title/body 两个字段，防止注入）
  showNotification: (opts) => {
    const safe = {
      title: String(opts?.title || '').slice(0, 100),
      body:  String(opts?.body  || '').slice(0, 300),
    };
    return ipcRenderer.invoke('notification:show', safe);
  },

  // 文件：对话框选择（主进程打开，不暴露任意路径读取）
  selectFile:       (opts) => ipcRenderer.invoke('dialog:selectFile', opts),

  // 截图（主进程采集 → 写 temp → 返回路径，再读取 base64）
  screenshot:       ()         => ipcRenderer.invoke('screenshot:capture'),
  readFileAsBase64: (filePath) => ipcRenderer.invoke('file:readAsBase64', filePath),

  // 服务器配置
  setServerUrl:     (url) => ipcRenderer.invoke('config:setServerUrl', url),
  getServerUrl:     ()    => ipcRenderer.invoke('config:getServerUrl'),

  // 系统信息
  getPlatform:      ()    => ipcRenderer.invoke('system:getPlatform'),

  // 更新：用户确认后调用
  installUpdate:    ()    => ipcRenderer.invoke('update:install'),

  // 文件下载：主进程 downloadURL 落盘到「下载」并自动打开（绕过渲染进程 CORS/download 限制）
  downloadFile:     (url, filename) => ipcRenderer.invoke('file:download', { url, filename }),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// ── 主进程 → 渲染进程事件（单向推送）──────────────────────
// 更新事件
ipcRenderer.on('update:available', (_, info) => {
  window.dispatchEvent(new CustomEvent('electron:update-available', { detail: info }));
});
ipcRenderer.on('update:progress', (_, pct) => {
  window.dispatchEvent(new CustomEvent('electron:update-progress', { detail: pct }));
});
ipcRenderer.on('update:downloaded', (_, info) => {
  window.dispatchEvent(new CustomEvent('electron:update-downloaded', { detail: info }));
});
ipcRenderer.on('update:error', (_, err) => {
  window.dispatchEvent(new CustomEvent('electron:update-error', { detail: err }));
});

// 窗口最大化状态
ipcRenderer.on('window:maximized-change', (_, isMaximized) => {
  window.dispatchEvent(new CustomEvent('electron:maximized-change', { detail: isMaximized }));
});

// 截图快捷键（Ctrl+Alt+A）→ 渲染进程处理
ipcRenderer.on('shortcut:screenshot', () => {
  window.dispatchEvent(new CustomEvent('electron:shortcut-screenshot'));
});
