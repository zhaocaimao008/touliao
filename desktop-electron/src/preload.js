'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 渲染进程通过 window.__ELECTRON_CONFIG__ 判断 Electron 环境
contextBridge.exposeInMainWorld('__ELECTRON_CONFIG__', {
  isElectron: true,
  serverUrl: 'https://dipsin.com',
  appVersion: require('../../package.json').version,
});

// ── 白名单 IPC API（最小暴露原则）──────────────────────────
const electronAPI = {
  // 窗口控制
  minimize:         () => ipcRenderer.invoke('window:minimize'),
  maximize:         () => ipcRenderer.invoke('window:maximize'),
  close:            () => ipcRenderer.invoke('window:close'),
  isMaximized:      () => ipcRenderer.invoke('window:isMaximized'),

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

// 窗口最大化状态
ipcRenderer.on('window:maximized-change', (_, isMaximized) => {
  window.dispatchEvent(new CustomEvent('electron:maximized-change', { detail: isMaximized }));
});

// 截图快捷键（Ctrl+Alt+A）→ 渲染进程处理
ipcRenderer.on('shortcut:screenshot', () => {
  window.dispatchEvent(new CustomEvent('electron:shortcut-screenshot'));
});
