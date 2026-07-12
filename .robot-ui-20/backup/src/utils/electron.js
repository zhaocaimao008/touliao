/**
 * Electron 桌面端增强模块
 * 注入到渲染进程，提供：
 * - 文件拖拽发送 (ondrop → read file → upload)
 * - 图片粘贴发送
 * - 截图发送
 * - 原生通知桥接
 * - 点击系统托盘通知跳转
 */

// ── 初始化（仅 Electron 环境） ──────────────────────────────
export function initElectronFeatures() {
  if (!window.__ELECTRON_CONFIG__) return;

  // 截图快捷键：主进程通过 IPC 通知渲染进程（不再用 executeJavaScript）
  window.addEventListener('electron:shortcut-screenshot', () => {
    triggerScreenshot().catch(() => {});
  });

  // 更新进度日志
  window.addEventListener('electron:update-available',  (e) => console.log(`[electron] 新版本 ${e.detail?.version} 可用`));
  window.addEventListener('electron:update-progress',   (e) => console.log(`[electron] 下载进度 ${e.detail}%`));
  window.addEventListener('electron:update-downloaded', ()  => console.log('[electron] 更新已下载，等待用户确认安装'));
}

// ── 截图 ──────────────────────────────────────────────────
export async function triggerScreenshot() {
  const api = window.electronAPI;
  if (!api?.screenshot) return null;
  try {
    const filePath = await api.screenshot();
    if (!filePath) return null;
    const base64 = await api.readFileAsBase64(filePath);
    return base64;
  } catch (e) {
    console.error('[electron] 截图失败:', e);
    return null;
  }
}

// ── 选择文件 ──────────────────────────────────────────────
export async function selectFiles(options) {
  const api = window.electronAPI;
  if (!api?.selectFile) return [];
  try {
    const paths = await api.selectFile(options);
    if (!paths || paths.length === 0) return [];
    // 注意：readFileAsBase64 仅允许读 temp 目录截图，文件上传走 Web 拖拽/input
    return paths.map((fp) => ({ name: fp.split(/[/\\]/).pop(), path: fp }));
  } catch (e) {
    console.error('[electron] 选择文件失败:', e);
    return [];
  }
}

// ── 拖拽处理 ──────────────────────────────────────────────
export function handleFileDrop(e, onFiles) {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;
  onFiles(files);
}

// ── 粘贴处理（从剪贴板读取图片） ──────────────────────────
export function handlePaste(e, onImagePaste) {
  if (!window.__ELECTRON_CONFIG__) return;
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        onImagePaste(file);
        e.preventDefault();
        return;
      }
    }
  }
}

// ── 原生通知 ──────────────────────────────────────────────
export function showNativeNotification({ title, body }) {
  if (document.hasFocus()) return;
  window.electronAPI?.showNotification({ title, body });
}
