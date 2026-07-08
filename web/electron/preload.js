'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 启动时从主进程获取远程配置
let remoteConfig = null;
(async () => {
  try { remoteConfig = await ipcRenderer.invoke('config:get'); } catch {}
})();

contextBridge.exposeInMainWorld('vxinAPI', {
  isElectron: true,
  getConfig: async () => {
    if (remoteConfig) return remoteConfig;
    try { remoteConfig = await ipcRenderer.invoke('config:get'); return remoteConfig; } catch { return null; }
  },
  minimize:    () => ipcRenderer.send('window:minimize'),
  maximize:    () => ipcRenderer.send('window:maximize'),
  close:       () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const onMax   = () => cb(true);
    const onUnmax = () => cb(false);
    ipcRenderer.on('maximize',   onMax);
    ipcRenderer.on('unmaximize', onUnmax);
    return () => { ipcRenderer.off('maximize', onMax); ipcRenderer.off('unmaximize', onUnmax); };
  },
  notify: (opts) => ipcRenderer.invoke('notify:show', opts),
});

// 将 maximize/unmaximize 转为 CustomEvent，ElectronTitlebar.jsx 监听
ipcRenderer.on('maximize',   () => window.dispatchEvent(new CustomEvent('electron:maximized-change', { detail: true })));
ipcRenderer.on('unmaximize', () => window.dispatchEvent(new CustomEvent('electron:maximized-change', { detail: false })));

// electronAPI：ElectronTitlebar.jsx + electron.js 工具函数使用
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize:         () => ipcRenderer.send('window:minimize'),
  maximize:         () => ipcRenderer.send('window:maximize'),
  close:            () => ipcRenderer.send('window:close'),
  isMaximized:      () => ipcRenderer.invoke('window:isMaximized'),
  // 通知
  showNotification: (opts) => ipcRenderer.invoke('notify:show', opts),
  // 未读角标：把未读总数反映到 Dock(mac)/任务栏(win/linux)
  setBadge:         (count) => ipcRenderer.send('badge:set', count),
  // 窗口闪烁提醒：失焦时收到新消息引起注意
  flashFrame:       (on) => ipcRenderer.send('window:flash', on),
  // 截图
  screenshot:       () => ipcRenderer.invoke('screenshot:capture'),
  readFileAsBase64: (p) => ipcRenderer.invoke('file:readAsBase64', p),
  // 文件选择（使用原生 <input type=file>，此方法保留兼容）
  selectFile:       () => Promise.resolve([]),
});

contextBridge.exposeInMainWorld('__ELECTRON_CONFIG__', {
  isElectron: true,
});
