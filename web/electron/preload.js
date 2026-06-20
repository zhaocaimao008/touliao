'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 白名单事件：只允许转发这些频道，防止渲染层监听任意 IPC
const ALLOWED_EVENTS = ['maximize', 'unmaximize'];

// 启动时从主进程获取远程配置
let remoteConfig = null;
(async () => {
  try {
    remoteConfig = await ipcRenderer.invoke('config:get');
  } catch (e) {
    console.warn('[preload] config:get 失败:', e.message);
  }
})();

contextBridge.exposeInMainWorld('vxinAPI', {

  /** 标记当前运行在 Electron 容器中，React 侧可用于条件判断 */
  isElectron: true,

  // ── 获取远程配置（用于 electron 启动时同步配置） ────────────
  getConfig: async () => {
    if (remoteConfig) return remoteConfig;
    try {
      remoteConfig = await ipcRenderer.invoke('config:get');
      return remoteConfig;
    } catch { return null; }
  },

  // ── 窗口控制（配合 frame:false 的自定义标题栏使用）─────────
  minimize:    () => ipcRenderer.send('window:minimize'),
  maximize:    () => ipcRenderer.send('window:maximize'),
  close:       () => ipcRenderer.send('window:close'),

  /** 查询当前最大化状态（组件 mount 时同步初始值）*/
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  /**
   * 监听窗口最大化 / 还原事件
   * @param {(isMaximized: boolean) => void} callback
   * @returns {() => void} 清理函数，组件卸载时调用
   */
  onMaximizeChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const onMax   = () => callback(true);
    const onUnmax = () => callback(false);
    ipcRenderer.on('maximize',   onMax);
    ipcRenderer.on('unmaximize', onUnmax);
    return () => {
      ipcRenderer.off('maximize',   onMax);
      ipcRenderer.off('unmaximize', onUnmax);
    };
  },

  // ── 系统原生通知 ────────────────────────────────────────────
  /** @param {{ title: string, body: string, icon?: string }} opts */
  notify: (opts) => ipcRenderer.invoke('notify:show', opts),

});

// Dispatch CustomEvent so ElectronTitlebar.jsx can use addEventListener
ipcRenderer.on('maximize',   () => window.dispatchEvent(new CustomEvent('electron:maximized-change', { detail: true })));
ipcRenderer.on('unmaximize', () => window.dispatchEvent(new CustomEvent('electron:maximized-change', { detail: false })));

// electronAPI: matches what ElectronTitlebar.jsx expects
contextBridge.exposeInMainWorld('electronAPI', {
  minimize:    () => ipcRenderer.send('window:minimize'),
  maximize:    () => ipcRenderer.send('window:maximize'),
  close:       () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
});

contextBridge.exposeInMainWorld('__ELECTRON_CONFIG__', {
  isElectron: true,
});
